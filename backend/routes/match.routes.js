// routes/matches.routes.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as matchCtrl from "../controllers/match.controller.js";
import { getMatchPrompt } from "../controllers/match.prompt.controller.js";
import Match from "../models/Match.js";
import { tryFinishMatch, publicMatchView } from "../controllers/match.controller.js";
import { getIO } from "../socket.js";

const r = Router();

// prompt FIRST
r.get("/:code/prompt", requireAuth, getMatchPrompt);

r.post("/:code/finish", requireAuth, async (req, res) => {
  const code = (req.params.code || "").toUpperCase();
  const userId = req.user.id;

  try {
    const match = await Match.findOne({ code });
    if (!match) return res.status(404).json({ error: "Match not found" });
    if (match.status !== "playing") return res.status(400).json({ error: "Match already finished" });

    // Find player
    const player = match.players.find(p => String(p.userId) === String(userId));
    if (!player) return res.status(403).json({ error: "Not a participant" });

    if (!player.finished) {
      player.finished = true;
      player.finishedAt = new Date();

      // compute final server-side wpm/accuracy here (mirror controller logic)
      if (match.startedAt) {
        const elapsedMs = Date.now() - new Date(match.startedAt).getTime();
        const minutes = elapsedMs / 60000;
        const chars = player.charsTyped ?? 0;
        player.wpm = minutes > 0 ? Math.round(chars / 5 / minutes) : 0;
      } else {
        player.wpm = player.wpm ?? 0;
      }

      if (typeof player.charsTyped === "number" && typeof player.errors === "number") {
        player.accuracy = player.charsTyped > 0 ? Math.round(Math.max(0, 100 * (1 - (player.errors ?? 0) / player.charsTyped))) : 100;
      } else {
        player.accuracy = player.accuracy ?? 100;
      }

      await match.save();

      // Trigger finish check and broadcast via server helpers
      await tryFinishMatch(getIO(), match, code);
    }

    return res.json({ success: true, match: publicMatchView(match) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default r;
