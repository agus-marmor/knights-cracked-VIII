// realtime/lobby.emit.js
import Lobby from "../models/Lobby.js";
import { getIO } from "../socket.js";

// Loads fresh lobby and emits to its room
export async function emitLobbySnapshot(code) {
  const lobby = await Lobby.findOne({ code: code.toUpperCase() });
  if (!lobby) return;
  const io = getIO();
  io.to(`lobby:${code.toUpperCase()}`).emit("lobby:update", lobby);
}
