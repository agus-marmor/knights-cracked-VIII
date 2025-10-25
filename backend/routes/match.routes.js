import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as match from "../controllers/match.controller.js";

const r = Router();
r.get("/:code/current", requireAuth, match.getCurrentMatch);      // GET  /api/matches/:code/current
r.post("/:code/progress", requireAuth, match.submitProgress);     // POST /api/matches/:code/progress
r.post("/:code/finish", requireAuth, match.finish);               // POST /api/matches/:code/finish
r.get("/:code/leaderboard", requireAuth, match.leaderboard);      // GET  /api/matches/:code/leaderboard
export default r;
