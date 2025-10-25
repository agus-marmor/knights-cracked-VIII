// utils/lobby.view.js
export function publicLobbyView(lobbyDoc) {
  // Accepts a Mongoose doc or a plain object
  const l = lobbyDoc.toObject?.() ?? lobbyDoc;

  const players = (l.players ?? []).map(p => ({
    userId: p.userId,
    username: p.username,
    character: p.character,
    ready: !!p.ready,
    joinedAt: p.joinedAt,
    lastSeenAt: p.lastSeenAt
  }));

  const allReady = players.length > 0 && players.every(p => p.ready);
  const capacity = { current: players.length, max: l.maxPlayers };

  return {
    code: l.code,
    status: l.status,                     // "open" | "in_progress" | "finished"
    hostUserId: l.hostUserId,
    players,                              // array of { userId, username, character, ready, ... }
    capacity,                             // { current, max }
    allReady,
    canStart: l.status === "open" && players.length >= 2 && allReady,
    updatedAt: l.updatedAt,
    serverTime: new Date().toISOString(), // handy for client timing
  };
}
