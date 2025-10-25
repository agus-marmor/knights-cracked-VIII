// routes/lobby.routes.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createLobby,
  getLobby,
  joinLobby,
  leaveLobby,
  readyUp,
  unready,
  startMatch,
  kickPlayer,
  heartbeat
} from "../controllers/lobby.controller.js";

const r = Router();

r.post("/", requireAuth, createLobby);
r.get("/:code", requireAuth, getLobby);
r.post("/:code/join", requireAuth, joinLobby);
r.post("/:code/leave", requireAuth, leaveLobby);
r.post("/:code/ready", requireAuth, readyUp);
r.post("/:code/unready", requireAuth, unready);
r.post("/:code/start", requireAuth, startMatch);
r.post("/:code/kick", requireAuth, kickPlayer);
r.post("/:code/heartbeat", requireAuth, heartbeat);

export default r;
