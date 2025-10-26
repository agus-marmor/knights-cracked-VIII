"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { Button, Textarea, Progress, Modal, ModalContent, ModalHeader, ModalBody } from "@heroui/react";
import { getToken, getCurrentUserId } from "@/lib/auth";
import { getMatchPrompt, } from "@/lib/api";
import EndGameForm, { EndGameStats } from "@/app/components/EndGameForm"


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
let accuracy = 0;

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

  const lastEmitRef = useRef<number>(0);
  const THROTTLE_MS = 100;
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const promptScrollRef = useRef<HTMLPreElement>(null);
  const [prompt, setPrompt] = useState("Loading prompt...");
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

  // socket init
  useEffect(() => {
    if (!code) return;
    const s = io(SOCKET_SERVER_URL, {
      auth: { token: getToken() },
      query: { lobbyCode: code },
      withCredentials: true,
    });
    setSocket(s);

    s.on("connect", () => s.emit("match:subscribe", { code }));
    s.on("connect_error", (e) => console.log("[match] connect_error:", e.message));

    s.on("match:update", (snapshot: MatchSnapshot) => {
      setMatch(snapshot);

      if (snapshot.status === "playing" && snapshot.startedAt) setStartedAt(new Date(snapshot.startedAt));
      if (snapshot.status === "finished") {
        setWinnerUserId(snapshot.winnerUserId);
        setFinished(true);
      }
    });

    s.on("match:countdown", ({ secs }: { secs: number }) => setCountdown(secs));
    s.on("match:started", ({ startedAt }: { startedAt: string | Date }) => {
      setCountdown(null);
      setStartedAt(new Date(startedAt));
    });

    s.on("match:progress", (payload: any) => {
      setMatch((prev) => {
        if (!prev) return prev;
        const players = prev.players.map((p) =>
          p.userId === payload.userId ? { ...p, ...payload } : p
        );
        return { ...prev, players };
      });
    });

    s.on("match:finished", (snapshot: MatchSnapshot) => {
      setMatch(snapshot);
      setWinnerUserId(snapshot.winnerUserId);
      setFinished(true);

    });

    return () => {
      s.emit("match:unsubscribe", { code });
      s.disconnect();
      setSocket(null);
    };
  }, [code]);




  const emitProgress = useCallback(
    (nextTyped: string) => {
      if (!socket || !startedAt || finished) return;
      const now = Date.now();
      if (now - lastEmitRef.current < THROTTLE_MS) return;
      lastEmitRef.current = now;

      const safeTyped = nextTyped.slice(0, maxLen);
      const errors = countErrors(prompt.slice(0, safeTyped.length), safeTyped);
      socket.emit("progress:update", {
        code,
        charsTyped: safeTyped.length,
        errors,
        finished: safeTyped.length >= maxLen,
      });
    },
    [socket, code, maxLen, prompt, startedAt, finished]
  );

  useEffect(() => {
    if (!textAreaRef.current || !promptScrollRef.current) return;

    const textarea = textAreaRef.current;
    const overlay = promptScrollRef.current;

    // Check scroll position frequently to catch automatic scrolling
    const syncScroll = () => {
      if (overlay.scrollTop !== textarea.scrollTop) {
        overlay.scrollTop = textarea.scrollTop;
      }
    };

    const intervalId = setInterval(syncScroll, 16); // ~60fps

    return () => clearInterval(intervalId);
  }, []);

  const onType = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;

      if (!startedAt) {
        setStartedAt(new Date());
      }
      // Only allow typing up to the prompt length


      setTyped(value);
      const errors = countErrors(prompt.slice(0, value.length), value);
      const isFinished = value.length >= maxLen
      if (isFinished) {
      }

      socket?.emit("progress:update", {
        code,
        charsTyped: value.length,
        errors,
        finished: isFinished
      });

      // Let browser handle textarea scroll naturally, then sync overlay
      requestAnimationFrame(() => {
        if (textAreaRef.current && promptScrollRef.current) {
          promptScrollRef.current.scrollTop = textAreaRef.current.scrollTop;
        }
      });
    },
    [emitProgress, maxLen]
  );


  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {

      if (e.key === 'Enter') {
        e.preventDefault();
      }
    },
    [] // No dependencies
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

      {/* 🟩 Left character */}
      <img
        src="/mech.png"
        alt="Hero 1"
        className="fixed left-5 bottom-25 w-48 h-auto object-contain z-20"
      />

      {/* 🟩 Right character */}
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

        <div className="text-xs opacity-70 mt-1">{me?.errors ?? countErrors(prompt.slice(0, typed.length), typed)} errors</div>

        {/* Progress */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PlayerProgress title={me?.username ?? "You"} pct={myProgressPct} wpm={myServerWpm} acc={myServerAcc} highlight />
          <PlayerProgress title={opponent?.username ?? "Opponent"} pct={oppProgressPct} wpm={opponent?.wpm ?? 0} acc={opponent?.accuracy ?? 100} />
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-slate-800 flex items-center justify-between text-sm">
        <div>
          Status: <b>{match?.status ?? "—"}</b>
          {match?.status === "finished" && (
            <span className="ml-3">{winnerUserId === myUserId ? "🏆 You win!" : "You lost."}</span>
          )}
        </div>
        <div className="opacity-70">{hero ? `Hero: ${hero}` : null}</div>
      </div>

    </div>
  );
}

function PlayerProgress({ title, pct, wpm, acc, highlight = false }: { title: string; pct: number; wpm?: number; acc?: number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-4 ${highlight ? "border-emerald-500/60" : "border-slate-800"} bg-slate-900/60 border`}>
      <div className="flex justify-between mb-2">
        <div className="text-sm opacity-80">{title}</div>
        <div className="text-xs opacity-70">WPM: <b>{wpm ?? 0}</b> · ACC: <b>{acc ?? 100}%</b></div>
      </div>
      <Progress value={clamp(pct, 0, 100)} color={highlight ? "success" : "primary"} />
    </div>
  );

}

