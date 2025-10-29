import User from "../models/User.js";

export const topLeaderboard = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    // Pull essential fields for ranking
    const users = await User.find(
      {},
      "username avatarUrl stats.avgWPM stats.peakWPM stats.wins stats.losses stats.totalMatches"
    ).lean();

    // Compute winRate in-memory (avoids stale or missing virtuals)
    const ranked = users.map(u => {
      const s = u.stats || {};
      const winRate =
        s.totalMatches && s.totalMatches > 0
          ? Number(((s.wins / s.totalMatches) * 100).toFixed(2))
          : 0;

      return {
        username: u.username,
        avatarUrl: u.avatarUrl,
        avgWPM: s.avgWPM || 0,
        peakWPM: s.peakWPM || 0,
        wins: s.wins || 0,
        losses: s.losses || 0,
        totalMatches: s.totalMatches || 0,
        winRate
      };
    });

    // Sort: highest avgWPM first, then highest winRate
    ranked.sort((a, b) => {
      if (b.avgWPM !== a.avgWPM) return b.avgWPM - a.avgWPM;
      return b.winRate - a.winRate;
    });

    return res.json(ranked.slice(0, limit));
  } catch (err) {
    console.error("[topLeaderboard] error:", err);
    res.status(500).json({ message: "Failed to get leaderboard." });
  }
};
