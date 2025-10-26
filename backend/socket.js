import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import "dotenv/config";
import { publicLobbyView } from "./utils/lobby.view.js";
import Lobby from "./models/Lobby.js";
import Match from "./models/Match.js";
import mongoose from "mongoose";
import { publicMatchView } from "./utils/match.views.js";
import {
  emitMatchSnapshot,
  startCountdown,
  tryFinishMatch,
  hardFinish,
  handlePlayerProgress,
  handlePlayerFinish
} from "./controllers/match.controller.js";

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
      const tokenAuth = socket.handshake.auth?.token || null;
      const tokenQuery = socket.handshake.query?.token || null;

      const token = tokenQuery || tokenAuth || tokenHeader;
      console.log("[Socket Auth] Token found:", token ? "Yes" : "No");

      if (!token) {
        console.error("[Socket Auth] Failed: Missing token");
        return next(new Error("Unauthorized: missing token"));
      }
      console.log("[Socket Auth] Token found, attempting verification...");

      const p = jwt.verify(token, process.env.JWT_SECRET);
      if (!p || typeof p !== 'object' || !p.id || !p.username) {
        console.error("[Socket Auth] Failed: Invalid token payload structure");
        return next(new Error("Unauthorized: Invalid token payload"));
      }

      socket.user = { id: p.id, email: p.email, username: p.username };
      console.log(`[Socket Auth] Success for user: ${socket.user.username} (ID: ${socket.user.id})`);
      next();
    } catch (e) {
      console.error("[Socket Auth] Failed:", e.message);
      return next(new Error("Unauthorized: " + (e?.message || "invalid token")));
    }
  });

  // 🎮 Connection Handler
  io.on("connection", async (socket) => {
    const user = socket.user;
    const lobbyCode = (socket.handshake.query?.lobbyCode)?.toUpperCase();
    const hero = socket.handshake.query?.hero;

    // ✅ Store userId directly on socket for easy access
    socket.userId = user.id;
    socket.username = user.username;

    if (!user || !lobbyCode) {
      console.error(`[Socket Connect] Invalid connection data. User: ${!!user}, LobbyCode: ${lobbyCode}. Disconnecting.`);
      socket.emit("lobbyError", "Invalid connection data.");
      socket.disconnect(true);
      return;
    }

    console.log(`[Socket Connect] User ${user.username} (Socket: ${socket.id}) connecting with code ${lobbyCode}`);

    // Check if this is a match connection or lobby connection
    const match = await Match.findOne({ code: lobbyCode }).lean();

    if (match) {
      console.log(`[Socket Connect] Found MATCH ${lobbyCode}, handling as match connection`);
      // This is a match connection, just subscribe to the match room
      const matchRoom = `match:${lobbyCode}`;
      socket.join(matchRoom);
      socket.currentMatchCode = lobbyCode;
      console.log(`[Socket Connect] User ${user.username} joined match room: ${matchRoom}`);

      // NOTE: do NOT return here — we still need to register event handlers (progress, finish, etc.)
      // Previously returning here prevented registration of listeners for match sockets and caused
      // client emits (match:finish) to time out.
    } else {
      // If not a match, proceed with lobby logic
      const room = `lobby:${lobbyCode}`;
      console.log(`[Socket Connect] No match found, treating as lobby connection for ${lobbyCode}`);

      socket.join(room);
      console.log(`[Socket Connect] Socket ${socket.id} joined room ${room}`);

      // Update Lobby State in DB
      try {
        let lobby = await Lobby.findOne({ code: lobbyCode });
        if (!lobby) {
          console.error(`[Socket Connect] Lobby ${lobbyCode} not found for user ${user.username}. Disconnecting.`);
          socket.emit("lobbyError", `Lobby ${lobbyCode} not found.`);
          socket.disconnect(true);
          return;
        }

        let player = lobby.players.find(p => String(p.userId) === String(user.id));
        if (!player) {
          console.warn(`User ${user.username} connected via socket but not found in DB players array for lobby ${lobbyCode}. Disconnecting.`);
          socket.emit("lobbyError", "Failed to properly join lobby.");
          socket.disconnect(true);
          return;
        }

        const updatedLobbyState = await Lobby.findOne({ code: lobbyCode }).lean();
        if (updatedLobbyState) {
          const publicView = publicLobbyView(updatedLobbyState);
          io.to(room).emit("lobby:update", publicView);
          console.log(`[Socket Connect] Broadcasted lobbyUpdate for ${lobbyCode}`);
        }
      } catch (dbError) {
        console.error(`[Socket Connect] DB Error during connection for ${lobbyCode}:`, dbError);
        socket.emit("lobbyError", "Server error processing lobby join.");
      }
    }

    // ✅ Match Subscribe Handler
    socket.on("match:subscribe", async ({ code }) => {
      const up = (code || "").toUpperCase();
      const room = `match:${up}`;

      console.log(`[Match Subscribe] User ${socket.username} subscribing to match ${up}`);

      socket.join(room);
      socket.currentMatchCode = up;

      try {
        const match = await Match.findOne({ code: up })
          .sort({ createdAt: -1 })
          .lean();

        if (match) {
          socket.emit("match:update", publicMatchView(match));
          console.log(`[Match Subscribe] Sent match state to ${socket.username}, status: ${match.status}`);
        } else {
          socket.emit("match:update", null);
          console.log(`[Match Subscribe] No match found for code ${up}`);
        }
      } catch (err) {
        console.error(`[Match Subscribe] Error:`, err);
        socket.emit("match:update", null);
      }
    });

    // REPLACE the large inline progress handler with delegation to controller
    socket.on("progress:update", async (payload, ack) => {
      try {
        if (!payload || !payload.code) {
          console.error("[progress:update] Missing payload or code");
          if (typeof ack === "function") ack({ ok: false, error: "Missing code" });
          return;
        }

        // Attach socket user info (server trusts socket.user)
        payload.userId = socket.userId;
        payload.username = socket.username;

        console.log(`[progress:update] Delegating to controller for match ${payload.code} user ${socket.username}`);

        await handlePlayerProgress(io, payload.code, payload);

        if (typeof ack === "function") ack({ ok: true });
      } catch (err) {
        console.error("[progress:update] Error delegating to controller:", err);
        if (typeof ack === "function") ack({ ok: false, error: err.message });
      }
    });

    // NEW: explicit finish event (clients can call this to get a reliable ack)
    socket.on("match:finish", async (payload, ack) => {
      try {
        if (!payload || !payload.code) {
          if (typeof ack === "function") ack({ ok: false, error: "Missing code" });
          return;
        }
        payload.userId = socket.userId;
        payload.username = socket.username;

        console.log(`[match:finish] Received finish from ${socket.username} for ${payload.code}`);

        await handlePlayerFinish(io, payload.code, payload);

        if (typeof ack === "function") ack({ ok: true });
      } catch (err) {
        console.error("[match:finish] Error handling finish:", err);
        if (typeof ack === "function") ack({ ok: false, error: err.message });
      }
    });

    // Match Unsubscribe Handler
    socket.on("match:unsubscribe", ({ code }) => {
      if (!code) return;
      const room = `match:${code.toUpperCase()}`;
      socket.leave(room);
      console.log(`[Match Unsubscribe] User ${socket.username} left ${room}`);
    });

    // Lobby Unsubscribe Handler
    socket.on("lobby:unsubscribe", ({ code }) => {
      if (!code) return;
      const room = `lobby:${code.toUpperCase()}`;
      socket.leave(room);
      io.to(room).emit("lobby:presence", {
        type: "leave",
        userId: socket.user.id
      });
    });

    // Disconnect Handler
    socket.on("disconnecting", async (reason) => {
      console.log(`[Socket Disconnect] User ${user?.username} (Socket: ${socket.id}) disconnecting from ${lobbyCode}. Reason: ${reason}`);

      if (!user?.id) {
        console.warn(`[Socket Disconnect] User data missing on disconnect for socket ${socket.id}`);
        return;
      }

      try {
        const lobby = await Lobby.findOneAndUpdate(
          { code: lobbyCode },
          { $pull: { players: { userId: user.id } } },
          { new: true }
        );

        if (lobby) {
          console.log(`[Socket Disconnect] Player ${user.username} removed from lobby ${lobbyCode} players array.`);
          let hostTransferred = false;

          if (lobby.hostUserId && String(lobby.hostUserId) === String(user.id) && lobby.players.length > 0) {
            lobby.hostUserId = lobby.players[0].userId;
            await lobby.save();
            hostTransferred = true;
            console.log(`[Socket Disconnect] Host transferred in lobby ${lobbyCode} to ${lobby.hostUserId}`);
          }

          const finalLobbyState = hostTransferred ? await Lobby.findById(lobby._id).lean() : lobby.toObject();
          io.to(room).emit("lobby:update", publicLobbyView(finalLobbyState));
          console.log(`[Socket Disconnect] Broadcasted lobbyUpdate for ${lobbyCode} after ${user.username} left.`);

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
    });
  });

  return io;
}



export function getIO() {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
}

// Re-export controller-backed helpers
export { startCountdown, emitMatchSnapshot };