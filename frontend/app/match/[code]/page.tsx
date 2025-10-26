"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { Button, Textarea, Progress, Modal, ModalContent, ModalHeader, ModalBody } from "@heroui/react";
import { getToken, getCurrentUserId } from "@/lib/auth";
import { getMatchPrompt } from "@/lib/api";

type MatchPlayer = {
  userId: string;
  username: string;
  wpm?: number;
  accuracy?: number;
  charsTyped?: number;
  errors?: number;
  finished?: boolean;
  finishedAt?: string | Date | null;
};

type MatchSnapshot = {
  id: string;
  code: string;
  status: "countdown" | "playing" | "finished";
  promptText: string;
  startedAt?: string | Date;
  endedAt?: string | Date;
  winnerUserId?: string | null;
  players: MatchPlayer[];
};

const SOCKET_SERVER_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";

// helpers
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function countErrors(expected: string, typed: string) {
  let errors = 0;
  for (let i = 0; i < typed.length; i++) if (typed[i] !== expected[i]) errors++;
  return errors;
}

function calculateWpm(typed: string, startedAt: Date | null) {
  if (!startedAt) return 0;
  const chars = typed.length;
  const minutes = (Date.now() - startedAt.getTime()) / 60000;
  return minutes > 0 ? Math.round(chars / 5 / minutes) : 0;
}

function calculateAccuracy(typed: string, prompt: string) {
  if (!typed.length) return 100;
  const errors = countErrors(prompt.slice(0, typed.length), typed);
  return Math.round(Math.max(0, 100 * (1 - errors / typed.length)));
}

export default function MatchPage() {
  const { code } = useParams<{ code: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const hero = search.get("hero") || undefined;

  const myUserId = getCurrentUserId();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [winnerUserId, setWinnerUserId] = useState<string | null | undefined>(null);
  const [typed, setTyped] = useState<string>("");
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [match, setMatch] = useState<MatchSnapshot | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);

  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const promptScrollRef = useRef<HTMLPreElement>(null);
  const [prompt, setPrompt] = useState("Loading prompt...");

  // Fetch prompt
  useEffect(() => {
    const fetchPrompt = async () => {
      if (match?.promptText) {
        setPrompt(match.promptText);
      } else if (code && !match?.promptText) {
        try {
          const data = await getMatchPrompt(code);
          console.log("Fetched prompt:", data);
          if (data?.promptText) {
            setPrompt(data.promptText);
          }
        } catch (err) {
          console.error("Failed to load prompt:", err);
          setPrompt("Failed to load prompt");
        }
      }
    };

    fetchPrompt();
  }, [match?.promptText, code]);

  const maxLen = prompt.length;

  const me = useMemo(
    () => match?.players.find((p) => String(p.userId) === String(myUserId)),
    [match, myUserId]
  );

  const opponent = useMemo(
    () => match?.players.find((p) => String(p.userId) !== String(myUserId)),
    [match, myUserId]
  );

  // add a stable ref for current socket to avoid stale closures
  const socketRef = useRef<Socket | null>(null);

  // Socket initialization
  useEffect(() => {
    if (!code) return;

    console.log("[Socket] Initializing connection...");
    console.log("[Socket] Code:", code);
    console.log("[Socket] Token exists:", !!getToken());
    console.log("[Socket] User ID:", myUserId);

    const token = getToken();
    if (!token) {
      console.error("[Socket] No token found! Cannot connect.");
      return;
    }

    const s = io(SOCKET_SERVER_URL, {
      auth: { token },
      query: {
        lobbyCode: code.toUpperCase(),
        token // Also send in query as fallback
      },
      withCredentials: true,
      transports: ['websocket', 'polling'], // Try both transports
    });
    setSocket(s);
    socketRef.current = s; // <- keep ref in sync


    s.on("connect", () => {
      console.log("[Socket] ===== CONNECTED =====");
      console.log("[Socket] Socket ID:", s.id);
      console.log("[Socket] Subscribing to match:", code);
      s.emit("match:subscribe", { code });

      // Verify we're in the right room
      setTimeout(() => {
        console.log("[Socket] Checking rooms...");
        console.log("[Socket] Expected room: match:" + code?.toUpperCase());
      }, 1000);
    });
    s.onAny((eventName, ...args) => {
      console.log(`[Socket] ===== RECEIVED EVENT: ${eventName} =====`);
      console.log(`[Socket] Args:`, args);
    });

    s.on("connect_error", (e) => {
      console.error("[Socket] Connection error:", e.message);
    });

    // Handle initial match state and updates
    s.on("match:update", (snapshot: MatchSnapshot) => {
      console.log("[match:update] Received snapshot:", {
        status: snapshot?.status,
        winner: snapshot?.winnerUserId,
        players: snapshot?.players?.length
      });

      setMatch(snapshot);

      if (snapshot.status === "playing" && snapshot.startedAt) {
        setStartedAt(new Date(snapshot.startedAt));
      }

      // Handle if match is already finished when we join
      if (snapshot.status === "finished") {
        console.log("[match:update] Match already finished, winner:", snapshot.winnerUserId);
        setWinnerUserId(snapshot.winnerUserId);
        setFinished(true);
      }
    });

    s.on("match:countdown", ({ secs }: { secs: number }) => {
      console.log("[match:countdown]", secs);
      setCountdown(secs);
    });

    s.on("match:started", ({ startedAt }: { startedAt: string | Date }) => {
      console.log("[match:started]", startedAt);
      setCountdown(null);
      setStartedAt(new Date(startedAt));
    });

    // Update progress from other players
    s.on("match:progress", (payload: any) => {
      console.log("========================================");
      console.log("[match:progress] ===== EVENT RECEIVED =====");
      console.log("[match:progress] Full payload:", JSON.stringify(payload, null, 2));
      console.log("[match:progress] User:", payload.username);
      console.log("[match:progress] UserID:", payload.userId);
      console.log("[match:progress] My UserID:", myUserId);
      console.log("[match:progress] Is me?:", String(payload.userId) === String(myUserId));
      console.log("[match:progress] Chars:", payload.charsTyped);
      console.log("[match:progress] Finished:", payload.finished);
      console.log("========================================");

      setMatch((prev) => {
        if (!prev) {
          console.log("[match:progress] No previous match state");
          return prev;
        }
        const players = prev.players.map((p) =>
          String(p.userId) === String(payload.userId)
            ? { ...p, ...payload }
            : p
        );
        console.log("[match:progress] Updated players:", players);
        return { ...prev, players };
      });
    });

    // Handle match finished event
    s.on("match:finished", (snapshot: MatchSnapshot) => {
      console.log("[match:finished] ===== MATCH FINISHED EVENT RECEIVED =====");
      console.log("[match:finished] Full snapshot:", JSON.stringify(snapshot, null, 2));
      console.log("[match:finished] Winner:", snapshot.winnerUserId);
      console.log("[match:finished] My ID:", myUserId);
      console.log("[match:finished] I won?:", snapshot.winnerUserId === String(myUserId));

      setMatch(snapshot);
      setWinnerUserId(snapshot.winnerUserId);
      setFinished(true);
    });
    return () => {
      console.log("[Socket] Cleaning up, unsubscribing...");
      s.emit("match:unsubscribe", { code });
      s.disconnect();
      setSocket(null);
      socketRef.current = null; // <- clear ref
    };
  }, [code]);

  // Sync scrolling between textarea and prompt overlay
  useEffect(() => {
    if (!textAreaRef.current || !promptScrollRef.current) return;

    const textarea = textAreaRef.current;
    const overlay = promptScrollRef.current;

    const syncScroll = () => {
      if (overlay.scrollTop !== textarea.scrollTop) {
        overlay.scrollTop = textarea.scrollTop;
      }
    };

    const intervalId = setInterval(syncScroll, 16); // ~60fps
    return () => clearInterval(intervalId);
  }, []);

  // helper to send a finish event reliably with ack + retry
  const sendFinishWithRetry = useCallback((payload: any, maxAttempts = 3) => {
    const s = socketRef.current;
    if (!s) {
      console.warn("[sendFinishWithRetry] no socket available");
      return;
    }

    let attempts = 0;
    const tryEmit = () => {
      attempts++;
      if (!socketRef.current) return;

      console.log(`[sendFinishWithRetry] emitting match:finish attempt ${attempts}`, payload);
      socketRef.current.emit("match:finish", payload, (ack?: { ok?: boolean; error?: string }) => {
        if (ack && ack.ok) {
          console.log("[sendFinishWithRetry] server ack received");
          return;
        }

        if (attempts < maxAttempts) {
          const backoff = 200 * attempts;
          console.warn(`[sendFinishWithRetry] no ack, retrying in ${backoff}ms`, ack);
          setTimeout(tryEmit, backoff);
        } else {
          console.error("[sendFinishWithRetry] failed to deliver match:finish after retries", ack);
        }
      });
    };

    tryEmit();
  }, []);

  // NEW: helper to emit and wait for server ack with timeout
  const emitWithAck = useCallback((event: string, payload: any, timeout = 1500) => {
    return new Promise<any>((resolve, reject) => {
      const s = socketRef.current;
      if (!s) return reject(new Error("no-socket"));

      let settled = false;
      try {
        s.emit(event, payload, (ack?: any) => {
          if (settled) return;
          settled = true;
          resolve(ack);
        });
      } catch (err) {
        if (!settled) {
          settled = true;
          reject(err);
        }
      }

      setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("ack-timeout"));
        }
      }, timeout);
    });
  }, []);

  // Handle typing
  const onType = useCallback(
    async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      console.log("========================================");
      console.log("[onType] *** FUNCTION CALLED ***");
      console.log("[onType] Event:", e.type);
      console.log("[onType] Value length:", e.target.value.length);
      console.log("[onType] Socket exists:", !!socket);
      console.log("[onType] Match status:", match?.status);
      console.log("[onType] Match object:", match);
      console.log("========================================");

      const s = socketRef.current;
      if (!s) {
        console.log("[onType] Blocked - no socket");
        return;
      }

      // Allow typing until server confirms match is finished
      if (match?.status === "finished") {
        console.log("[onType] Blocked - match finished by server");
        return;
      }

      // ensure startedAt is set BEFORE emitting so timings are accurate
      let localStartedAt = startedAt;
      if (!localStartedAt) {
        localStartedAt = new Date();
        setStartedAt(localStartedAt);
      }

      const value = e.target.value.slice(0, maxLen);
      setTyped(value);

      const errors = countErrors(prompt.slice(0, value.length), value);
      const isFinished = value.length >= maxLen;

      // Set finished state immediately
      if (isFinished && !finished) {
        console.log("[onType] *** USER FINISHED TYPING! ***");
        setFinished(true);
      }

      // Send progress to server (always)
      console.log("[onType] About to emit progress:update");

      // If finishing, try to get an immediate ack for the final progress
      if (isFinished) {
        try {
          await emitWithAck("progress:update", {
            code,
            charsTyped: value.length,
            errors,
            finished: true,
          }, 1000);
          console.log("[onType] final progress:update ack received");
        } catch (err) {
          console.warn("[onType] final progress:update ack failed/timed out, emitting without ack", err);
          // fire-and-forget
          s.emit("progress:update", {
            code,
            charsTyped: value.length,
            errors,
            finished: true,
          });
        }

        // Prepare finish payload WITHOUT client userId (server attaches socket user)
        const finishedAt = new Date();
        const wpm = calculateWpm(value, localStartedAt);
        const acc = calculateAccuracy(value, prompt);
        const finishPayload = {
          code,
          charsTyped: value.length,
          errors,
          finished: true,
          startedAt: localStartedAt?.toISOString?.() ?? null,
          finishedAt: finishedAt.toISOString(),
          wpm,
          accuracy: acc,
        };

        // Try to get a direct ack for match:finish. If it times out, fallback to retry sender.
        try {
          const ack = await emitWithAck("match:finish", finishPayload, 1500);
          console.log("[onType] match:finish ack:", ack);
        } catch (err) {
          console.warn("[onType] match:finish ack timed out, falling back to retry emitter", err);
          // fallback to retry emitter (keeps previous behavior)
          sendFinishWithRetry(finishPayload, 3);
        }
      } else {
        // not finished: normal frequent progress updates (no ack)
        s.emit("progress:update", {
          code,
          charsTyped: value.length,
          errors,
          finished: false,
        });
      }

      // Sync scroll
      requestAnimationFrame(() => {
        if (textAreaRef.current && promptScrollRef.current) {
          promptScrollRef.current.scrollTop = textAreaRef.current.scrollTop;
        }
      });

    },
    // note: using socketRef and sendFinishWithRetry so we avoid depending on socket state directly
    [prompt, finished, code, maxLen, startedAt, match, myUserId, sendFinishWithRetry, emitWithAck]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
      }
    },
    []
  );

  const onLeave = useCallback(() => router.push("/dashboard"), [router]);

  const myServerWpm = me?.wpm ?? calculateWpm(typed, startedAt);
  const myServerAcc = me?.accuracy ?? calculateAccuracy(typed, prompt);
  const myProgressPct = maxLen > 0 ? Math.floor(((me?.charsTyped ?? typed.length) / maxLen) * 100) : 0;
  const oppProgressPct = maxLen > 0 ? Math.floor(((opponent?.charsTyped ?? 0) / maxLen) * 100) : 0;

  const iWon = (winnerUserId ?? match?.winnerUserId ?? null) === String(myUserId);

  return (
    <div
      className="min-h-screen w-full bg-slate-900 text-white flex flex-col"
      style={{ backgroundImage: "url('/mainPage.jpg')", backgroundSize: "cover", backgroundPosition: "center" }}
    >
      {/* Header */}
      <div className="px-4 py-4 flex items-center justify-between border-b border-slate-800">
        <div className="text-sm opacity-80">Room: <span className="font-mono">{code}</span></div>
        <div className="flex items-center gap-4 text-sm">
          <span>WPM: <b>{myServerWpm}</b></span>
          <span>ACC: <b>{myServerAcc}%</b></span>
          <Button size="sm" variant="light" onPress={onLeave}>Leave</Button>
        </div>
      </div>

      {/* Left character */}
      <img
        src="/mech.png"
        alt="Hero 1"
        className="fixed left-5 bottom-25 w-48 h-auto object-contain z-20"
      />

      {/* Right character */}
      <img
        src="/hero2.png"
        alt="Hero 2"
        className="fixed right-5 bottom-21 w-48 h-auto object-contain z-20"
      />

      {/* Countdown */}
      {countdown !== null && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20 text-6xl font-bold">
          {countdown}
        </div>
      )}

      {/* Typing area */}
      <div className="max-w-4xl mx-auto w-full px-4 py-6 flex-1 flex flex-col gap-6">
        <div className="relative w-full h-80 bg-slate-800 rounded-lg overflow-hidden">
          {/* Prompt overlay */}
          <pre
            ref={promptScrollRef}
            className="absolute top-0 left-0 w-full h-full pointer-events-none font-mono text-lg leading-6 whitespace-pre-wrap break-words overflow-y-auto z-20"
            style={{
              padding: '0.75rem',
              margin: 0,
              wordBreak: 'break-word',
              overflowWrap: 'break-word'
            }}
          >
            {prompt.split("").map((ch, i) => {
              const typedCh = typed[i];
              const correct = typedCh === undefined ? undefined : typedCh === ch;

              return (
                <span
                  key={i}
                  className={
                    correct === undefined
                      ? "opacity-50"
                      : correct
                        ? "text-emerald-400"
                        : "text-rose-400 underline"
                  }
                >
                  {ch}
                </span>
              );
            })}
          </pre>

          {/* Textarea */}
          <textarea
            ref={textAreaRef}
            value={typed}
            onChange={onType}
            onKeyDown={onKeyDown}
            onScroll={(e) => {
              if (promptScrollRef.current) {
                promptScrollRef.current.scrollTop = e.currentTarget.scrollTop;
              }
            }}
            disabled={finished}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            wrap="soft"
            className="absolute top-0 left-0 w-full h-full font-mono text-lg leading-6 bg-transparent border-none focus:outline-none resize-none z-10 caret-white text-transparent overflow-y-auto"
            style={{
              padding: '0.75rem',
              margin: 0,
              caretColor: 'white',
              wordBreak: 'break-word',
              overflowWrap: 'break-word'
            }}
          />
        </div>

        <div className="text-xs opacity-70 mt-1">
          {me?.errors ?? countErrors(prompt.slice(0, typed.length), typed)} errors
        </div>

        {/* Progress */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PlayerProgress
            title={me?.username ?? "You"}
            pct={myProgressPct}
            wpm={myServerWpm}
            acc={myServerAcc}
            highlight
          />
          <PlayerProgress
            title={opponent?.username ?? "Opponent"}
            pct={oppProgressPct}
            wpm={opponent?.wpm ?? 0}
            acc={opponent?.accuracy ?? 100}
          />
        </div>
      </div>

      
      {/* --- RESULTS MODAL --- */}
      <Modal isOpen={finished || match?.status === "finished"} onClose={onLeave}>
        <ModalContent className="bg-slate-800 text-white border border-slate-700">
          <ModalHeader>
            <h2 className={`text-3xl font-bold ${iWon ? 'text-emerald-400' : 'text-rose-400'}`}>
              {iWon ? "🏆 You Win!" : "Better Luck Next Time"}
            </h2>
          </ModalHeader>
          <ModalBody>
            <div className="space-y-6 py-4">
              {/* Debug info - you can remove this after testing */}
              <div className="text-xs text-slate-400 font-mono bg-slate-900/50 p-2 rounded">
                <div>Match Status: {match?.status}</div>
                <div>Winner ID: {match?.winnerUserId}</div>
                <div>My ID: {myUserId}</div>
                <div>Me: finished={me?.finished ? 'Yes' : 'No'}, wpm={me?.wpm}, acc={me?.accuracy}%</div>
                <div>Opp: finished={opponent?.finished ? 'Yes' : 'No'}, wpm={opponent?.wpm}, acc={opponent?.accuracy}%</div>
              </div>

              {/* Stats Comparison */}
              <div className="grid grid-cols-2 gap-4 text-center">

                {/* Player Stats Card */}
                <div className={`p-4 rounded-lg ${iWon ? 'bg-emerald-900/50 border border-emerald-600' : 'bg-slate-700'}`}>
                  <div className="text-lg font-bold">{me?.username ?? "You"}</div>
                  <div className="text-4xl font-mono font-bold text-cyan-400">
                    {me?.wpm ?? myServerWpm ?? 0}
                  </div>
                  <div className="text-sm text-slate-300">WPM</div>
                  <div className="mt-2 text-2xl font-mono font-bold text-slate-300">
                    {me?.accuracy ?? myServerAcc ?? 100}%
                  </div>
                  <div className="text-sm text-slate-300">Accuracy</div>
                  <div className="text-xs text-slate-400 mt-2">
                    {me?.charsTyped ?? typed.length} / {maxLen} chars
                  </div>
                </div>

                {/* Opponent Stats Card */}
                <div className={`p-4 rounded-lg ${!iWon ? 'bg-emerald-900/50 border border-emerald-600' : 'bg-slate-700'}`}>
                  <div className="text-lg font-bold">{opponent?.username ?? "Opponent"}</div>
                  <div className="text-4xl font-mono font-bold text-cyan-400">
                    {opponent?.wpm ?? 0}
                  </div>
                  <div className="text-sm text-slate-300">WPM</div>
                  <div className="mt-2 text-2xl font-mono font-bold text-slate-300">
                    {opponent?.accuracy ?? 100}%
                  </div>
                  <div className="text-sm text-slate-300">Accuracy</div>
                  <div className="text-xs text-slate-400 mt-2">
                    {opponent?.charsTyped ?? 0} / {maxLen} chars
                  </div>
                </div>

              </div>

              {/* Button to leave */}
              <Button
                onPress={onLeave}
                className="w-full"
                variant="solid"
                color="primary"
              >
                Back to Dashboard
              </Button>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>

    </div>
  );
}

function PlayerProgress({
  title,
  pct,
  wpm,
  acc,
  highlight = false
}: {
  title: string;
  pct: number;
  wpm?: number;
  acc?: number;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg p-4 ${highlight ? "border-emerald-500/60" : "border-slate-800"} bg-slate-900/60 border`}>
      <div className="flex justify-between mb-2">
        <div className="text-sm opacity-80">{title}</div>
        <div className="text-xs opacity-70">
          WPM: <b>{wpm ?? 0}</b> · ACC: <b>{acc ?? 100}%</b>
        </div>
      </div>
      <Progress value={clamp(pct, 0, 100)} color={highlight ? "success" : "primary"} />
    </div>
  );
}