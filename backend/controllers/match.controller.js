  // controllers/match.controller.js
  import Match from "../models/Match.js";
  import { getIO } from "../socket.js";

  function publicMatchView(match) {
    // Ensure working with plain object
    const m = typeof match.toObject === 'function' ? match.toObject() : match;
    if (!m) return null;

    return {
      id: m._id || m.id, // Include match ID
      code: m.code,
      status: m.status, // "countdown", "playing", "finished"
      promptId: m.promptId,
      promptText: m.promptText, // Send the text
      startedAt: m.startedAt,
      endedAt: m.endedAt,
      durationMs: m.durationMs,
      winnerUserId: m.winnerUserId,
      // Map players, potentially excluding sensitive info if needed later
      players: (m.players || []).map(p => ({
        userId: p.userId,
        username: p.username,
        character: p.character, // Include character
        wpm: p.wpm,
        accuracy: p.accuracy,
        charsTyped: p.charsTyped,
        errors: p.errors,
        finished: p.finished,
        finishedAt: p.finishedAt,
        // Exclude internal _id if present
      }))
    };
  }

  export async function emitMatchSnapshot(ioInstance, code, matchIdOrDoc) {
    const up = (code || "").toUpperCase();
    let match = null;

    if (!matchIdOrDoc) { console.error("[emitMatchSnapshot] missing matchIdOrDoc"); return; }

    if (typeof matchIdOrDoc === "string") {
      match = await Match.findById(matchIdOrDoc).lean();
    } else if (matchIdOrDoc && typeof matchIdOrDoc.toObject === "function") {
      match = matchIdOrDoc.toObject();
    } else {
      match = matchIdOrDoc; // assume lean/plain object
    }

    if (!match) {
      console.error(`[emitMatchSnapshot] Match not found for code ${up}`);
      return;
    }

    ioInstance.to(`match:${up}`).emit("match:update", publicMatchView(match));
  }



  // Handles the countdown -> playing transition
  export async function startCountdown(ioInstance, code, matchId, secs = 3) {
    const up = (code || "").toUpperCase();
    const room = `match:${up}`;
    let currentSecs = secs;

    await emitMatchSnapshot(ioInstance, up, matchId);

    const timer = setInterval(async () => {
      ioInstance.to(room).emit("match:countdown", { secs: currentSecs });
      if (currentSecs-- <= 0) {
        clearInterval(timer);
        try {
          const match = await Match.findByIdAndUpdate(
            matchId,
            { $set: { status: "playing", startedAt: new Date() } },
            { new: true }
          ).lean();

          if (match) {
            ioInstance.to(room).emit("match:started", { startedAt: match.startedAt });
            await emitMatchSnapshot(ioInstance, up, match);
            setTimeout(() => hardFinish(ioInstance, up, matchId, "timeout"), 120000);
          } else {
            console.error(`[Countdown ${up}] Match not found after update`);
          }
        } catch (err) {
          console.error(`[Countdown ${up}] Error starting match:`, err);
        }
      }
    }, 1000);
  }

  export async function tryFinishMatch(ioInstance, matchDoc, code) {
    const up = (code || "").toUpperCase();
    if (matchDoc.status !== "playing") return;

    const allFinished = matchDoc.players.every(p => p.finished);
    if (allFinished) {
      finalizeResult(matchDoc, "completed");
      await matchDoc.save();
      ioInstance.to(`match:${up}`).emit("match:finished", publicMatchView(matchDoc));
    }
  }

  export async function hardFinish(ioInstance, code, matchId, reason) {
    const up = (code || "").toUpperCase();
    try {
      const match = await Match.findById(matchId);
      if (!match || match.status === "finished") return;

      finalizeResult(match, reason);
      await match.save();
      ioInstance.to(`match:${up}`).emit("match:finished", publicMatchView(match));
    } catch (err) {
      console.error(`[HardFinish ${up}] Error:`, err);
    }
  }


  // Calculates final results and updates the match document (MUTATES matchDoc)
  function finalizeResult(matchDoc, reason) {
    if (matchDoc.status === 'finished') return matchDoc; // Avoid re-calculating

    matchDoc.status = "finished";
    matchDoc.endedAt = new Date();
    if (matchDoc.startedAt) {
        matchDoc.durationMs = matchDoc.endedAt.getTime() - matchDoc.startedAt.getTime();
    }

    // --- Determine Winner ---
    const finishedPlayers = matchDoc.players.filter(p => p.finished);
    let winner = null;

    if (finishedPlayers.length > 0) {
      // Sort finished players: earliest finish, then accuracy, then WPM
      finishedPlayers.sort((a, b) => {
        const timeA = a.finishedAt?.getTime() ?? Infinity;
        const timeB = b.finishedAt?.getTime() ?? Infinity;
        if (timeA !== timeB) return timeA - timeB;
        if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
        return (b.wpm ?? 0) - (a.wpm ?? 0); // Handle potentially undefined WPM
      });
      winner = finishedPlayers[0];
    } else if (reason === 'timeout' && matchDoc.players.length > 0) {
      // If timeout, sort by chars typed, then accuracy, then WPM
      const sortedByProgress = [...matchDoc.players].sort((a, b) => {
          if ((b.charsTyped ?? 0) !== (a.charsTyped ?? 0)) return (b.charsTyped ?? 0) - (a.charsTyped ?? 0);
          if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
          return (b.wpm ?? 0) - (a.wpm ?? 0);
      });
      winner = sortedByProgress[0];
    } else {
      winner = null; // No winner
      
    }

    matchDoc.winnerUserId = winner?.userId ?? null; // Store winner's ID
    // --- End Determine Winner ---

    console.log(`[Finalize ${matchDoc.code}] Winner: ${matchDoc.winnerUserId || 'None'}. Reason: ${reason}`);
    return matchDoc; 
  }

  export default {
    publicMatchView,
    emitMatchSnapshot,
    startCountdown,
    hardFinish,
    tryFinishMatch,
    finalizeResult
  };
