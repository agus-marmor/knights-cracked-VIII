import express from "express";
import { topLeaderboard } from "../controllers/leaderboard.controller.js";

const router = express.Router();
router.get("/", topLeaderboard);

export default router;
