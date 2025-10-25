import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as lobby from "../controllers/lobby.controller.js";

const r = Router();
r.post("/", requireAuth, lobby.createLobby);            // POST /api/lobbies
r.get("/:code", requireAuth, lobby.getLobby);           // GET  /api/lobbies/:code
r.post("/:code/join", requireAuth, lobby.joinLobby);    // POST /api/lobbies/:code/join
r.post("/:code/ready", requireAuth, lobby.readyUp);     // POST /api/lobbies/:code/ready
r.post("/:code/start", requireAuth, lobby.startMatch);  // POST /api/lobbies/:code/start
export default r;
