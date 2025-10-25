// realtime/match.socket.js
import Match from "../models/Match.js";
import Lobby from "../models/Lobby.js";

const THROTTLE_MS = 80; // ~12.5 Hz
const lastTick = new Map(); // key: `${code}:${userId}` -> ts

export function attachMatchNamespace(io) {
  io.on("connection", (socket) => {
    socket.on("match:hello", async ({ code }) => {
      const up = (code || "").toUpperCase();
      const user = socket.user; // <- set at auth middleware
      const lobby = await Lobby.findOne({ code: up });
      if (!lobby) return socket.emit("error", { message: "No lobby" });
      if (!lobby.players.some(p => p.userId === user.id)) return socket.emit("error", { message: "Not in lobby" });

      socket.join(`match:${up}`);
      const match = await Match.findOne({ code: up }).sort({ createdAt: -1 });
      if (match) socket.emit("match:snapshot", match.toObject());
    });

    socket.on("progress:update", async ({ code, charsTyped, errors, finished }) => {
      const up = (code || "").toUpperCase();
      const userId = socket.user.id;

      // throttle
      const key = `${up}:${userId}`;
      const now = Date.now();
      if (now - (lastTick.get(key) || 0) < THROTTLE_MS) return;
      lastTick.set(key, now);

      const match = await Match.findOne({ code: up, status: "playing" });
      if (!match) return;

      const me = match.players.find(p => p.userId === userId);
      if (!me) return;

      // monotonic guards
      charsTyped = Math.max(0, Math.min(charsTyped|0, match.promptText.length));
      if (charsTyped < me.charsTyped) charsTyped = me.charsTyped;
      errors = Math.max(0, errors|0);

      // live metrics
      const elapsedMs = Math.max(1, (Date.now() - new Date(match.startedAt).getTime()));
      const minutes = elapsedMs / 60000;
      const grossWPM = (charsTyped / 5) / minutes;     // classic 5-char word
      const acc = charsTyped > 0 ? Math.max(0, 100 * (1 - (errors / charsTyped))) : 100;

      me.charsTyped = charsTyped;
      me.errors = errors;
      me.wpm = Math.round(grossWPM);
      me.accuracy = Math.round(acc);
      if (finished || charsTyped >= match.promptText.length) {
        me.finished = true;
        me.finishedAt = new Date();
      }

      // early winner (first to finish) if both are present
      const allFinished = match.players.length >= 2 && match.players.every(p => p.finished);
      const someoneFinished = match.players.some(p => p.finished);

      await match.save();
      io.to(`match:${up}`).emit("match:progress", { userId, wpm: me.wpm, accuracy: me.accuracy, charsTyped: me.charsTyped, errors: me.errors, finished: me.finished });

      if (allFinished || someoneFinished) {
        tryFinishMatch(match, up);
      }
    });
  });
}

async function tryFinishMatch(match, code) {
  if (match.status !== "playing") return;
  // if both finished OR hard timeout will close later, we can finalize now if both finished
  const bothFinished = match.players.length >= 2 && match.players.every(p => p.finished);
  if (!bothFinished) return;

  const final = finalizeResult(match, "completed");
  await match.save();
  io.to(`match:${code}`).emit("match:finished", publicResult(final));
}

function finalizeResult(match, reason) {
  match.status = "finished";
  match.endedAt = new Date();
  match.durationMs = match.startedAt ? (match.endedAt - match.startedAt) : undefined;

  // winner policy:
  // 1) first to finish; tiebreakers: higher accuracy, then higher WPM, then earlier finishedAt
  const finished = match.players.filter(p => p.finished).sort((a,b) => {
    if (a.finishedAt && b.finishedAt && a.finishedAt - b.finishedAt !== 0) return a.finishedAt - b.finishedAt;
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    if (b.wpm !== a.wpm) return b.wpm - a.wpm;
    return 0;
  });

  if (finished.length > 0) {
    match.winnerUserId = finished[0].userId;
  } else {
    // timeout: highest charsTyped, then accuracy, then wpm
    const best = [...match.players].sort((a,b)=>{
      if (b.charsTyped !== a.charsTyped) return b.charsTyped - a.charsTyped;
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      return b.wpm - a.wpm;
    })[0];
    match.winnerUserId = best?.userId;
  }
  return { reason, match };
}

function publicResult({ reason, match }) {
  return {
    reason,
    endedAt: match.endedAt,
    durationMs: match.durationMs,
    winnerUserId: match.winnerUserId,
    players: match.players.map(p => ({
      userId: p.userId, username: p.username,
      wpm: p.wpm, accuracy: p.accuracy, charsTyped: p.charsTyped, errors: p.errors, finished: p.finished, finishedAt: p.finishedAt
    }))
  };
}
