export function publicLobbyView(lobbyDoc) {
  if (!lobbyDoc) return null;
  const l = lobbyDoc.toObject?.() ?? lobbyDoc;
  if (!l) return null;

  const players = (l.players ?? []).map(p => {
    if (!p || typeof p !== 'object') return null;
    return {
      id: p.userId, // Match frontend type
      username: p.username || 'Player',
      character: p.character,
      ready: !!p.ready,
      // joinedAt: p.joinedAt, // Optional
      // lastSeenAt: p.lastSeenAt, // Optional
    };
  }).filter(p => p !== null);

  const allReady = players.length > 0 && players.every(p => p.ready);
  const capacity = { current: players.length, max: l.maxPlayers };
  // Determine gameStarted based on status
  const gameStarted = ['in_progress', 'playing', 'finished'].includes(l.status);

  return {
    id: l._id || l.id, // Add lobby's own DB ID if needed
    code: l.code,
    hostId: l.hostUserId, // Use consistent field name
    players,
    capacity,
    allReady,
    canStart: l.status === "open" && players.length >= 2 && allReady,

    // --- Added/Updated Fields ---
    gameId: l.code, // Explicitly set gameId to be the lobby code
    gameStarted: gameStarted, // Explicitly add gameStarted boolean
    // --- End Added/Updated Fields ---

    status: l.status, // Keep original status if needed elsewhere
    // updatedAt: l.updatedAt, // Optional
    // serverTime: new Date().toISOString(), // Optional
  };
}