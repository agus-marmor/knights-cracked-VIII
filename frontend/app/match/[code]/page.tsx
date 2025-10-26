"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { Button, Textarea, Progress } from "@heroui/react";
import { getToken, getCurrentUserId } from "@/lib/auth";

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

export default function MatchPage() {
  const { code } = useParams<{ code: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const hero = search.get("hero") || undefined;

  const myUserId = getCurrentUserId();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [match, setMatch] = useState<MatchSnapshot | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [finished, setFinished] = useState(false);
  const [winnerUserId, setWinnerUserId] = useState<string | null | undefined>(null);

  const [typed, setTyped] = useState<string>("");
  const [localWpm, setLocalWpm] = useState<number>(0);
  const [localAcc, setLocalAcc] = useState<number>(100);

  const lastEmitRef = useRef<number>(0);
  const THROTTLE_MS = 100;
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const promptScrollRef = useRef<HTMLPreElement>(null);
  const [prompt, setPrompt] = useState(match?.promptText || "Loading prompt...");
  useEffect(() => {
    if (!match?.promptText) {
      fetch('https://random-word-api.herokuapp.com/word?number=50')
        .then(res => res.json())
        .then((words: string[]) => setPrompt(words.join(' ')))
        .catch(() => setPrompt("Failed to load prompt"));
    } else {
      setPrompt(match.promptText);
    }
  }, [match]);
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

  // local WPM/accuracy
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => {
      const elapsedMs = Date.now() - startedAt.getTime();
      const minutes = elapsedMs / 60000;
      const gross = minutes > 0 ? typed.length / 5 / minutes : 0;
      const errors = countErrors(prompt.slice(0, typed.length), typed);
      const acc = typed.length ? clamp(100 * (1 - errors / typed.length), 0, 100) : 100;
      setLocalWpm(Math.round(gross));
      setLocalAcc(Math.round(acc));
    }, 250);
    return () => clearInterval(id);
  }, [startedAt, typed, prompt]);

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

  const onType = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setTyped(value);
      emitProgress(value);

      // scroll prompt to cursor
      if (promptScrollRef.current && textAreaRef.current) {
        const textarea = textAreaRef.current;
        const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight || "24");
        const cursorLine = textarea.value.substr(0, textarea.selectionStart).split("\n").length - 1;
        promptScrollRef.current.scrollTop = cursorLine * lineHeight;
      }
    },
    [emitProgress]
  );

  const onLeave = useCallback(() => router.push("/dashboard"), [router]);

  const myServerWpm = me?.wpm ?? localWpm;
  const myServerAcc = me?.accuracy ?? localAcc;
  const myProgressPct = maxLen > 0 ? Math.floor(((me?.charsTyped ?? typed.length) / maxLen) * 100) : 0;
  const oppProgressPct = maxLen > 0 ? Math.floor(((opponent?.charsTyped ?? 0) / maxLen) * 100) : 0;

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
            className="absolute top-0 left-0 w-full h-full pointer-events-none font-mono text-lg leading-6 p-3 whitespace-pre-wrap break-words overflow-y-auto z-20 box-border"
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
          <Textarea
            ref={textAreaRef}
            value={typed}
            onChange={onType}
            disabled={finished}
            size="lg"
            radius="md"
            disableAutosize
            rows={10}
            className="absolute top-0 left-0 w-full h-full font-mono text-lg leading-6 p-3 bg-slate-900 border border-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none z-10 box-border overflow-y-auto"
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
