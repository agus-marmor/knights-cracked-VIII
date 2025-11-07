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
      className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white p-6 bg-cover bg-center"
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

      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="text-5xl font-bold mb-3 text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-rose-400" style={{ fontFamily: "'Courier New', monospace" }}>
          LOBBY ROOM
        </h1>
        <div className="inline-block bg-slate-900/90 px-6 py-2 rounded-full border-2 border-purple-500/60 shadow-lg backdrop-blur-sm">
          <span className="text-sm text-purple-300 font-semibold tracking-wider" style={{ fontFamily: "'Courier New', monospace" }}>
            CODE: <span className="text-yellow-400 font-bold text-lg">{lobbyCode}</span>
          </span>
        </div>
      </div>

      {/* Main container */}
      <div className="w-full max-w-5xl">
        {/* Players display */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          {/* Pass player object identified by ID */}
          <PlayerPanel player={me} isMe={true} heroId={myHero} />
          <PlayerPanel player={other} isMe={false} />
        </div>

        {/* VS Badge between players */}
        <div className="flex justify-center -mt-16 mb-8 relative z-10">
          <div className="bg-slate-900 px-8 py-3 rounded-full border-2 border-purple-500/60 shadow-lg backdrop-blur-sm">
            <span className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-400 to-rose-400" style={{ fontFamily: "'Courier New', monospace" }}>
              VS
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col items-center gap-4 bg-slate-900/80 backdrop-blur-sm rounded-xl border-2 border-slate-700 p-6 shadow-xl">
          {/* Waiting for opponent */}
          {!hasOpponent && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-cyan-300 font-semibold text-lg" style={{ fontFamily: "'Courier New', monospace" }}>
                WAITING FOR OPPONENT...
              </p>
            </div>
          )}

          {/* Ready button */}
          {hasOpponent && !meReady && (
            <Button
              color="success"
              variant="solid"
              size="lg"
              isLoading={sendingReady}
              onPress={onReady}
              className="font-bold text-lg px-12 py-6 shadow-lg shadow-emerald-500/30 border-2 border-emerald-400/50"
              style={{ fontFamily: "'Courier New', monospace" }}
            >
              {sendingReady ? "SETTING READY..." : "I'M READY"}
            </Button>
          )}

          {/* Unready button */}
          {hasOpponent && meReady && (
            <div className="flex flex-col items-center gap-4 w-full">
              <div className="flex items-center gap-3 bg-emerald-900/30 border border-emerald-500/50 rounded-lg px-6 py-3">
                <span className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse shadow-lg shadow-emerald-400/50"></span>
                <p className="text-emerald-300 font-bold text-lg" style={{ fontFamily: "'Courier New', monospace" }}>
                  YOU'RE READY!
                </p>
              </div>
              
              {!otherReady && (
                <div className="flex items-center gap-3 bg-yellow-900/20 border border-yellow-500/50 rounded-lg px-6 py-2">
                  <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
                  <p className="text-yellow-300 text-sm font-semibold" style={{ fontFamily: "'Courier New', monospace" }}>
                    WAITING FOR OPPONENT...
                  </p>
                </div>
              )}

              <Button
                color="warning"
                variant="bordered"
                size="md"
                isLoading={sendingReady}
                onPress={onUnready}
                className="font-semibold border-2"
                style={{ fontFamily: "'Courier New', monospace" }}
              >
                {sendingReady ? "UPDATING..." : "NOT READY"}
              </Button>

              {hasOpponent && (
                <Button
                  color="primary"
                  variant="solid"
                  size="sm"
                  className="mt-2"
                  onPress={async () => {
                    try {
                      const res = await startMatch(lobbyCode);
                      if (res.ok && res.matchId) {
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function PlayerPanel({ player, isMe, heroId }: { player: LobbyPlayer | undefined, isMe: boolean, heroId?: string }) {
  const characterId = (player?.character || (isMe ? heroId : undefined) || "Kaiju").toLowerCase();
  const isReady = Boolean(player?.ready);
  const hasPlayer = Boolean(player);
  const displayName = isMe ? "You" : (player?.username || (hasPlayer ? "Opponent" : "Waiting..."));

  const borderColor = isMe ? 'border-cyan-500' : 'border-rose-500';
  const gradientFrom = isMe ? 'from-cyan-900/30' : 'from-rose-900/30';
  const accentColor = isMe ? 'text-cyan-300' : 'text-rose-300';
  const readyBorderColor = isReady ? 'border-emerald-500 shadow-emerald-500/40' : borderColor;

  return (
    <div className={`relative bg-gradient-to-br ${gradientFrom} via-slate-900/50 to-slate-900/30 rounded-xl border-2 ${readyBorderColor} p-6 backdrop-blur-sm shadow-xl transition-all duration-300 ${hasPlayer || isMe ? 'scale-100 opacity-100' : 'opacity-60 scale-95'}`}>
      {/* Corner accents */}
      <div className={`absolute -top-1.5 -left-1.5 w-6 h-6 border-t-2 border-l-2 ${isMe ? 'border-cyan-400' : 'border-rose-400'} rounded-tl`} />
      <div className={`absolute -top-1.5 -right-1.5 w-6 h-6 border-t-2 border-r-2 ${isMe ? 'border-cyan-400' : 'border-rose-400'} rounded-tr`} />
      
      {/* Player name */}
      <div className="text-center mb-4">
        <p className={`${accentColor} font-bold text-xl mb-1`} style={{ fontFamily: "'Courier New', monospace" }}>
          {displayName}
        </p>
        <p className="text-gray-400 text-sm capitalize" style={{ fontFamily: "'Courier New', monospace" }}>
          {characterId}
        </p>
      </div>

      {/* Hero image */}
      <div className="w-full aspect-square flex items-center justify-center mb-4 relative">
        {hasPlayer || isMe ? (
          <div className="relative w-full h-full">
            {/* Glow effect */}
            <div className={`absolute inset-0 ${isMe ? 'bg-cyan-500/20' : 'bg-rose-500/20'} rounded-lg blur-xl`} />
            <img
              src={heroSrc(characterId)}
              alt={`${displayName}'s hero`}
              className="relative w-full h-full object-contain drop-shadow-2xl"
            />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center border-2 border-dashed border-slate-600 rounded-lg bg-slate-800/50">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-2 border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin"></div>
              <span className="text-gray-400 text-sm font-semibold" style={{ fontFamily: "'Courier New', monospace" }}>
                WAITING...
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Ready status */}
      {player && (
        <div className="text-center">
          {isReady ? (
            <div className="inline-flex items-center gap-2 bg-emerald-900/40 border border-emerald-500/60 rounded-full px-4 py-2">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-lg shadow-emerald-400/50"></span>
              <span className="text-emerald-300 font-bold text-sm" style={{ fontFamily: "'Courier New', monospace" }}>
                READY
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 bg-slate-800/60 border border-slate-600 rounded-full px-4 py-2">
              <span className="w-2 h-2 bg-gray-500 rounded-full"></span>
              <span className="text-gray-400 font-bold text-sm" style={{ fontFamily: "'Courier New', monospace" }}>
                NOT READY
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// Ensure this mapping is correct for your images
function heroSrc(id: string) {
  if (id === "kaiju") return "/kaiju.png"; // Monster
  if (id === "mech") return "/mech.png"; // Robot
  return "/mech.png"; // Default or placeholder
}