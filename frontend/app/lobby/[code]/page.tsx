"use client";
import { startMatch } from "@/lib/api";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { readyUp, getLobby, leaveLobby, unready } from "@/lib/api";
import io, { Socket } from "socket.io-client";
import { getToken, getCurrentUserId } from "@/lib/auth"; 
import { Button, Spinner } from "@heroui/react"; // Import Spinner
import { LogOut } from "lucide-react"; // Icon for leave button

// Types
type LobbyPlayer = {
  id: string; 
  username: string;
  character?: string;
  ready?: boolean
};
type Lobby = {
  id: string;
  code: string;
  players?: LobbyPlayer[];
  gameStarted?: boolean;
  gameId?: string;
  hostId?: string;
};

const SOCKET_SERVER_URL = "http://localhost:5000";


export default function LobbyPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const resolvedParams = React.use(params);
  const lobbyCode = resolvedParams.code;

  const router = useRouter();
  const search = useSearchParams();
  const myHero = (search.get("hero") || "kaiju").toLowerCase(); // Still needed for initial display?

  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [error, setError] = useState<string>("");
  const [loadingInitial, setLoadingInitial] = useState(true); // Loading state for initial fetch
  const [sendingReady, setSendingReady] = useState(false);
  const [leavingLobby, setLeavingLobby] = useState(false); // Loading state for leaving
  const navigatedRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const currentUserId = getCurrentUserId();
  console.log("Current User ID:", currentUserId);
  // Get current user's ID

  // Initial Lobby Fetch
  useEffect(() => {
    if (!lobbyCode) return;
    const fetchInitialLobby = async () => {
      setLoadingInitial(true); // Start loading
      setError(""); // Clear previous errors
      try {
        const initialData = await getLobby(lobbyCode);
        setLobby(initialData);
      } catch (e: any) {
        setError(e?.message || "Failed to load lobby data");
        console.error("Initial fetch failed:", e);
        if (e.message?.includes("404") || e.message?.toLowerCase().includes("not found")) {
          setError(`Lobby "${lobbyCode}" not found.`); // Specific error
        }
      } finally {
        setLoadingInitial(false); // Finish loading
      }
    };
    fetchInitialLobby();
  }, [lobbyCode]);


  // WebSocket Connection
  useEffect(() => {
    if (!lobbyCode || !currentUserId) { 
      // setError("Lobby code or user ID missing."); // Might conflict with initial load error
      return;
    }

    const socket = io(SOCKET_SERVER_URL, {
      // Send token for auth middleware AND userId for identification
      query: { lobbyCode, token: getToken(), userId: currentUserId, hero: myHero }
    });

    socketRef.current = socket;

    const handleConnect = () => {
      console.log("[LobbyPage] Socket connected! ID:", socket.id);

      socket.emit("lobby:subscribe", { code: lobbyCode });
      console.log(`[LobbyPage] Emitted lobby:subscribe for ${lobbyCode}`);
      // Optional: emit a confirmation or fetch initial state again here if needed
    };

    // On receiving lobby data updates
    const handleLobbyUpdate = (updatedLobbyData: Lobby) => {
      console.log("[LobbyPage] === Received lobbyUpdate ===");
      console.log("[LobbyPage] Data received:", JSON.stringify(updatedLobbyData, null, 2));
      setLobby(updatedLobbyData); 
      setError(""); // Clear any previous errors
      console.log("[LobbyPage] Lobby state updated.");
    };

    // On receiving signal that game is starting
    const handleGameStarting = (data: { c: string }) => {
      console.log("Received gameStarting event:", data);
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      console.log(`Navigating to /match/${data.c} with hero ${myHero}`);
      router.push(`/match/${data.c}?hero=${myHero}`); // Navigate to game
    };

    // On receiving an error specific to the lobby/socket actions
    const handleLobbyError = (errorMessage: string) => {
      console.error("Received lobbyError:", errorMessage);
      setError(errorMessage); // Set the error state
    };

    // On disconnecting from the server
    const handleDisconnect = (reason: string) => {
      console.log("Disconnected from Socket.IO:", reason);
      // Don't clear lobby state here, maybe show a reconnecting UI
      setError("Lost connection to the lobby server."); // Set error state
    };

    // Attach Listeners
    socket.on("connect", handleConnect);
    socket.on("lobby:update", handleLobbyUpdate);

    socket.on("match:created", ({ code }) => {
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      router.push(`/match/${code}?hero=${myHero}`);
    });
    socket.on("lobby:presence", (p) => console.log("presence:", p));
    socket.on("disconnect", handleDisconnect);

    // Cleanup Function
    return () => {
      console.log("Disconnecting socket...");
      // Remove specific listeners before disconnecting
      socket.off("connect", handleConnect);
      socket.off("lobby:update", handleLobbyUpdate);
      socket.off("gameStarting", handleGameStarting);
      socket.off("lobbyError", handleLobbyError);
      socket.off("disconnect", handleDisconnect);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [lobbyCode, myHero, router, currentUserId]);


  // Derive state using userId 
  const players = lobby?.players ?? [];
  console.log("Players array for useMemo:", players);
  const me = useMemo(
    () => players.find((p) => String(p.id).trim() === String(currentUserId).trim()), // Compare using p.id
    [players, currentUserId]
  );

  const other = useMemo(
    () => players.find((p) => String(p.id).trim() !== String(currentUserId).trim()), // Compare using p.id
    [players, currentUserId]
  );
  console.log("Identified 'me':", me);
  console.log("Identified 'other':", other);

  const hasOpponent = Boolean(other);
  const meReady = Boolean(me?.ready);
  const otherReady = Boolean(other?.ready);


  // Ready Up Handler
  const onReady = async () => {
    if (sendingReady || !socketRef.current) return;
    try {
      setSendingReady(true);
      setError("");
      await readyUp(lobbyCode);
    } catch (e: any) {
      setError(e?.message || "Failed to ready up");
      console.error("Ready up failed:", e);
    } finally {
      setSendingReady(false);
    }
  };

  // Unready Handler 
  const onUnready = async () => {
    if (sendingReady || !socketRef.current) return;
    try {
      setSendingReady(true);
      setError("");
      console.log("[onUnready] Sending unready request...");
      const result = await unready(lobbyCode);
      console.log("[onUnready] Unready response:", result);

      // Manually update local state as fallback
      if (result && result.players) {
        console.log("[onUnready] Manually updating lobby state");
        setLobby(result);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to unready");
      console.error("Unready failed:", e);
    } finally {
      setSendingReady(false);
    }
  };



  const handleLeaveLobby = async () => {
    if (leavingLobby || !lobbyCode) return;
    setLeavingLobby(true);
    setError("");
    try {
      await leaveLobby(lobbyCode); // Call API
      socketRef.current?.disconnect(); // Disconnect socket
      router.push('/dashboard'); // Go back to dashboard
    } catch (e: any) {
      setError(e?.message || "Failed to leave lobby");
      console.error("Leave lobby failed:", e);
      setLeavingLobby(false); // Re-enable button on error
    }

  };


  // Render Logic 
  if (loadingInitial) {
    return (
      <div className="flex flex-col gap-4 justify-center items-center h-screen bg-gray-900">
        <Spinner size="lg" color="primary" />
        <p className="text-primary">Loading Lobby {lobbyCode}...</p>
      </div>
    );
  }

  // Handle specific "Not Found" error after loading
  if (error && error.includes("not found")) {
    return (
      <div className="flex flex-col gap-4 justify-center items-center h-screen bg-gray-900 text-red-400">
        <h1 className="text-2xl font-bold">Lobby Not Found</h1>
        <p>{error}</p>
        <Button color="primary" variant="bordered" onClick={() => router.push('/dashboard')}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  // Display other general errors
  if (error) return (
    <div className="flex flex-col gap-4 justify-center items-center h-screen bg-gray-900 text-red-400">
      <h1 className="text-2xl font-bold">Error</h1>
      <p>{error}</p>
      <Button color="warning" variant="bordered" onClick={() => window.location.reload()}>
        Try Reloading
      </Button>
    </div>
  );

  // Main render when lobby data is available
  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen bg-gray-800 text-white p-4 bg-cover bg-center"
      style={{ backgroundImage: "url('/mainPage.jpg')" }}
    >
      {/* Leave Lobby Button */}
      <Button
        isIconOnly
        color="danger"
        variant="light"
        size="sm"
        className="absolute top-4 left-4 sm:top-6 sm:left-6 z-10"
        onPress={handleLeaveLobby}
        isLoading={leavingLobby}
        aria-label="Leave Lobby"
      >
        {!leavingLobby && <LogOut size={20} />}
      </Button>


      <h1 className="text-4xl font-bold mb-2 text-shadow-md">Lobby Room</h1>
      <p className="text-lg mb-6 bg-black/30 px-3 py-1 rounded-md">
        Code:{" "}
        <span className="font-mono text-yellow-400 tracking-wider">{lobbyCode}</span>
      </p>

      <div className="w-full max-w-4xl p-6 bg-slate-900/80 rounded-lg shadow-xl border border-slate-700 backdrop-blur-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start relative">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {/* Vs image*/}

            <span className="text-4xl font-bold text-blue-400/70 text-shadow-lg hidden md:block">VS</span>
          </div>

          {/* Pass player object identified by ID */}
          <PlayerPanel player={me} isMe={true} heroId={myHero} />
          <PlayerPanel player={other} isMe={false} />
        </div>


        <div className="mt-8 flex flex-col items-center gap-3">
          {/* Waiting for opponent */}
          {!hasOpponent && (
            <p className="text-gray-300 animate-pulse">Waiting for opponent to join…</p>
          )}

          {/* Ready button */}
          {hasOpponent && !meReady && (
            <Button
              color="primary"
              variant="solid"
              size="lg"
              isLoading={sendingReady}
              onPress={onReady}
              className="font-semibold shadow-lg"
            >
              {sendingReady ? "Setting ready…" : "I'm Ready"}
            </Button>
          )}

          {/* Unready button */}
          {hasOpponent && meReady && (
            <>
              <p className="text-emerald-400 font-semibold flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                You're ready!
              </p>
              {!otherReady && (
                <p className="text-yellow-300 text-sm">Waiting for opponent…</p>
              )}
              <Button
                color="warning"
                variant="bordered"
                size="md"
                isLoading={sendingReady}
                onPress={onUnready}
                className="font-semibold"
              >
                {sendingReady ? "Updating…" : "Not Ready"}
              </Button>
              {}
              {hasOpponent && (
                <Button
                  color="success"
                  variant="solid"
                  onPress={async () => {
                    try {
                      const res = await startMatch(lobbyCode);
                      if (res.ok && res.matchId) {
                        // wait 500ms to allow backend to save currentMatchId
                        setTimeout(() => router.push(`/match/${lobbyCode}`), 500);
                      }
                    } catch (e: any) {
                      console.error("Start match failed:", e);
                      setError(e.message || "Failed to start match");
                    }
                  }}
                >
                  Start Match (Test)
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}


function PlayerPanel({ player, isMe, heroId }: { player: LobbyPlayer | undefined, isMe: boolean, heroId?: string }) {
  // Determine hero based on player data first, then fallback to prop if it's "me"
  const characterId = (player?.character || (isMe ? heroId : undefined) || "Kaiju").toLowerCase();
  const isReady = Boolean(player?.ready);
  const hasPlayer = Boolean(player); // Only rely on player data now for opponent
  const displayName = isMe ? "You" : (player?.username || (hasPlayer ? "Opponent" : "Waiting..."));

  return (
    <div className={`bg-slate-900/80 rounded-xl border-2 p-6 flex flex-col items-center transition-all duration-300 ${isReady ? 'border-emerald-500 shadow-emerald-500/30 shadow-lg' : 'border-slate-700'} ${hasPlayer || isMe ? 'scale-100 opacity-100' : 'opacity-60 scale-95'}`}> {/* Improved ready state and empty state */}
      <p className="text-gray-300 mb-2 font-semibold">{displayName}</p>

      <div className="w-40 h-40 sm:w-48 sm:h-48 flex items-center justify-center">
        {hasPlayer || isMe ? ( // Show player hero even if waiting for opponent data
          <img
            src={heroSrc(characterId)}
            alt={`${displayName}'s hero`}
            className="max-w-full max-h-full object-contain drop-shadow-lg"
          />
        ) : ( // Only show placeholder for opponent if 'other' is truly undefined
          <div className="w-full h-full flex items-center justify-center border-2 border-dashed border-slate-600 rounded-lg">
            <span className="text-gray-400 text-sm">Join pending…</span>
          </div>
        )}
      </div>

      {(hasPlayer || isMe) && ( // Show hero name and ready status if we know the hero
        <>
          <p className="mt-3 text-lg font-semibold capitalize">
            {characterId} {/* Display the determined character */}
          </p>
          {/* Only show ready status if player data actually exists */}
          {player && (
            <p className={`mt-2 text-sm font-medium ${isReady ? "text-emerald-400 animate-pulse" : "text-gray-400"}`}>
              {isReady ? "Ready" : "Not ready"}
            </p>
          )}
        </>
      )}
    </div>
  );
}


// Ensure this mapping is correct for your images
function heroSrc(id: string) {
  if (id === "kaiju") return "/hero2.png"; // Monster
  if (id === "mech") return "/hero1.png"; // Robot
  return "/hero2.png"; // Default or placeholder
}