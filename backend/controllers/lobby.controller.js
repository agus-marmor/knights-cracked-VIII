import crypto from "crypto";
import Lobby from "../models/Lobby.js";
import Match from "../models/Match.js";

const genCode = () => crypto.randomBytes(3).toString("hex").toUpperCase(); // e.g. "A3F9C1"

export async function createLobby(req, res) {
  const code = genCode();
  const lobby = await Lobby.create({
    code,
    hostUserId: req.user.id,
    players: [{ userId: req.user.id, name: req.user.name, joinedAt: new Date(), ready: false }]
  });
  res.json({ code: lobby.code });
}

export async function getLobby(req, res) {
  const lobby = await Lobby.findOne({ code: req.params.code });
  if (!lobby) return res.status(404).json({ message: "Lobby not found" });
  res.json(lobby);
}

export async function joinLobby(req, res) {
  const { code } = req.params;
  const lobby = await Lobby.findOne({ code });
  if (!lobby || lobby.status !== "open") return res.status(400).json({ message: "Cannot join" });

  const already = lobby.players.some(p => p.userId === req.user.id);
  if (!already) {
    lobby.players.push({ userId: req.user.id, name: req.user.name, joinedAt: new Date() });
    await lobby.save();
  }
  res.json({ ok: true });
}

export async function readyUp(req, res) {
  const lobby = await Lobby.findOne({ code: req.params.code });
  if (!lobby) return res.status(404).json({ message: "Lobby not found" });

  lobby.players = lobby.players.map(p =>
    p.userId === req.user.id ? { ...p.toObject(), ready: true } : p
  );
  await lobby.save();
  res.json({ ok: true });
}

export async function startMatch(req, res) {
  const lobby = await Lobby.findOne({ code: req.params.code });
  if (!lobby) return res.status(404).json({ message: "Lobby not found" });
  if (lobby.hostUserId !== req.user.id) return res.status(403).json({ message: "Host only" });

  lobby.status = "in_progress";
  await lobby.save();

  const textId = req.body.textId || "default";
  const match = await Match.create({ lobbyCode: lobby.code, textId, startedAt: new Date(), results: [] });
  res.json({ matchId: match._id });
}
