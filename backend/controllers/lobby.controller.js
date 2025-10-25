// controllers/lobby.controller.js
import crypto from "crypto";
import Lobby from "../models/Lobby.js";

const makeCode = () => crypto.randomBytes(3).toString("hex").toUpperCase(); // e.g. 6-char code

export async function createLobby(req, res) {
  const code = makeCode();
  const lobby = await Lobby.create({
    code,
    hostUserId: req.user.id,
    maxPlayers: Number(req.body?.maxPlayers) || 2,
    players: [{ userId: req.user.id, username: req.user.username, ready: false }],
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
  });
  res.json({ code: lobby.code });
}

export async function getLobby(req, res) {
  const lobby = await Lobby.findOne({ code: req.params.code });
  if (!lobby) return res.status(404).json({ message: "Lobby not found" });
  res.json(lobby);
}

// Atomic join with capacity + status check
export async function joinLobby(req, res) {
  const { code } = req.params;
  const lobby = await Lobby.findOneAndUpdate(
    {
      code,
      status: "open",
      $expr: { $lt: [{ $size: "$players" }, "$maxPlayers"] },
      "players.userId": { $ne: req.user.id }
    },
    {
      $push: { players: { userId: req.user.id, username: req.user.username, ready: false } },
      $set: { expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) }
    },
    { new: true }
  );
  if (!lobby) return res.status(400).json({ message: "Cannot join (full, closed, or already joined)." });
  res.json({ ok: true });
}

export async function leaveLobby(req, res) {
  const { code } = req.params;
  let lobby = await Lobby.findOneAndUpdate(
    { code, "players.userId": req.user.id },
    { $pull: { players: { userId: req.user.id } } },
    { new: true }
  );
  if (!lobby) return res.status(404).json({ message: "Lobby not found or not a member" });

  // If host left, transfer host
  if (lobby.hostUserId === req.user.id && lobby.players.length > 0) {
    lobby.hostUserId = lobby.players[0].userId;
    await lobby.save();
  }
  // If no players left, you can delete or leave for TTL cleanup
  res.json({ ok: true, hostUserId: lobby.hostUserId });
}

export async function readyUp(req, res) {
  const { code } = req.params;
  const lobby = await Lobby.findOne({ code });
  if (!lobby) return res.status(404).json({ message: "Lobby not found" });
  lobby.players = lobby.players.map(p =>
    p.userId === req.user.id ? { ...p.toObject(), ready: true, lastSeenAt: new Date() } : p
  );
  await lobby.save();
  res.json({ ok: true });
}

export async function unready(req, res) {
  const { code } = req.params;
  const lobby = await Lobby.findOne({ code });
  if (!lobby) return res.status(404).json({ message: "Lobby not found" });
  lobby.players = lobby.players.map(p =>
    p.userId === req.user.id ? { ...p.toObject(), ready: false, lastSeenAt: new Date() } : p
  );
  await lobby.save();
  res.json({ ok: true });
}

// Host-only start (check ready)
export async function startMatch(req, res) {
  const { code } = req.params;
  const lobby = await Lobby.findOne({ code });
  if (!lobby) return res.status(404).json({ message: "Lobby not found" });
  if (lobby.hostUserId !== req.user.id) return res.status(403).json({ message: "Host only" });
  if (lobby.players.length < 2) return res.status(400).json({ message: "Need at least 2 players" });

  const allReady = lobby.players.every(p => p.ready);
  if (!allReady) return res.status(400).json({ message: "All players must be ready" });

  lobby.status = "in_progress";
  await lobby.save();
  // create Match here (if you have a Match model) and set lobby.currentMatchId
  res.json({ ok: true /*, matchId*/ });
}

export async function kickPlayer(req, res) {
  const { code } = req.params;
  const { userId } = req.body;
  const lobby = await Lobby.findOne({ code });
  if (!lobby) return res.status(404).json({ message: "Lobby not found" });
  if (lobby.hostUserId !== req.user.id) return res.status(403).json({ message: "Host only" });
  lobby.players = lobby.players.filter(p => p.userId !== userId);
  await lobby.save();
  res.json({ ok: true });
}

export async function heartbeat(req, res) {
  // optional: update presence to drop idle users later
  const { code } = req.params;
  await Lobby.updateOne(
    { code, "players.userId": req.user.id },
    { $set: { "players.$.lastSeenAt": new Date() } }
  );
  res.json({ ok: true });
}
