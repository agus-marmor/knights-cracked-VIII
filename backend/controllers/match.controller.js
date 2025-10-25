// controllers/match.controller.js
import Match from "../models/Match.js";
import Lobby from "../models/Lobby.js";
import { io } from "../realtime/socket.js"; // your initialized socket.io server
import { choosePrompt } from "../utils/prompt.js"; // return { id, text }

export async function createMatchFromLobby(req, res) {
  const { code } = req.params;
  const lobby = await Lobby.findOne({ code: code.toUpperCase(), status: "in_progress" });
  if (!lobby) return res.status(400).json({ message: "Lobby not ready" });
  if (lobby.hostUserId !== req.user.id) return res.status(403).json({ message: "Host only" });

  const allReady = lobby.players.length >= 2 && lobby.players.every(p => p.ready);
  if (!allReady) return res.status(400).json({ message: "All players must be ready" });

  const { id: promptId, text: promptText } = await choosePrompt();

  const players = lobby.players.map(p => ({
    userId: p.userId,
    username: p.username,
    wpm: 0, accuracy: 100, charsTyped: 0, errors: 0, finished: false
  }));

  const match = await Match.create({
    code: lobby.code,
    lobbyId: lobby._id,
    status: "countdown",
    promptId, promptText,
    players
  });

  io.to(`lobby:${lobby.code}`).emit("match:created", { matchId: match._id, code: lobby.code });
  emitMatchSnapshot(lobby.code, match);

  // 3…2…1… → playing
  startCountdown(lobby.code, match._id);

  return res.json({ ok: true, matchId: match._id });
}

function emitMatchSnapshot(code, match) {
  const payload = {
    status: match.status,
    promptId: match.promptId,
    promptText: match.promptText,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    durationMs: match.durationMs,
    players: match.players,
    winnerUserId: match.winnerUserId,
  };
  io.to(`match:${code}`).emit("match:snapshot", payload);
}

async function startCountdown(code, matchId) {
  let secs = 3;
  const room = `match:${code}`;
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
      emitMatchSnapshot(code, match);

      // optional hard timeout (e.g., 120s)
      setTimeout(() => hardFinish(code, matchId, "timeout"), 120000);
    }
  }, 1000);
}

async function hardFinish(code, matchId, reason) {
  const match = await Match.findById(matchId);
  if (!match || match.status === "finished") return;
  const final = finalizeResult(match, reason);
  await match.save();
  io.to(`match:${code}`).emit("match:finished", publicResult(final));
}
