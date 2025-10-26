
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import "dotenv/config";
import { publicLobbyView } from "./utils/lobby.view.js";
import Lobby from "./models/Lobby.js";
import Match from "./models/Match.js";
import mongoose from "mongoose";
import { publicMatchView } from "./utils/match.views.js";

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
    console.log(`[Socket Auth] Trying connection for socket ID: ${socket.id}`);
    console.log("[Socket Auth] Query:", socket.handshake.query);
    console.log("[Socket Auth] Auth:", socket.handshake.auth);
    console.log("[Socket Auth] Headers:", socket.handshake.headers);

    try {
      const h = socket.handshake.headers?.authorization || "";
      const tokenHeader = h.startsWith("Bearer ") ? h.slice(7) : null;
      const tokenAuth   = socket.handshake.auth?.token || null;
      const tokenQuery  = socket.handshake.query?.token || null; // Check query

      const token = tokenQuery || tokenAuth || tokenHeader; // Prioritize query/auth
      console.log("[Socket Auth] Token found:", token ? "Yes" : "No");

      if (!token) {
        console.error("[Socket Auth] Failed: Missing token");
        return next(new Error("Unauthorized: missing token"));
      }
      console.log("[Socket Auth] Token found, attempting verification...");

      const p = jwt.verify(token, process.env.JWT_SECRET);
      // Basic check for payload structure
      if (!p || typeof p !== 'object' || !p.id || !p.username) {
         console.error("[Socket Auth] Failed: Invalid token payload structure");
         return next(new Error("Unauthorized: Invalid token payload"));
      }

      // Attach user data to the socket object for later use
      socket.user = { id: p.id, email: p.email, username: p.username };
      console.log(`[Socket Auth] Success for user: ${socket.user.username} (ID: ${socket.user.id})`);
      next(); // Proceed to connection handler
    } catch (e) {
      console.error("[Socket Auth] Failed:", e.message);
      return next(new Error("Unauthorized: " + (e?.message || "invalid token")));
    }
  });


  // 🎮 Lobby Events
  io.on("connection", async (socket) => { // Make handler async
    // Get data attached by middleware and from query
    const user = socket.user;
    const lobbyCode = (socket.handshake.query?.lobbyCode)?.toUpperCase();
    const hero = socket.handshake.query?.hero;

    // Basic validation on connection
    if (!user || !lobbyCode) {
        console.error(`[Socket Connect] Invalid connection data. User: ${!!user}, LobbyCode: ${lobbyCode}. Disconnecting.`);
        socket.emit("lobbyError", "Invalid connection data.");
        socket.disconnect(true);
        return;
    }

    const room = `lobby:${lobbyCode}`;
    console.log(`[Socket Connect] User ${user.username} (Socket: ${socket.id}) connected for lobby ${lobbyCode}`);

    // Join the Socket.IO Room
    socket.join(room);
    console.log(`[Socket Connect] Socket ${socket.id} joined room ${room}`);

    // Update Lobby State in DB (Optional check/update on connect)
    try {
        let lobby = await Lobby.findOne({ code: lobbyCode });
        if (!lobby) {
            console.error(`[Socket Connect] Lobby ${lobbyCode} not found for user ${user.username}. Disconnecting.`);
            socket.emit("lobbyError", `Lobby ${lobbyCode} not found.`);
            socket.disconnect(true);
            return;
        }
        // Ensure player is actually in the lobby (important if join HTTP failed but socket connects)
        let player = lobby.players.find(p => String(p.userId) === String(user.id));
        if (!player) {
             // Handle this case: Maybe the POST /join failed earlier?
             // Option 1: Disconnect them
             console.warn(`User ${user.username} connected via socket but not found in DB players array for lobby ${lobbyCode}. Disconnecting.`);
             socket.emit("lobbyError", "Failed to properly join lobby.");
             socket.disconnect(true);
             return;
             // Option 2: Try adding them now (more complex, needs capacity check etc.)
        }
        // Optionally update player's lastSeenAt or associate socket.id if needed
        //await Lobby.updateOne({ code: lobbyCode, "players.userId": user.id }, { $set: { "players.$.lastSeenAt": new Date() }});


        // Broadcast Updated Lobby State AFTER successful join/verification
        const updatedLobbyState = await Lobby.findOne({ code: lobbyCode }).lean(); // Fetch fresh lean data
        if (updatedLobbyState) {
            const publicView = publicLobbyView(updatedLobbyState);
            io.to(room).emit("lobby:update", publicView); // Broadcast to everyone in the room
            console.log(`[Socket Connect] Broadcasted lobbyUpdate for ${lobbyCode}`);
        }
    } catch (dbError) {
        console.error(`[Socket Connect] DB Error during connection for ${lobbyCode}:`, dbError);
        socket.emit("lobbyError", "Server error processing lobby join.");
        // Consider disconnecting if DB error prevents proper setup
        // socket.disconnect(true);
    }
    socket.on("disconnecting", async (reason) => { // Make async
      console.log(`[Socket Disconnect] User ${user?.username} (Socket: ${socket.id}) disconnecting from ${lobbyCode}. Reason: ${reason}`);
      // Only proceed if user data is available
      if (!user?.id) {
          console.warn(`[Socket Disconnect] User data missing on disconnect for socket ${socket.id}`);
          return;
      }
      // Remove player from DB lobby
      try {
          const lobby = await Lobby.findOneAndUpdate(
              { code: lobbyCode },
              { $pull: { players: { userId: user.id } } }, // Remove player by userId
              { new: true } // Get updated lobby document
          );

          if (lobby) {
              console.log(`[Socket Disconnect] Player ${user.username} removed from lobby ${lobbyCode} players array.`);
              let hostTransferred = false;
              // Handle host transfer if necessary
              if (lobby.hostUserId && String(lobby.hostUserId) === String(user.id) && lobby.players.length > 0) {
                   lobby.hostUserId = lobby.players[0].userId; // Assign new host
                   await lobby.save(); // Save the change
                   hostTransferred = true;
                   console.log(`[Socket Disconnect] Host transferred in lobby ${lobbyCode} to ${lobby.hostUserId}`);
              }

              // Broadcast the update after removal and potential host transfer
              // Fetch final state as lean object if host was transferred (and saved), otherwise use the result from findOneAndUpdate
              const finalLobbyState = hostTransferred ? await Lobby.findById(lobby._id).lean() : lobby.toObject(); // Use toObject() if not lean
              io.to(room).emit("lobby:update", publicLobbyView(finalLobbyState));
              console.log(`[Socket Disconnect] Broadcasted lobbyUpdate for ${lobbyCode} after ${user.username} left.`);

              // Check if lobby is now empty and potentially delete it (optional, if not using TTL)
              if (lobby.players.length === 0) {
                   console.log(`[Socket Disconnect] Lobby ${lobbyCode} is now empty. Deleting...`);
                   await Lobby.deleteOne({ code: lobbyCode });
                   console.log(`[Socket Disconnect] Lobby ${lobbyCode} deleted.`);
              }

          } else {
               console.log(`[Socket Disconnect] Lobby ${lobbyCode} not found or player ${user.username} already removed during disconnect cleanup.`);
          }
      } catch (disconnectDbError) {
          console.error(`[Socket Disconnect] DB Error during disconnect for ${lobbyCode}:`, disconnectDbError);
      }
    }); // End 'disconnecting' handler

    socket.on("lobby:unsubscribe", ({ code }) => {
      if (!code) return;
      const room = `lobby:${code.toUpperCase()}`;
      socket.leave(room);
      io.to(room).emit("lobby:presence", {
        type: "leave",
        userId: socket.user.id
      });
    });
    socket.on("match:subscribe", async ({ code }) => {
  const up = (code || "").toUpperCase();
  const room = `match:${up}`;

  // OPTIONALLY: verify the user is in the lobby for this code
  socket.join(room);

  // Send the latest match immediately
  const match = await Match.findOne({ code: up })
    .sort({ createdAt: -1 })
    .lean();
  if (match) {
    socket.emit("match:update", publicMatchView(match)); // must include promptText
  } else {
    socket.emit("match:update", null); // your client can handle null gracefully
  }
});

  });

  

  return io;
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
