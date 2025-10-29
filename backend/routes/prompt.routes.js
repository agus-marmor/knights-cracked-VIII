import express from "express";
import auth from "../middleware/auth.js";
import { getRandomPrompt, assignMatchPrompt } from "../controllers/prompt.controller.js";

const router = express.Router();

router.get("/prompts", getRandomPrompt);              // e.g. GET /api/prompts?count=100
router.post("/matches/:code/prompt", auth, assignMatchPrompt);

export default router;