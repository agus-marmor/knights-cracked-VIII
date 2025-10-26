import Match from "../models/Match.js";
import { getIO } from "../socket.js";

export function publicMatchView(match) {
  // Ensure that we're working with a plain object
  const m = typeof match.toObject === 'function' ? match.toObject() : match;
  if (!m) return null;

  return {
    id: m._id || m.id,
    code: m.code,
    status: m.status, // "countdown", "playing", "finished"
    promptId: m.promptId,
    promptText: m.promptText, // Send the text
    startedAt: m.startedAt,
    endedAt: m.endedAt,
    durationMs: m.durationMs,
    winnerUserId: m.winnerUserId,
    players: (m.players || []).map(p => ({
      userId: p.userId,
      username: p.username,
      character: p.character,
      wpm: p.wpm,
      accuracy: p.accuracy,
      charsTyped: p.charsTyped,
      errors: p.errors,
      finished: p.finished,
      finishedAt: p.finishedAt,
    }))
  };
}

export async function emitMatchSnapshot(ioInstance, code, matchIdOrDoc) {
  const up = (code || "").toUpperCase();
  let match = null;

  if (!matchIdOrDoc) { 
    console.error("[emitMatchSnapshot] missing matchIdOrDoc"); 
    return; 
  }

  if (typeof matchIdOrDoc === "string") {
    match = await Match.findById(matchIdOrDoc).lean();
  } else if (matchIdOrDoc && typeof matchIdOrDoc.toObject === "function") {
    match = matchIdOrDoc.toObject();
  } else {
    match = matchIdOrDoc; // assume plain object
  }

  if (!match) {
    console.error(`[emitMatchSnapshot] Match not found for code ${up}`);
    return;
  }

  ioInstance.to(`match:${up}`).emit("match:update", publicMatchView(match));
}

// Handles the countdown and transition
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
          console.log(`[Countdown] Match ${up} started, setting 120s timeout`);
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

export async function tryFinishMatch(io, matchDoc, code) {
  console.log("========================================");
  console.log(`[tryFinishMatch] CALLED for match ${code}`);
  console.log(`[tryFinishMatch] Status: ${matchDoc.status}`);
  console.log(`[tryFinishMatch] Players:`, matchDoc.players.map(p => ({
    username: p.username,
    finished: p.finished,
    charsTyped: p.charsTyped
  })));
  
  if (matchDoc.status !== "playing") {
    console.log(`[tryFinishMatch] Not playing, exiting`);
    return;
  }

  const finishedPlayers = matchDoc.players.filter(p => p.finished);
  console.log(`[tryFinishMatch] Finished players: ${finishedPlayers.length}/${matchDoc.players.length}`);

  if (finishedPlayers.length === 0) {
    console.log(`[tryFinishMatch] No finished players yet`);
    return;
  }

  if (matchDoc.winnerUserId) {
    console.log(`[tryFinishMatch] Already has winner: ${matchDoc.winnerUserId}`);
    return;
  }

  // Determine winner
  finishedPlayers.sort((a, b) => {
    const ta = a.finishedAt ? new Date(a.finishedAt).getTime() : Infinity;
    const tb = b.finishedAt ? new Date(b.finishedAt).getTime() : Infinity;
    if (ta !== tb) return ta - tb;
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    return (b.wpm ?? 0) - (a.wpm ?? 0);
  });

  const winner = finishedPlayers[0];
  console.log(`[tryFinishMatch] Winner: ${winner.username}`);
  
  matchDoc.winnerUserId = winner.userId;
  matchDoc.status = "finished";
  matchDoc.endedAt = new Date();
  
  if (matchDoc.startedAt) {
    matchDoc.durationMs = matchDoc.endedAt.getTime() - new Date(matchDoc.startedAt).getTime();
  }

  await matchDoc.save();
  console.log(`[tryFinishMatch] Match saved as finished`);

  const finishedSnapshot = publicMatchView(matchDoc);
  io.to(`match:${code}`).emit("match:finished", finishedSnapshot);
  
  console.log(`[tryFinishMatch] *** BROADCASTED match:finished to match:${code} ***`);
  console.log("========================================");
}

export async function hardFinish(ioInstance, code, matchId, reason) {
  const up = (code || "").toUpperCase();
  console.log(`[hardFinish] Called for match ${up}, reason: ${reason}`);
  
  try {
    const match = await Match.findById(matchId);
    if (!match) {
      console.error(`[hardFinish] Match ${matchId} not found`);
      return;
    }
    
    if (match.status === "finished") {
      console.log(`[hardFinish] Match ${up} already finished`);
      return;
    }

    finalizeResult(match, reason);
    await match.save();
    
    ioInstance.to(`match:${up}`).emit("match:finished", publicMatchView(match));
    console.log(`[hardFinish] Match ${up} finished and broadcasted`);
  } catch (err) {
    console.error(`[HardFinish ${up}] Error:`, err);
  }
}

// Calculates final results and updates the match document (MUTATES matchDoc)
function finalizeResult(matchDoc, reason) {
  console.log(`[finalizeResult] Finalizing match, reason: ${reason}`);
  
  if (matchDoc.status === 'finished') {
    console.log(`[finalizeResult] Match already finished, skipping`);
    return matchDoc;
  }

  matchDoc.status = "finished";
  matchDoc.endedAt = new Date();
  if (matchDoc.startedAt) {
    matchDoc.durationMs = matchDoc.endedAt.getTime() - matchDoc.startedAt.getTime();
  }

  // Determine Winner 
  const finishedPlayers = matchDoc.players.filter(p => p.finished);
  let winner = null;

  if (finishedPlayers.length > 0) {
    // Sort finished players: earliest finish, then accuracy, then WPM
    finishedPlayers.sort((a, b) => {
      const timeA = a.finishedAt?.getTime() ?? Infinity;
      const timeB = b.finishedAt?.getTime() ?? Infinity;
      if (timeA !== timeB) return timeA - timeB;
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      return (b.wpm ?? 0) - (a.wpm ?? 0);
    });
    winner = finishedPlayers[0];
    console.log(`[finalizeResult] Winner by completion: ${winner.userId}`);
  } else if (reason === 'timeout' && matchDoc.players.length > 0) {
    // If timeout, sort by chars typed, then accuracy, then WPM
    const sortedByProgress = [...matchDoc.players].sort((a, b) => {
      if ((b.charsTyped ?? 0) !== (a.charsTyped ?? 0)) return (b.charsTyped ?? 0) - (a.charsTyped ?? 0);
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      return (b.wpm ?? 0) - (a.wpm ?? 0);
    });
    winner = sortedByProgress[0];
    console.log(`[finalizeResult] Winner by progress (timeout): ${winner.userId}`);
  } else {
    winner = null;
    console.log(`[finalizeResult] No winner determined`);
  }

  matchDoc.winnerUserId = winner?.userId ?? null;
  console.log(`[Finalize ${matchDoc.code}] Winner: ${matchDoc.winnerUserId || 'None'}. Reason: ${reason}`);
  return matchDoc;
}

export async function handlePlayerProgress(ioInstance, code, payload) {
  const up = (code || "").toUpperCase();
  try {
    const match = await Match.findOne({ code: up });
    if (!match) {
      console.warn(`[handlePlayerProgress] Match ${up} not found`);
      return;
    }

    const player = match.players.find(p => String(p.userId) === String(payload.userId));
    if (!player) {
      console.warn(`[handlePlayerProgress] Player ${payload.userId} not found in match ${up}`);
      return;
    }

    // Update progressive fields
    if (typeof payload.charsTyped === "number") player.charsTyped = payload.charsTyped;
    if (typeof payload.errors === "number") player.errors = payload.errors;

    // Compute WPM server-side if possible (prefer server calculation for consistency)
    if (!match.startedAt) {
      // can't compute yet
      player.wpm = player.wpm ?? null;
    } else {
      const elapsedMs = Date.now() - new Date(match.startedAt).getTime();
      const minutes = elapsedMs / 60000;
      const chars = player.charsTyped ?? 0;
      player.wpm = minutes > 0 ? Math.round(chars / 5 / minutes) : 0;
    }

    // Compute accuracy server-side using chars/errors (fallback if client didn't send)
    if (typeof player.charsTyped === "number" && (typeof player.errors === "number")) {
      if (player.charsTyped > 0) {
        player.accuracy = Math.round(Math.max(0, 100 * (1 - (player.errors ?? 0) / player.charsTyped)));
      } else {
        player.accuracy = 100;
      }
    } else if (typeof payload.accuracy === "number") {
      player.accuracy = payload.accuracy;
    }

    // If client asserts finished, set finished + finishedAt (only set once)
    if (payload.finished) {
      if (!player.finished) {
        player.finished = true;
        player.finishedAt = payload.finishedAt ? new Date(payload.finishedAt) : new Date();
        // Ensure final WPM/accuracy are computed/persisted at finish (override with payload if provided)
        if (typeof payload.wpm === "number") {
          player.wpm = payload.wpm;
        } // else keep computed wpm
        if (typeof payload.accuracy === "number") {
          player.accuracy = payload.accuracy;
        } // else keep computed accuracy
      } else if (payload.finishedAt) {
        player.finishedAt = new Date(payload.finishedAt);
      }
    } else {
      // not finished: optionally accept client-sent wpm/accuracy for more granular UI if provided
      if (typeof payload.wpm === "number") player.wpm = payload.wpm;
      if (typeof payload.accuracy === "number") player.accuracy = payload.accuracy;
    }

    // Save the match
    await match.save();

    // Re-query fresh match document to avoid stale in-memory doc issues
    const freshMatch = await Match.findById(match._id);
    if (!freshMatch) {
      console.error(`[handlePlayerProgress] Failed to reload fresh match ${up} after save`);
      return;
    }

    // Broadcast compact progress to room using the fresh player data
    const freshPlayer = freshMatch.players.find(p => String(p.userId) === String(payload.userId));
    const out = {
      userId: freshPlayer.userId,
      username: freshPlayer.username,
      charsTyped: freshPlayer.charsTyped ?? 0,
      errors: freshPlayer.errors ?? 0,
      finished: !!freshPlayer.finished,
      finishedAt: freshPlayer.finishedAt ?? null,
      wpm: freshPlayer.wpm ?? 0,
      accuracy: freshPlayer.accuracy ?? 100,
    };
    ioInstance.to(`match:${up}`).emit("match:progress", out);

    // Emit full snapshot using freshMatch (keeps clients in sync)
    await emitMatchSnapshot(ioInstance, up, freshMatch);

    // If player finished, try to finalize match immediately using the fresh doc
    if (freshPlayer.finished) {
      console.log(`[handlePlayerProgress] Player ${freshPlayer.username} finished — attempting to finalize match ${up}`);
      await tryFinishMatch(ioInstance, freshMatch, up);
    }
  } catch (err) {
    console.error(`[handlePlayerProgress ${code}] Error:`, err);
  }
}

export async function handlePlayerFinish(ioInstance, code, payload) {
  // convenience wrapper — ensures finished is processed
  payload = { ...(payload || {}), finished: true };
  return handlePlayerProgress(ioInstance, code, payload);
}

export default {
  publicMatchView,
  emitMatchSnapshot,
  startCountdown,
  hardFinish,
  tryFinishMatch,
  finalizeResult,
  handlePlayerProgress,
  handlePlayerFinish
};