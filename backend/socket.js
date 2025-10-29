import { Server } from "socket.io";
import jwt from "jsonwebtoken";

let io;

export function initSocket(server, corsOrigin) {
  io = new Server(server, {
    cors: { origin: corsOrigin, methods: ["GET","POST"], credentials: true }
  });

  io.use((socket, next) => {
    try {
      const h = socket.handshake.headers?.authorization || "";
      const tokenHeader = h.startsWith("Bearer ") ? h.slice(7) : null;
      const token = socket.handshake.auth?.token || tokenHeader;
      if (!token) return next(new Error("Unauthorized"));
      const p = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = { id: p.id, email: p.email, username: p.username };
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("lobby:subscribe", ({ code }) => {
      if (!code) return;
      socket.join(`lobby:${code.toUpperCase()}`);
      io.to(`lobby:${code.toUpperCase()}`).emit("lobby:presence", { type: "join", userId: socket.user.id });
    });

    socket.on("lobby:unsubscribe", ({ code }) => {
      if (!code) return;
      socket.leave(`lobby:${code.toUpperCase()}`);
      io.to(`lobby:${code.toUpperCase()}`).emit("lobby:presence", { type: "leave", userId: socket.user.id });
    });
  });

  return io;
}

export function getIO() {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
}
