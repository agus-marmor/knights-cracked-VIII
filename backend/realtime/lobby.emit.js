// realtime/lobby.emit.js
import Lobby from "../models/Lobby.js";
import { getIO } from "../socket.js";
import { publicLobbyView } from "../utils/lobby.view.js";

export async function emitLobbySnapshot(code) {
  const lobby = await Lobby.findOne({ code: code.toUpperCase() }).lean();
  if (!lobby) return;
  const view = publicLobbyView(lobby);
  getIO().to(`lobby:${code.toUpperCase()}`).emit("lobby:update", view);
}
