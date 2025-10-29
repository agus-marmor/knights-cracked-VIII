import Match from "../models/Match.js";

export async function getCurrentMatch(req, res) {
  const m = await Match.findOne({ lobbyCode: req.params.code }).sort({ createdAt: -1 });
  if (!m) return res.status(404).json({ message: "No match" });
  res.json(m);
}

export async function submitProgress(req, res) {
  const { progress, wpm, accuracy } = req.body; // progress in [0,1]
  const m = await Match.findOne({ lobbyCode: req.params.code }).sort({ createdAt: -1 });
  if (!m) return res.status(404).json({ message: "No match" });

  const i = m.results.findIndex(r => r.userId === req.user.id);
  const entry = { userId: req.user.id, name: req.user.name, progress, wpm, accuracy };
  if (i === -1) m.results.push(entry);
  else m.results[i] = { ...m.results[i].toObject?.() ?? m.results[i], ...entry };

  await m.save();
  res.json({ ok: true });
}

export async function finish(req, res) {
  const { wpm, accuracy } = req.body;
  const m = await Match.findOne({ lobbyCode: req.params.code }).sort({ createdAt: -1 });
  if (!m) return res.status(404).json({ message: "No match" });

  const i = m.results.findIndex(r => r.userId === req.user.id);
  const entry = { userId: req.user.id, name: req.user.name, progress: 1, wpm, accuracy, finishedAt: new Date() };
  if (i === -1) m.results.push(entry); else m.results[i] = { ...m.results[i], ...entry };
  await m.save();

  res.json({ ok: true });
}

export async function leaderboard(req, res) {
  const m = await Match.findOne({ lobbyCode: req.params.code }).sort({ createdAt: -1 });
  if (!m) return res.status(404).json({ message: "No match" });
  const sorted = [...m.results].sort((a, b) => (b.wpm ?? 0) - (a.wpm ?? 0));
  res.json(sorted);
}
