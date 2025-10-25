
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import "dotenv/config";
import { publicLobbyView } from "./utils/lobby.view.js";
import Lobby from "./models/Lobby.js";
import Match from "./models/Match.js";


console.log("[boot] JWT_SECRET len =", (process.env.JWT_SECRET || "").length);

let io;

export function initSocket(server, corsOrigin) {
  const allowlist = new Set([
    corsOrigin,
    "http://localhost:3002",
    "http://127.0.0.1:3002"
  ].filter(Boolean));

  io = new Server(server, {
    cors: {
      origin(origin, cb) {
        // ✅ allow Node or CLI clients with no Origin header
        if (!origin) return cb(null, true);
        if (allowlist.has(origin)) return cb(null, true);
        cb(new Error("Not allowed by CORS"));
      },
      methods: ["GET", "POST"],
      allowedHeaders: ["Authorization"],
      credentials: true
    }
  });

  // 🔐 Auth middleware
io.use((socket, next) => {
  try {
    const h = socket.handshake.headers?.authorization || "";
    const tokenHeader = h.startsWith("Bearer ") ? h.slice(7) : null;
    const tokenAuth   = socket.handshake.auth?.token || null;
    const token = tokenAuth || tokenHeader;
    if (!token) return next(new Error("Unauthorized: missing token"));

    const p = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = { id: p.id, email: p.email, username: p.username };
    next();
  } catch (e) {
    return next(new Error("Unauthorized: " + (e?.message || "invalid")));
  }
});



  // 🎮 Lobby Events
  io.on("connection", (socket) => {
    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (room.startsWith("lobby:")) {
          io.to(room).emit("lobby:presence", {
            type: "leave",
            userId: socket.user?.id
          });
        }
      }
    });
        // =========================
    // 🎯 MATCH EVENTS
    // =========================
    const THROTTLE_MS = 80; // ~12.5 Hz updates
    const lastTick = new Map(); // key: `${code}:${userId}` -> ts

    socket.on("match:subscribe", async ({ code }) => {
      if (!code) return;
      const up = code.toUpperCase();
      const room = `match:${up}`;

      // Verify the user belongs to the lobby
      const lobby = await Lobby.findOne({ code: up }).lean();
      if (!lobby) return socket.emit("error", { message: "Lobby not found" });
      if (!lobby.players?.some(p => p.userId === socket.user.id)) {
        return socket.emit("error", { message: "Not in this lobby" });
      }

      socket.join(room);

      // Send latest match snapshot (most recent by createdAt)
      const match = await Match.findOne({ code: up }).sort({ createdAt: -1 }).lean();
      if (match) socket.emit("match:update", publicMatchView(match));
    });

    socket.on("match:unsubscribe", ({ code }) => {
      if (!code) return;
      socket.leave(`match:${code.toUpperCase()}`);
    });

    // Live typing progress (authoritative server computes WPM/accuracy)
    socket.on("progress:update", async ({ code, charsTyped, errors, finished }) => {
      const up = (code || "").toUpperCase();
      const userId = socket.user.id;

      // throttle per user per match
      const key = `${up}:${userId}`;
      const now = Date.now();
      if (now - (lastTick.get(key) || 0) < THROTTLE_MS) return;
      lastTick.set(key, now);

      // only during playing
      const match = await Match.findOne({ code: up, status: "playing" });
      if (!match) return;

      // must be a player
      const me = match.players.find(p => p.userId === userId);
      if (!me) return;

      // guards (monotonic charsTyped, non-negative errors)
      const maxLen = match.promptText?.length || 0;
      charsTyped = Math.max(me.charsTyped, Math.min(Number(charsTyped) || 0, maxLen));
      errors = Math.max(0, Number(errors) || 0);

      // compute server-side metrics
      const elapsedMs = Math.max(1, Date.now() - new Date(match.startedAt).getTime());
      const minutes = elapsedMs / 60000;
      const grossWPM = minutes > 0 ? (charsTyped / 5) / minutes : 0;
      const acc = charsTyped > 0 ? Math.max(0, 100 * (1 - (errors / charsTyped))) : 100;

      me.charsTyped = charsTyped;
      me.errors = errors;
      me.wpm = Math.round(grossWPM);
      me.accuracy = Math.round(acc);

      if (finished || charsTyped >= maxLen) {
        me.finished = true;
        me.finishedAt = me.finishedAt || new Date();
      }

      await match.save();

      io.to(`match:${up}`).emit("match:progress", {
        userId,
        wpm: me.wpm,
        accuracy: me.accuracy,
        charsTyped: me.charsTyped,
        errors: me.errors,
        finished: me.finished,
        finishedAt: me.finishedAt
      });

      // If both finished, we can finalize immediately
      const bothFinished = match.players.length >= 2 && match.players.every(p => p.finished);
      if (bothFinished) await tryFinishMatch(io, match, up);
    });

    socket.on("lobby:subscribe", async ({ code }) => {
  if (!code) return;
  const room = `lobby:${code.toUpperCase()}`;
  socket.join(room);

  // Send initial snapshot to THIS socket
  const lobby = await Lobby.findOne({ code: code.toUpperCase() }).lean();
  if (lobby) socket.emit("lobby:update", publicLobbyView(lobby));

  // Optional presence ping to everyone
  io.to(room).emit("lobby:presence", { type: "join", userId: socket.user.id });
});

    socket.on("lobby:unsubscribe", ({ code }) => {
      if (!code) return;
      const room = `lobby:${code.toUpperCase()}`;
      socket.leave(room);
      io.to(room).emit("lobby:presence", {
        type: "leave",
        userId: socket.user.id
      });
    });
  });

  return io;
}
function publicMatchView(m) {
  return {
    status: m.status,
    code: m.code,
    promptId: m.promptId,
    promptText: m.promptText,
    startedAt: m.startedAt,
    endedAt: m.endedAt,
    durationMs: m.durationMs,
    winnerUserId: m.winnerUserId,
    players: (m.players || []).map(p => ({
      userId: p.userId,
      username: p.username,
      wpm: p.wpm,
      accuracy: p.accuracy,
      charsTyped: p.charsTyped,
      errors: p.errors,
      finished: p.finished,
      finishedAt: p.finishedAt
    }))
  };
}

async function emitMatchSnapshot(io, code, matchIdOrDoc) {
  const up = code.toUpperCase();
  let match = matchIdOrDoc;
  if (!match || !match.players) {
    match = await Match.findById(matchIdOrDoc).lean();
  } else if (match.toObject) {
    match = match.toObject();
  }
  if (!match) return;
  io.to(`match:${up}`).emit("match:update", publicMatchView(match));
}

async function startCountdown(io, code, matchId, secs = 3) {
  const up = code.toUpperCase();
  const room = `match:${up}`;
  const timer = setInterval(async () => {
    io.to(room).emit("match:countdown", { secs });
    if (secs-- <= 0) {
      clearInterval(timer);
      const match = await Match.findByIdAndUpdate(
        matchId,
        { $set: { status: "playing", startedAt: new Date() } },
        { new: true }
      );
      io.to(room).emit("match:started", { startedAt: match.startedAt });
      await emitMatchSnapshot(io, up, match);

      // hard stop safeguard (e.g., 120s)
      setTimeout(() => hardFinish(io, up, matchId, "timeout"), 120000);
    }
  }, 1000);
}

async function hardFinish(io, code, matchId, reason) {
  const match = await Match.findById(matchId);
  if (!match || match.status === "finished") return;
  finalizeResult(match, reason);
  await match.save();
  io.to(`match:${code}`).emit("match:finished", publicMatchView(match));
}

async function tryFinishMatch(io, matchDoc, code) {
  if (matchDoc.status !== "playing") return;
  finalizeResult(matchDoc, "completed");
  await matchDoc.save();
  io.to(`match:${code}`).emit("match:finished", publicMatchView(matchDoc));
}

function finalizeResult(match, reason) {
  match.status = "finished";
  match.endedAt = new Date();
  match.durationMs = match.startedAt ? (match.endedAt - match.startedAt) : undefined;

  // Winner policy:
  // - If someone finished: earliest finishedAt wins; tiebreakers: higher accuracy, then higher WPM
  // - If no one finished (timeout): most charsTyped; then accuracy; then WPM
  const finished = match.players.filter(p => p.finished);
  if (finished.length > 0) {
    finished.sort((a,b) => {
      const ta = a.finishedAt?.getTime?.() ?? new Date(a.finishedAt).getTime?.() ?? 0;
      const tb = b.finishedAt?.getTime?.() ?? new Date(b.finishedAt).getTime?.() ?? 0;
      if (ta !== tb) return ta - tb;                     // earlier finish wins
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      return b.wpm - a.wpm;
    });
    match.winnerUserId = finished[0].userId;
  } else {
    const best = [...match.players].sort((a,b) => {
      if (b.charsTyped !== a.charsTyped) return b.charsTyped - a.charsTyped;
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      return b.wpm - a.wpm;
    })[0];
    match.winnerUserId = best?.userId;
  }

  // annotate reason in case you later add a field for it
  return match;
}


export function getIO() {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
}

// at bottom of the socket file
export { startCountdown, emitMatchSnapshot };
