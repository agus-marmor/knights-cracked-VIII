// controllers/lobby.controller.js
import crypto from "crypto";
import Lobby from "../models/Lobby.js";
import Match from "../models/Match.js";
import { makePrompt } from "./prompt.controller.js";
import { startCountdown } from "./match.controller.js";
import { publicLobbyView } from "../utils/lobby.view.js";
import { emitLobbySnapshot } from "../realtime/lobby.emit.js"; // already importing elsewhere
import { getIO } from "../socket.js";

const VALID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing O/0/I/1
const CODE_LEN = 5;

const genCode = () =>
  Array.from({ length: CODE_LEN }, () => VALID_CHARS[Math.floor(Math.random() * VALID_CHARS.length)]).join("");

const isValidCharacter = (c) => c === "mech" || c === "kaiju";

export async function createLobby(req, res) {
  // --- Log Entry ---
  console.log("[createLobby] Request received. User:", req.user?.username, "Body:", req.body);

  try {
    const { character, maxPlayers } = req.body || {};

    // --- Log Validation ---
    console.log(`[createLobby] Validating character: ${character}`);
    if (!isValidCharacter(character)) {
      console.error("[createLobby] Invalid character provided:", character);
      return res.status(400).json({ message: "Character must be 'mech' or 'kaiju'." }); // Or alpha/beta?
    }

    // --- Log Code Generation ---
    let code = genCode(), tries = 5;
    let codeFound = false;
    console.log(`[createLobby] Attempting to generate unique code...`);
    while (tries--) {
      const exists = await Lobby.exists({ code });
      if (!exists) {
        codeFound = true;
        console.log(`[createLobby] Unique code found: ${code}`);
        break;
      }
      console.log(`[createLobby] Code collision for ${code}, retrying...`);
      code = genCode();
    }

    if (!codeFound) {
      console.error("[createLobby] Failed to generate a unique code after multiple tries.");
      throw new Error("Could not generate unique lobby code."); // Throw error to be caught below
    }
    // --- End Code Generation ---

    const lobbyData = {
      code,
      hostUserId: req.user.id,
      maxPlayers: Math.min(Math.max(Number(maxPlayers || 2), 2), 8), // Ensure this resolves correctly
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
      status: "open", // Explicitly set status
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
    };

    // --- Log Before Create ---
    console.log("[createLobby] Attempting to create lobby document with data:", lobbyData);

    const lobby = await Lobby.create(lobbyData);

    // --- Log After Create ---
    console.log(`[createLobby] Lobby document created successfully! ID: ${lobby._id}, Code: ${lobby.code}`);

    // --- Broadcast Update ---
    const io = getIO();
    // Use the newly created 'lobby' object
    await emitLobbySnapshot(lobby.code);
    console.log(`[createLobby] Broadcasted initial lobby update for ${lobby.code}`);
    // --- End Broadcast ---

    return res.json({ code: lobby.code });

  } catch (err) {
    // --- Log Error ---
    console.error("[createLobby] CRITICAL ERROR:", err); // Log the full error
    return res.status(500).json({ message: err.message || "Could not create lobby due to server error" });
  }
}

export async function getLobby(req, res) {
  const { code } = req.params;
  const lobby = await Lobby.findOne({ code: code.toUpperCase() }).lean();
  if (!lobby) return res.status(404).json({ message: "Lobby not found" });
  return res.json(publicLobbyView(lobby));
}
export async function joinLobby(req, res) {
  console.log("JOIN LOBBY ROUTE HIT");
  try {
    const { code } = req.params;
    const upCode = code.toUpperCase();
    console.log(`[joinLobby ${upCode}] 1. Starting join process for user ${req.user.username}`);

    // 1) Load lobby to check status, capacity, and host character
    const initialLobby = await Lobby.findOne({ code: upCode, status: "open" }).lean(); // Use lean for read-only checks

    if (!initialLobby) {
      console.log(`[joinLobby ${upCode}] 2a. Failed: Lobby not found or not open.`);
      return res.status(400).json({ message: "Invalid or closed lobby." });
    }
    console.log(`[joinLobby ${upCode}] 2b. Initial lobby found.`);

    // Check if user is already in the players array
    if (initialLobby.players.some(p => p.userId.toString() === req.user.id)) {
      console.log(`[joinLobby ${upCode}] 3a. Failed: User ${req.user.username} already in lobby.`);
      return res.status(400).json({ message: "Already in this lobby." });
    }
    console.log(`[joinLobby ${upCode}] 3b. User not already in lobby.`);

    // Check if lobby is full
    if (initialLobby.players.length >= initialLobby.maxPlayers) {
      console.log(`[joinLobby ${upCode}] 4a. Failed: Lobby full (${initialLobby.players.length}/${initialLobby.maxPlayers}).`);
      return res.status(400).json({ message: "Lobby is full." });
    }
    console.log(`[joinLobby ${upCode}] 4b. Lobby has capacity.`);

    // Find host's character to assign the opposite
    const hostPlayer = initialLobby.players.find(p => p.userId.toString() === initialLobby.hostUserId.toString());
    if (!hostPlayer || !hostPlayer.character) {
      console.log(`[joinLobby ${upCode}] 5a. Failed: Host character not set.`);
      return res.status(400).json({ message: "Host character not selected yet." });
    }
    console.log(`[joinLobby ${upCode}] 5b. Host character found: ${hostPlayer.character}.`);
    const characterToAssign = hostPlayer.character === "mech" ? "kaiju" : "mech";
    console.log(`[joinLobby ${upCode}] 5c. Assigning character: ${characterToAssign}`);

    // 2) Attempt atomic join using findOneAndUpdate with guards
    console.log(`[joinLobby ${upCode}] 6. Attempting atomic update to add player ${req.user.username}...`);
    const updatedLobbyDoc = await Lobby.findOneAndUpdate(
      {
        code: upCode,
        status: "open", // Re-check status
        $expr: { $lt: [{ $size: "$players" }, "$maxPlayers"] }, // Re-check capacity
        "players.userId": { $ne: req.user.id } // Re-check user not already present
      },
      {
        $push: {
          players: {
            userId: req.user.id,
            username: req.user.username,
            character: characterToAssign,
            ready: false,
            joinedAt: new Date(),
            lastSeenAt: new Date()
          }
        },
        // Optionally update expiresAt to keep lobby alive longer
        // $set: { expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) }
      },
      { new: true } // Return the updated document after the push
    );

    // Check if the update succeeded
    if (!updatedLobbyDoc) {
      console.log(`[joinLobby ${upCode}] 7a. Failed: Atomic update returned null. Lobby might be full/closed or user joined simultaneously.`);
      // Fetch lobby again to provide a more specific reason if possible
      const currentLobbyState = await Lobby.findOne({ code: upCode }).lean();
      if (!currentLobbyState || currentLobbyState.status !== 'open') {
        return res.status(400).json({ message: "Lobby is closed." });
      }
      if (currentLobbyState.players.length >= currentLobbyState.maxPlayers) {
        return res.status(400).json({ message: "Lobby became full." });
      }
      if (currentLobbyState.players.some(p => p.userId.toString() === req.user.id)) {
        return res.status(400).json({ message: "Already joined (race condition)." });
      }
      return res.status(400).json({ message: "Cannot join lobby now. Please refresh." });
    }
    console.log(`[joinLobby ${upCode}] 7b. Player ${req.user.username} added successfully via findOneAndUpdate.`);

    // 3) Broadcast the update via Socket.IO
    await emitLobbySnapshot(upCode);
    return res.json({ ok: true, character: characterToAssign });

  } catch (err) {
    console.error(`[joinLobby ${req.params.code?.toUpperCase()}] CRITICAL ERROR:`, err);
    return res.status(500).json({ message: err.message || "Join failed due to server error" });
  }
}
export async function leaveLobby(req, res) {
  try {
    const { code } = req.params;
    const upCode = code.toUpperCase();
    let lobby = await Lobby.findOneAndUpdate(
      { code: upCode, "players.userId": req.user.id },
      { $pull: { players: { userId: req.user.id } } },
      { new: true }
    );

    if (!lobby) return res.status(404).json({ message: "Lobby not found or not a member" });

    let hostChanged = false;

    if (lobby.hostUserId.toString() === req.user.id && lobby.players.length > 0) {
      lobby.hostUserId = lobby.players[0].userId;
      await lobby.save();
      hostChanged = true;
    }


    const io = getIO();
    // Fetch again or use the updated 'lobby' object if save wasn't needed or already done
    const finalLobbyState = hostChanged ? lobby.toObject() : await Lobby.findById(lobby._id).lean(); // Get lean object for view
    await emitLobbySnapshot(upCode);



    // (If zero players remain, TTL index on MongoDB will delete the lobby)
    return res.json({ ok: true, hostUserId: lobby.hostUserId }); // Return new host ID
  } catch (err) {
    console.error("[leaveLobby]", err);
    return res.status(500).json({ message: "Leave failed" });
  }
}

export const readyUp = async (req, res) => {
  const lobbyCode = req.params.code.toUpperCase();
  const userId = req.user.id;

  try {
    // --- Update readiness in Database ---
    const lobby = await Lobby.findOneAndUpdate(
      { code: lobbyCode, "players.userId": userId },
      { $set: { "players.$.ready": true } },
      { new: true } // Return the updated document
    ).lean(); // Use lean for performance if just reading

    if (!lobby) {
      return res.status(404).json({ message: "Lobby or player not found" });
    }

    // --- Broadcast the update via Socket.IO ---
    const io = getIO(); // Get the initialized io instance
    await emitLobbySnapshot(lobbyCode);

    // --- Check if game should start (optional, could be in a separate /start route) ---
    const allReady = lobby.players.length === lobby.maxPlayers && lobby.players.every(p => p.ready);
    if (allReady) {
      // Call start match logic here or handle via /start endpoint
      // createMatchAndStartCountdown(io, lobbyCode, lobby);
    }

    // Respond to the HTTP request
    await emitLobbySnapshot(lobbyCode);
    res.status(200).json({ message: "Player ready status updated" });

  } catch (error) {
    console.error("Ready Up Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export async function unready(req, res) {
  try {
    const upCode = (req.params.code || "").toUpperCase();
    const userId = req.user.id;

    const lobby = await Lobby.findOneAndUpdate(
      { code: upCode, "players.userId": userId },
      { $set: { "players.$.ready": false, "players.$.lastSeenAt": new Date() } },
      { new: true }
    );

    if (!lobby) {
      return res.status(404).json({ message: "Lobby or player not found" });
    }

    await emitLobbySnapshot(upCode); // broadcast once
    return res.json(publicLobbyView(lobby.toObject())); // return updated snapshot for immediate UI update
  } catch (err) {
    console.error("[unready]", err);
    return res.status(500).json({ message: "Unready failed" });
  }
}


export async function startMatch(req, res) {
  const upCode = (req.params.code || "").toUpperCase();
  const hostUserId = req.user.id;

  try {
    const lobby = await Lobby.findOne({ code: upCode });
    if (!lobby) return res.status(404).json({ message: "Lobby not found" });
    if (String(lobby.hostUserId) !== String(hostUserId)) {
      return res.status(403).json({ message: "Only the host can start the match" });
    }
    if (lobby.status !== "open") {
      const existing = await Match.findOne({ code: upCode }).sort({ createdAt: -1 }).lean();
      return res.status(409).json({
        message: "Lobby is not open",
        matchId: existing?._id,
        status: lobby.status,
      });
    }
    if (lobby.players.length < 2) {
      return res.status(400).json({ message: "Need at least 2 players" });
    }
    if (!lobby.players.every(p => p.ready)) {
      return res.status(400).json({ message: "Not all players are ready" });
    }

    // If something already started, reuse it
    let active = await Match.findOne({
      code: upCode,
      status: { $in: ["countdown", "playing"] },
    }).sort({ createdAt: -1 });
    const io = getIO();

    if (active) {
      io.to(`lobby:${upCode}`).emit("match:created", { code: upCode, matchId: active._id });
      return res.status(200).json({ ok: true, message: "Match already active", gameId: upCode, matchId: active._id });
    }

    // Create new match
    const promptText = makePrompt(100);
    console.log(promptText);
    active = await Match.create({
      code: upCode,
      lobbyId: lobby._id,
      status: "countdown",
      promptText,
      players: lobby.players.map(p => ({
        userId: p.userId,
        username: p.username,
        character: p.character,
        wpm: 0, accuracy: 100, charsTyped: 0, errors: 0, finished: false, finishedAt: null,
      })),
    });

    lobby.status = "in_progress";
    lobby.currentMatchId = active._id;
    await lobby.save();

    await emitLobbySnapshot(upCode);
    io.to(`lobby:${upCode}`).emit("match:created", { code: upCode, matchId: active._id });

    setTimeout(() => startCountdown(io, upCode, active._id), 800);

    return res.status(200).json({ ok: true, message: "Match starting…", gameId: upCode, matchId: active._id });
  } catch (err) {
    console.error("[startMatch]", err);
    try {
      await Lobby.updateOne(
        { code: upCode, status: "in_progress" },
        { $set: { status: "open", currentMatchId: null } }
      );
    } catch (revertErr) {
      console.error("[startMatch] revert failed:", revertErr);
    }
    return res.status(500).json({ message: "Failed to start match" });
  }
}


export async function kickPlayer(req, res) {
  try {
    const { code } = req.params;
    const upCode = code.toUpperCase();
    const { userId: userIdToKick } = req.body || {};

    if (!userIdToKick) {
      return res.status(400).json({ message: "User ID to kick is required." });
    }

    const lobby = await Lobby.findOne({ code: upCode });

    if (!lobby) return res.status(404).json({ message: "Lobby not found" });
    // Ensure user making request is the host
    if (lobby.hostUserId.toString() !== req.user.id) return res.status(403).json({ message: "Only the host can kick players" });
    // Prevent host from kicking themselves via this route
    if (userIdToKick === req.user.id) return res.status(400).json({ message: "Host cannot kick themselves." });


    // Filter out the player
    const originalPlayerCount = lobby.players.length;
    lobby.players = lobby.players.filter((p) => p.userId.toString() !== userIdToKick);

    // Save only if a player was actually removed
    if (lobby.players.length < originalPlayerCount) {
      await lobby.save();

      // --- Broadcast Update --- 📡
      const io = getIO();
      const updatedLobbyState = await Lobby.findById(lobby._id).lean();
      await emitLobbySnapshot(upCode);

      // --- (Optional) Notify the kicked player ---
      // You'd need a way to map userIdToKick back to their socket ID if they are connected
      // const kickedSocket = findSocketByUserId(userIdToKick);
      // if (kickedSocket) {
      //   kickedSocket.emit("kicked", { lobbyCode: upCode, reason: "Kicked by host." });
      //   kickedSocket.leave(`lobby:${upCode}`);
      // }
      // --- End Notify Kicked ---

    } else {
      // Player to kick wasn't found in the lobby
      return res.status(404).json({ message: "Player not found in this lobby." });
    }

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
