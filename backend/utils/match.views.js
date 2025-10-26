// utils/match.view.js
export function publicMatchView(m) {
  const x = m && typeof m.toObject === "function" ? m.toObject() : m;
  if (!x) return null;

  return {
    id: x._id || x.id,
    status: x.status,
    code: x.code,
    promptId: x.promptId,
    promptText: x.promptText,
    startedAt: x.startedAt,
    endedAt: x.endedAt,
    durationMs: x.durationMs,
    winnerUserId: x.winnerUserId,
    players: (x.players || []).map((p) => ({
      userId: p.userId,
      username: p.username,
      wpm: p.wpm,
      accuracy: p.accuracy,
      charsTyped: p.charsTyped,
      errors: p.errors,
      finished: p.finished,
      finishedAt: p.finishedAt,
    })),
  };
}
