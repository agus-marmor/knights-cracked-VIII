// routes/matches.routes.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as match from "../controllers/match.controller.js";
import { getMatchPrompt } from "../controllers/match.prompt.controller.js";

const r = Router();

// prompt FIRST
r.get("/:code/prompt", requireAuth, getMatchPrompt);

// r.get("/:code/current", requireAuth, match.getCurrentMatch);
// r.post("/:code/progress", requireAuth, match.submitProgress);
r.post("/:code/finish", requireAuth, match.tryFinishMatch);
// r.get("/:code/leaderboard", requireAuth, match.leaderboard);

export default r;
