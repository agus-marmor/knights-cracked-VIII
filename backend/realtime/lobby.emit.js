// realtime/lobby.emit.js
import Lobby from "../models/Lobby.js";
import { getIO } from "../socket.js";
<<<<<<< HEAD

// Loads fresh lobby and emits to its room
export async function emitLobbySnapshot(code) {
  const lobby = await Lobby.findOne({ code: code.toUpperCase() });
  if (!lobby) return;
  const io = getIO();
  io.to(`lobby:${code.toUpperCase()}`).emit("lobby:update", lobby);
=======
import { publicLobbyView } from "../utils/lobby.view.js";

export async function emitLobbySnapshot(code) {
  const lobby = await Lobby.findOne({ code: code.toUpperCase() }).lean();
  if (!lobby) return;
  const view = publicLobbyView(lobby);
  getIO().to(`lobby:${code.toUpperCase()}`).emit("lobby:update", view);
>>>>>>> refs/remotes/origin/main
}
