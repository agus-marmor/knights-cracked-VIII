"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getLobby, readyUp } from "@/lib/api";

type LobbyPlayer = { character?: string; ready?: boolean };
type Lobby = {
  players?: LobbyPlayer[];
  gameStarted?: boolean;
  gameId?: string;
};

export default function LobbyPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const resolvedParams = React.use(params);
  const lobbyCode = resolvedParams.code;

  const router = useRouter();
  const search = useSearchParams();
  const myHero = (search.get("hero") || "alpha").toLowerCase();

  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [error, setError] = useState<string>("");
  const [sendingReady, setSendingReady] = useState(false);
  const navigatedRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Poll lobby every 1s
  useEffect(() => {
    const tick = async () => {
      try {
        const data = await getLobby(lobbyCode);
        setLobby(data);
      } catch (e: any) {
        setError(e?.message || "Failed to load lobby");
      }
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [lobbyCode]);

  const players = lobby?.players ?? [];

  const me = useMemo(
    () => players.find((p) => (p.character || "").toLowerCase() === myHero),
    [players, myHero]
  );
  const other = useMemo(
    () => players.find((p) => (p.character || "").toLowerCase() !== myHero),
    [players, myHero]
  );

  const hasOpponent = Boolean(other);
  const meReady = Boolean(me?.ready);
  const otherReady = Boolean(other?.ready);

  // Redirect both players to game when ready
  useEffect(() => {
    if (navigatedRef.current) return;
    const shouldStart =
      (meReady && otherReady) || (lobby?.gameStarted ?? false);
    if (shouldStart) {
      navigatedRef.current = true;
      const gameId = lobby?.gameId || lobbyCode;
      router.push(`/game/${gameId}?hero=${myHero}`);
    }
  }, [meReady, otherReady, lobby?.gameStarted, lobby?.gameId, lobbyCode, myHero, router]);

  // Player clicks “I’m Ready”
  const onReady = async () => {
    if (sendingReady || meReady) return;
    try {
      setSendingReady(true);
      await readyUp(lobbyCode); // ✅ use your readyUp API
      // Optional optimistic update
      setLobby((prev) => {
        if (!prev) return prev;
        const updated = { ...prev };
        updated.players = (updated.players || []).map((p) =>
          (p.character || "").toLowerCase() === myHero
            ? { ...p, ready: true }
            : p
        );
        return updated;
      });
    } catch (e: any) {
      setError(e?.message || "Failed to ready up");
    } finally {
      setSendingReady(false);
    }
  };

  if (error) return <p className="p-6 text-red-400">{error}</p>;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-800 text-white p-4"
    style={{
        backgroundImage: "url('/mainPage.jpg')",
        
      }}
    >
      
      <h1 className="text-4xl font-bold mb-4">Lobby Room</h1>
      <p className="text-xl mb-6">
        Joining Lobby Code:{" "}
        <span className="font-mono text-yellow-400">{lobbyCode}</span>
      </p>

      <div className="w-full max-w-4xl p-6 bg-slate-900/70 rounded-lg shadow-xl border border-slate-700">
        <h2 className="text-2xl font-semibold mb-6 text-center">Game Area</h2>

        {/* Two panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Left: You */}
          <div className="bg-slate-900/80 rounded-xl border border-slate-700 p-6 flex flex-col items-center">
            <p className="text-gray-300 mb-2">You</p>
            <div className="w-48 h-48 flex items-center justify-center">
              <img
                src={heroSrc(myHero)}
                alt="Your hero"
                className="max-w-full max-h-full object-contain"
              />
            </div>
            <p className="mt-3 text-lg font-semibold capitalize">{myHero}</p>
            <p
              className={`mt-2 text-sm ${
                meReady ? "text-emerald-400" : "text-gray-400"
              }`}
            >
              {meReady ? "Ready" : "Not ready"}
            </p>
          </div>

          {/* Right: Opponent */}
          <div className="bg-slate-900/80 rounded-xl border border-slate-700 p-6 flex flex-col items-center">
            <p className="text-gray-300 mb-2">
              {hasOpponent ? "Opponent" : "Waiting for opponent…"}
            </p>

            <div className="w-48 h-48 flex items-center justify-center">
              {hasOpponent ? (
                <img
                  src={heroSrc((other?.character || "beta").toLowerCase())}
                  alt="Opponent hero"
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center border-2 border-dashed border-slate-600 rounded-lg">
                  <span className="text-gray-400">Join pending…</span>
                </div>
              )}
            </div>

            {hasOpponent && (
              <>
                <p className="mt-3 text-lg font-semibold capitalize">
                  {(other?.character || "beta").toLowerCase()}
                </p>
                <p
                  className={`mt-2 text-sm ${
                    otherReady ? "text-emerald-400" : "text-gray-400"
                  }`}
                >
                  {otherReady ? "Ready" : "Not ready"}
                </p>
              </>
            )}
          </div>
        </div>

        {/* VS divider */}
        <div className="mt-6 text-3xl font-bold text-blue-400 text-center">
          VS
        </div>

        {/* Ready / Start UX */}
        <div className="mt-6 flex flex-col items-center gap-3">
          {!hasOpponent && (
            <p className="text-gray-300">Waiting for the second player…</p>
          )}

          {hasOpponent && !meReady && (
            <button
              onClick={onReady}
              disabled={sendingReady}
              className="px-6 py-3 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition font-semibold"
            >
              {sendingReady ? "Setting ready…" : "I’m Ready"}
            </button>
          )}

          {hasOpponent && meReady && !otherReady && (
            <p className="text-gray-300">
              You’re ready. Waiting for opponent…
            </p>
          )}

          {hasOpponent && meReady && otherReady && (
            <p className="text-emerald-400 font-semibold">
              Both ready — starting…
            </p>
          )}
        </div>
      </div>
    </div>
  );

  function heroSrc(id: string) {
    if (id === "alpha") return "/hero1.png";
    if (id === "beta") return "/hero2.png";
    return "/hero1.png";
  }
}