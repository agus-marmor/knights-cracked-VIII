// controllers/match.prompt.controller.js
import Lobby from "../models/Lobby.js";
import Match from "../models/Match.js";

export async function getMatchPrompt(req, res) {
  try {
    const code = (req.params.code || "").toUpperCase();
    const userId = req.user.id;

    // Prefer the lobby's current match if available
    const lobby = await Lobby.findOne({ code }, { currentMatchId: 1 }).lean();

    let match;
    if (lobby?.currentMatchId) {
      match = await Match.findById(lobby.currentMatchId).lean();
    }
    if (!match) {
      // Fallback: get the most recent match for this code
      match = await Match.findOne({ code }).sort({ createdAt: -1 }).lean();
    }
    if (!match) return res.status(404).json({ message: "No match found for this code." });

    // Security: only players in the match can read the prompt
    const isPlayer = (match.players || []).some(p => String(p.userId) === String(userId));
    if (!isPlayer) return res.status(403).json({ message: "Not a participant in this match." });

    // Return minimal payload
    return res.json({
      code: match.code,
      matchId: match._id,
      status: match.status,          // "countdown" | "playing" | "finished"
      promptText: match.promptText || "",
      startedAt: match.startedAt ?? null,
    });
  } catch (err) {
    console.error("[getMatchPrompt]", err);
    return res.status(500).json({ message: "Failed to fetch prompt." });
  }
}
