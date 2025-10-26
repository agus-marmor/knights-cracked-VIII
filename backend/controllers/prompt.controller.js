// controllers/prompt.controller.js
import { generate } from "random-words";
import Match from "../models/Match.js";
import Lobby from "../models/Lobby.js";
import randomWord from "random-word"

/** GET /api/prompts?count=100 */
export async function getRandomPrompt(req, res) {
  try {
    const raw = Number(req.query.count);
    const count = Math.min(Math.max(Number.isFinite(raw) ? Math.trunc(raw) : 100, 10), 500);
    const text = generate({ exactly: count, join: " " });
    return res.json({ count, text });
  } catch (err) {
    console.error("[getRandomPrompt]", err);
    return res.status(500).json({ message: "Could not generate prompt" });
  }
}

export function generatePrompt(wordCount = 100) {
  const count = Math.min(Math.max(wordCount, 10), 500);
  return generate({ exactly: count, join: " " });
}

export function makePrompt(totalWords = 100) {
  console.log("Generated word:ssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssssss")
  const words = [];

  for (let i = 0; i < totalWords; i++) {
    const w = randomWord();
    console.log("Generated word:", w);
    // Fallback if the library returns something weird
    if (typeof w === "string" && w.length > 0) {
      words.push(w.toLowerCase());
    }
  }

  // Build into pseudo-sentences for readability
  const sentences = [];
  let i = 0;
  while (i < words.length) {
    const chunkSize = Math.floor(Math.random() * 8) + 8; // 8–15 words
    const chunk = words.slice(i, i + chunkSize);
    if (chunk.length === 0) break;
    let sentence = chunk.join(" ");
    sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
    sentences.push(sentence);
    i += chunkSize;
  }

  return sentences.join(" ");
}


/** POST /api/matches/:code/prompt */
export async function assignMatchPrompt(req, res) {
  try {
    const code = (req.params.code || "").toUpperCase();
    const lobby = await Lobby.findOne({ code }).lean();
    if (!lobby) return res.status(404).json({ message: "Lobby not found" });

    if (!lobby.players?.some(p => p.userId === req.user.id)) {
      return res.status(403).json({ message: "Not in this lobby" });
    }

    let match = await Match.findOne({ code, status: { $in: ["countdown","playing"] } })
                           .sort({ createdAt: -1 });

    if (!match) {
      match = await Match.create({
        code,
        lobbyId: lobby._id,
        status: "countdown",
        promptText: generate({ exactly: 100, join: " " }), // <-- use generate
        players: lobby.players.map(p => ({ userId: p.userId, username: p.username }))
      });
    } else if (!match.promptText) {
      match.promptText = generate({ exactly: 100, join: " " }); // <-- use generate
      await match.save();
    }

    return res.json({ matchId: match._id, promptText: match.promptText });
  } catch (err) {
    console.error("[assignMatchPrompt]", err);
    return res.status(500).json({ message: "Failed to assign prompt" });
  }
}
