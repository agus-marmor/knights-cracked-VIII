// controllers/lobby.controller.js
import crypto from "crypto";
import Lobby from "../models/Lobby.js";

import { publicLobbyView } from "../utils/lobby.view.js";
import { emitLobbySnapshot } from "../realtime/lobby.emit.js"; // already importing elsewhere


const VALID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing O/0/I/1
const CODE_LEN = 5;

const genCode = () =>
  Array.from({ length: CODE_LEN }, () => VALID_CHARS[Math.floor(Math.random() * VALID_CHARS.length)]).join("");

const isValidCharacter = (c) => c === "mech" || c === "kaiju";

export async function createLobby(req, res) {
  try {
    const { character, maxPlayers } = req.body || {};
    if (!isValidCharacter(character)) {
      return res.status(400).json({ message: "character must be 'mech' or 'kaiju'." });
    }

    // generate a unique 5-char code (retry a few times on rare collision)
    let code = genCode(), tries = 5;
    while (tries--) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await Lobby.exists({ code });
      if (!exists) break;
      code = genCode();
    }

    const lobby = await Lobby.create({
      code,
      hostUserId: req.user.id,
      maxPlayers: Math.min(Math.max(Number(maxPlayers || 2), 2), 8),
      players: [
        {
          userId: req.user.id,
          username: req.user.username,
          character,
          ready: false,
          joinedAt: new Date(),
          lastSeenAt: new Date()
        }
      ],
      // auto-expire in 2 hours
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
    });

    // emit with the actual code
    await emitLobbySnapshot(lobby.code);

    return res.json({ code: lobby.code });
  } catch (err) {
    console.error("[createLobby]", err);
    return res.status(500).json({ message: "Could not create lobby" });
  }
}

export async function getLobby(req, res) {
  const { code } = req.params;
  const lobby = await Lobby.findOne({ code: code.toUpperCase() }).lean();
  if (!lobby) return res.status(404).json({ message: "Lobby not found" });
  return res.json(publicLobbyView(lobby));
}

export async function joinLobby(req, res) {
  try {
    const { code } = req.params;
    const upCode = code.toUpperCase();

    // 1) Load lobby to see host's character
    const lobby = await Lobby.findOne({ code: upCode, status: "open" }).lean();
    if (!lobby) return res.status(400).json({ message: "Invalid or closed lobby." });

    // Already joined?
    if (lobby.players.some(p => p.userId === req.user.id)) {
      return res.status(400).json({ message: "Already in this lobby." });
    }

    // Capacity check
    if (lobby.players.length >= lobby.maxPlayers) {
      return res.status(400).json({ message: "Lobby is full." });
    }

    // Find host's character
    const hostPlayer = lobby.players.find(p => p.userId === lobby.hostUserId);
    if (!hostPlayer || !hostPlayer.character) {
      return res.status(400).json({ message: "Host has not selected a character yet." });
    }

    // 2) Pick the opposite character
    const character = hostPlayer.character === "mech" ? "kaiju" : "mech";

    // 3) Atomic join with guards (status, capacity, not already in)
    const updated = await Lobby.findOneAndUpdate(
      {
        code: upCode,
        status: "open",
        $expr: { $lt: [{ $size: "$players" }, "$maxPlayers"] },
        "players.userId": { $ne: req.user.id }
      },
      {
        $push: {
          players: {
            userId: req.user.id,
            username: req.user.username,
            character,
            ready: false,
            joinedAt: new Date(),
            lastSeenAt: new Date()
          }
        },
        $set: { expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) }
      },
      { new: true }
    );

    if (!updated) {
      // If this fails, someone likely filled or closed the lobby between reads
      return res.status(400).json({ message: "Cannot join now (full, closed, or race condition). Try again." });
    }

    // 5) Live update
    await emitLobbySnapshot(upCode);

    return res.json({ ok: true, character }); // return assigned character for UI if you want
  } catch (err) {
    console.error("[joinLobby]", err);
    return res.status(500).json({ message: "Join failed" });
  }
}

export async function leaveLobby(req, res) {
  try {
    const { code } = req.params;
    let lobby = await Lobby.findOneAndUpdate(
      { code: code.toUpperCase(), "players.userId": req.user.id },
      { $pull: { players: { userId: req.user.id } } },
      { new: true }
    );
    if (!lobby) return res.status(404).json({ message: "Lobby not found or not a member" });

    // Host transfer if host leaves and others remain
    if (lobby.hostUserId === req.user.id && lobby.players.length > 0) {
      lobby.hostUserId = lobby.players[0].userId;
      await lobby.save();
    }
    // (If zero players remain, TTL will delete the lobby soon.)
    return res.json({ ok: true, hostUserId: lobby.hostUserId });
  } catch (err) {
    console.error("[leaveLobby]", err);
    return res.status(500).json({ message: "Leave failed" });
  }
}

export async function readyUp(req, res) {
  try {
    const { code } = req.params;
    const lobby = await Lobby.findOne({ code: code.toUpperCase() });
    if (!lobby) return res.status(404).json({ message: "Lobby not found" });

    lobby.players = lobby.players.map((p) =>
      p.userId === req.user.id ? { ...p.toObject(), ready: true, lastSeenAt: new Date() } : p
    );

    await lobby.save();
    return res.json({ ok: true });
  } catch (err) {
    console.error("[readyUp]", err);
    return res.status(500).json({ message: "Ready failed" });
  }
}

export async function unready(req, res) {
  try {
    const { code } = req.params;
    const lobby = await Lobby.findOne({ code: code.toUpperCase() });
    if (!lobby) return res.status(404).json({ message: "Lobby not found" });

    lobby.players = lobby.players.map((p) =>
      p.userId === req.user.id ? { ...p.toObject(), ready: false, lastSeenAt: new Date() } : p
    );

    await lobby.save();
    return res.json({ ok: true });
  } catch (err) {
    console.error("[unready]", err);
    return res.status(500).json({ message: "Unready failed" });
  }
}

export async function startMatch(req, res) {
  try {
    const { code } = req.params;
    const lobby = await Lobby.findOne({ code: code.toUpperCase() });
    if (!lobby) return res.status(404).json({ message: "Lobby not found" });
    if (lobby.hostUserId !== req.user.id) return res.status(403).json({ message: "Host only" });
    if (lobby.players.length < 2) return res.status(400).json({ message: "Need at least 2 players" });

    const allReady = lobby.players.every((p) => p.ready);
    if (!allReady) return res.status(400).json({ message: "All players must be ready" });

    lobby.status = "in_progress";
    await lobby.save();

    // TODO: create Match document here and set lobby.currentMatchId if you’re tracking rounds
    return res.json({ ok: true /*, matchId: match._id */ });
  } catch (err) {
    console.error("[startMatch]", err);
    return res.status(500).json({ message: "Start failed" });
  }
}

export async function kickPlayer(req, res) {
  try {
    const { code } = req.params;
    const { userId } = req.body || {};
    const lobby = await Lobby.findOne({ code: code.toUpperCase() });
    if (!lobby) return res.status(404).json({ message: "Lobby not found" });
    if (lobby.hostUserId !== req.user.id) return res.status(403).json({ message: "Host only" });

    lobby.players = lobby.players.filter((p) => p.userId !== userId);
    await lobby.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error("[kickPlayer]", err);
    return res.status(500).json({ message: "Kick failed" });
  }
}

export async function heartbeat(req, res) {
  try {
    const { code } = req.params;
    await Lobby.updateOne(
      { code: code.toUpperCase(), "players.userId": req.user.id },
      { $set: { "players.$.lastSeenAt": new Date() } }
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("[heartbeat]", err);
    return res.status(500).json({ message: "Heartbeat failed" });
  }
}
