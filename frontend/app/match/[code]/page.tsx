"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { Button, Textarea, Progress, Modal, ModalContent, ModalHeader, ModalBody } from "@heroui/react";
import { getToken, getCurrentUserId } from "@/lib/auth";
import { getMatchPrompt } from "@/lib/api";
import { motion } from "framer-motion";
type MatchPlayer = {
  userId: string;
  username: string;
  wpm?: number;
  accuracy?: number;
  character?: string;
  charsTyped?: number;
  errors?: number;
  finished?: boolean;
  finishedAt?: string | Date | null;
};

type MatchSnapshot = {
  id: string;
  code: string;
  status: "vs" | "countdown" | "playing" | "finished";
  promptText: string;
  startedAt?: string | Date;
  endedAt?: string | Date;
  winnerUserId?: string | null;
  vsEndsAt?: number; // epoch ms when VS should end (optional for late join sync)
  players: MatchPlayer[];
};

const SOCKET_SERVER_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";

// helpers
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function calculateWpm(typed: string, startedAt: Date | null) {
  if (!startedAt) return 0;
  const chars = typed.length;
  const minutes = (Date.now() - startedAt.getTime()) / 60000;
  return minutes > 0 ? Math.round(chars / 5 / minutes) : 0;
}

function formatDuration(startTime: string | Date | undefined, endTime: string | Date | undefined | null) {
  if (!startTime || !endTime) {
    return "--:--.---";
  }

  try {
    const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();

    if (isNaN(durationMs) || durationMs < 0) {
      return "00:00.000";
    }

    const totalSeconds = durationMs / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const milliseconds = durationMs % 1000;

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
  } catch (e) {
    return "--:--.---";
  }
}

function buildOverlayHtml(promptText: string, typedText: string) {
  if (!promptText) return "";

  const parts = promptText.match(/\S+\s*/g) || [];
  let charIndex = 0;
  const wordSpans: string[] = [];

  for (const part of parts) {
    const charSpans: string[] = [];

    for (let i = 0; i < part.length; i++) {
      const ch = part[i];
      const typedCh = typedText[charIndex];

      let cls = "opacity-50";
      let isError = false;
      let errorPopupHtml = "";

      if (typedCh !== undefined) {
        if (typedCh === ch) {
          cls = "text-emerald-400";
        } else {
          cls = "text-rose-400 underline";
          isError = true;
        }
      }

      const charToRender = ch;

      const esc = charToRender === " "
        ? "&nbsp;"
        : charToRender === "&" ? "&amp;"
          : charToRender === "<" ? "&lt;"
            : charToRender === ">" ? "&gt;"
              : charToRender === '"' ? "&quot;"
                : charToRender === "'" ? "&#039;"
                  : charToRender;

      if (isError) {
        const wrongChEsc = typedCh === " " ? "&nbsp;" :
          typedCh === "<" ? "&lt;" :
            typedCh === ">" ? "&gt;" :
              typedCh === "&" ? "&amp;" :
                typedCh;
        errorPopupHtml = `<span class="error-popup-char">typed: ${wrongChEsc}</span>`;
      }

      const isCaretChar = charIndex === typedText.length;

      charSpans.push(
        `<span class="${isCaretChar ? 'caret-char' : ''} ${cls}" style="display:inline-block;width:1ch;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,'Roboto Mono','Courier New',monospace;font-size:18px;line-height:24px;white-space:pre;position:relative;">` +
        errorPopupHtml +
        esc +
        `</span>`
      );

      charIndex++;
    }

    wordSpans.push(
      `<span style="display:inline-block;">${charSpans.join("")}</span>`
    );
  }

  if (typedText.length === promptText.length) {
    wordSpans.push(
      `<span style="display:inline-block;">` +
      `<span class="caret-char" style="display:inline-block;width:1ch;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,'Roboto Mono','Courier New',monospace;font-size:18px;line-height:24px;white-space:pre;position:relative;">&nbsp;</span>` +
      `</span>`
    );
  }

  return wordSpans.join("");
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
  const matchRef = useRef<MatchSnapshot | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [vsScreenVisible, setVsScreenVisible] = useState(false);
  const [getReadyVisible, setGetReadyVisible] = useState(false);
  const [hasVsScreenShown, setHasVsScreenShown] = useState(false);
  // Keep track of the VS hide timeout so we can clear it on unmount
  const vsTimeoutRef = useRef<number | null>(null);
  const getReadyTimeoutRef = useRef<number | null>(null);
  // Mirror visibility in a ref to avoid stale-closure issues inside socket callbacks
  const vsVisibleRef = useRef<boolean>(false);
  const getReadyVisibleRef = useRef<boolean>(false);
  useEffect(() => { vsVisibleRef.current = vsScreenVisible; }, [vsScreenVisible]);
  useEffect(() => { getReadyVisibleRef.current = getReadyVisible; }, [getReadyVisible]);
  // How long (ms) to show the VS overlay before revealing the numeric countdown.
  // Keep aligned with server vsMs so both clients see VS, then countdown.
  const VS_DISPLAY_MS = 6000;

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
  const heroImageMap: Record<string, string> = {
    mech: "/mech.png",
    kaiju: "/kaiju.png",
  };

  const myHeroKey = me?.character?.toLowerCase();
  const opponentHeroKey = opponent?.character?.toLowerCase();
  const myHeroSrc = myHeroKey ? heroImageMap[myHeroKey] : null;
  const opponentHeroSrc = opponentHeroKey ? heroImageMap[opponentHeroKey] : null;

  // Fallback hero images to display in the VS overlay while match data
  // may still be arriving. Prefer actual player selections, otherwise use
  // URL query `hero` for the local player and pick the opposite for the
  // opponent (defaulting to 'mech'/'kaiju').
  const overlayMyHeroKey = myHeroKey ?? (hero ? hero.toLowerCase() : 'mech');
  const overlayOppHeroKey = opponentHeroKey ?? (overlayMyHeroKey === 'mech' ? 'kaiju' : 'mech');
  const overlayMyHeroSrc = heroImageMap[overlayMyHeroKey] ?? Object.values(heroImageMap)[0];
  const overlayOppHeroSrc = heroImageMap[overlayOppHeroKey] ?? Object.values(heroImageMap)[1];

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!code) return;

    const token = getToken();
    if (!token) {
      console.error("[Socket] No token found! Cannot connect.");
      return;
    }

    const s = io(SOCKET_SERVER_URL, {
      auth: { token },
      query: {
        lobbyCode: code.toUpperCase(),
        token
      },
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    setSocket(s);
    socketRef.current = s;

    s.on("connect", () => {
      s.emit("match:subscribe", { code });
    });

    // Explicit VS event from server - this is now the authoritative VS trigger
    s.on("match:vs", ({ vsMs, code: vsCode }: { vsMs?: number, code?: string }) => {
      const duration = typeof vsMs === 'number' && vsMs > 0 ? vsMs : VS_DISPLAY_MS;
      try { console.log('[socket] match:vs', { vsMs: duration, t: Date.now() }); } catch(_){ }
      
      setHasVsScreenShown(true);
      setVsScreenVisible(true);
      vsVisibleRef.current = true;
      
      // Clear any prior timeout
      try {
        if (vsTimeoutRef.current) {
          window.clearTimeout(vsTimeoutRef.current as any);
        }
      } catch(_){}
      
      vsTimeoutRef.current = window.setTimeout(() => {
        setVsScreenVisible(false);
        vsVisibleRef.current = false;
        vsTimeoutRef.current = null;
        
        // Clear countdown to prevent blink
        setCountdown(null);
        
        // Show "GET READY" after VS ends
        setGetReadyVisible(true);
        getReadyVisibleRef.current = true;
        
        // Hide "GET READY" after 800ms (reduced from 1500ms)
        getReadyTimeoutRef.current = window.setTimeout(() => {
          setGetReadyVisible(false);
          getReadyVisibleRef.current = false;
          getReadyTimeoutRef.current = null;
        }, 800);
      }, duration);

      // Optional: acknowledge VS readiness
      s.emit("match:vs-ready", { code: vsCode || code });
    });

    s.on("connect_error", (e) => {
      console.error("[Socket] Connection error:", e.message);
    });

    s.on("match:update", (snapshot: MatchSnapshot) => {
      try { console.log('[socket] match:update', { snapshot, t: Date.now() }); } catch(_){ }
        setMatch(snapshot);
        matchRef.current = snapshot;

      // VS is now driven by explicit match:vs event, not snapshot status
      // Just update state here
      if (snapshot.status === "playing" && snapshot.startedAt) {
        setStartedAt(new Date(snapshot.startedAt));
      }
      if (snapshot.status === "finished") {
        setWinnerUserId(snapshot.winnerUserId);
        setFinished(true);
      }

      // Clear numeric countdown if no longer in countdown phase
      if (snapshot.status === 'playing' || snapshot.status === 'finished') {
        setCountdown(null);
      }
    });

    s.on("match:countdown", ({ secs }: { secs: number }) => {
      try { console.log('[socket] match:countdown', { secs, t: Date.now(), vsVisible: vsVisibleRef.current, getReadyVisible: getReadyVisibleRef.current }); } catch(_){ }
      // Ignore ticks while VS or GET READY is visible
      if (vsVisibleRef.current || getReadyVisibleRef.current) return;
      setCountdown(secs);
    });

    s.on("match:started", ({ startedAt }: { startedAt: string | Date }) => {
      try { console.log('[socket] match:started', { startedAt, t: Date.now() }); } catch(_){}
      // Clear any VS timeout so it won't later try to hide/show the overlay
      try {
        if (vsTimeoutRef.current) {
          window.clearTimeout(vsTimeoutRef.current as any);
          vsTimeoutRef.current = null;
        }
        if (getReadyTimeoutRef.current) {
          window.clearTimeout(getReadyTimeoutRef.current as any);
          getReadyTimeoutRef.current = null;
        }
      } catch (_) {}

      setVsScreenVisible(false);
      setGetReadyVisible(false);
      setCountdown(null);
      setStartedAt(new Date(startedAt));
      setHasVsScreenShown(true);
      requestAnimationFrame(() => {
        if (textAreaRef.current) {
          try {
            textAreaRef.current.focus();
            const len = textAreaRef.current.value.length;
            textAreaRef.current.setSelectionRange(len, len);
          } catch (err) { /* ignore focus errors */ }
        }
      });
    });

    const onBeforeUnload = () => {
      try {
        s.emit("match:unsubscribe", { code });
        s.emit("lobby:unsubscribe", { code });
      } catch (_) { }
      try { s.disconnect(); } catch (_) { }
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    s.on("match:progress", (payload: any) => {
      setMatch((prev) => {
        if (!prev) {
          return prev;
        }
        const players = prev.players.map((p) =>
          String(p.userId) === String(payload.userId)
            ? { ...p, ...payload }
            : p
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
      socketRef.current = null;
      // Clear any pending timeouts
      try {
        if (vsTimeoutRef.current) {
          window.clearTimeout(vsTimeoutRef.current as any);
          vsTimeoutRef.current = null;
        }
        if (getReadyTimeoutRef.current) {
          window.clearTimeout(getReadyTimeoutRef.current as any);
          getReadyTimeoutRef.current = null;
        }
      } catch (_) {}
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [code]);

  useEffect(() => {
    if (!textAreaRef.current || !promptScrollRef.current) return;
    const textarea = textAreaRef.current;
    const overlay = promptScrollRef.current;
    const syncScroll = () => {
      if (overlay.scrollTop !== textarea.scrollTop) {
        overlay.scrollTop = textarea.scrollTop;
      }
    };
    const intervalId = setInterval(syncScroll, 16);
    return () => clearInterval(intervalId);
  }, []);

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
      socketRef.current.emit("match:finish", payload, (ack?: { ok?: boolean; error?: string }) => {
        if (ack && ack.ok) {
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

  const firstErrorIndexRef = useRef<number | null>(null);
  const errorIndicesRef = useRef<Set<number>>(new Set());
  const [errorsTotal, setErrorsTotal] = useState<number>(0);
  const prevTypedRef = useRef<string>("");

  useEffect(() => {
    errorIndicesRef.current.clear();
    setErrorsTotal(0);
    prevTypedRef.current = "";
    setTyped("");
  }, [prompt, code]);

  const onType = useCallback(
    async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const s = socketRef.current;
      if (!s) {
        return;
      }

      if (match?.status === "finished" || match?.status === "countdown" || match?.status === "vs" || countdown !== null) {
        return;
      }

      let localStartedAt = startedAt;
      if (!localStartedAt) {
        localStartedAt = new Date();
        setStartedAt(localStartedAt);
      }

      let raw = e.target.value.replace(/\r?\n/g, "");
      let value = raw.slice(0, maxLen);

      const errorsSet = errorIndicesRef.current;
      let firstMismatch: number | null = null;
      for (let i = 0; i < value.length; i++) {
        const typedCh = value[i];
        const expected = prompt[i] ?? "";
        if (typedCh !== expected) {
          if (!errorsSet.has(i)) errorsSet.add(i);
          if (firstMismatch === null) firstMismatch = i;
        }
      }
      const errorsTotalNow = errorsSet.size;
      setErrorsTotal(errorsTotalNow);

      if (firstMismatch !== null) {
        firstErrorIndexRef.current = firstMismatch;
        const allowedLen = firstMismatch + 1;
        if (value.length > allowedLen) {
          value = value.slice(0, allowedLen);
        }
      } else {
        firstErrorIndexRef.current = null;
      }

      prevTypedRef.current = value;
      setTyped(value);

      const isFinished = (value.length >= maxLen) && (value[maxLen - 1] === prompt[maxLen - 1]);

      if (isFinished && !finished) {
        setFinished(true);
      }

      if (isFinished) {
        try {
          await emitWithAck("progress:update", {
            code,
            charsTyped: value.length,
            errors: errorsTotalNow,
            finished: true,
          }, 1000);
        } catch (err) {
          console.warn("[onType] final progress:update ack failed/timed out, emitting without ack", err);
          s.emit("progress:update", {
            code,
            charsTyped: value.length,
            errors: errorsTotalNow,
            finished: true,
          });
        }

        const finishedAt = new Date();
        const wpm = calculateWpm(value, localStartedAt);
        const finalAccuracy = maxLen > 0 ? Math.round(Math.max(0, 100 * (1 - (errorsTotalNow / maxLen)))) : 100;

        const finishPayload = {
          code,
          charsTyped: value.length,
          errors: errorsTotalNow,
          finished: true,
          startedAt: localStartedAt?.toISOString?.() ?? null,
          finishedAt: finishedAt.toISOString(),
          wpm,
          accuracy: finalAccuracy,
        };

        try {
          await emitWithAck("match:finish", finishPayload, 1500);
        } catch (err) {
          console.warn("[onType] match:finish ack timed out, falling back to retry emitter", err);
          sendFinishWithRetry(finishPayload, 3);
        }
      } else {
        s.emit("progress:update", {
          code,
          charsTyped: value.length,
          errors: errorsTotalNow,
          finished: false,
        });
      }

      requestAnimationFrame(() => {
        if (textAreaRef.current && promptScrollRef.current) {
          promptScrollRef.current.scrollTop = textAreaRef.current.scrollTop;
        }
      });
    },
    [prompt, finished, code, maxLen, startedAt, match, myUserId, sendFinishWithRetry, emitWithAck, countdown]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        return;
      }

      if (match?.status === "finished" || match?.status === "countdown" || match?.status === "vs" || countdown !== null) {
        e.preventDefault();
        return;
      }

      const ta = textAreaRef.current;
      if (!ta) return;

      const s = socketRef.current;

      const emitProgress = (value: string) => {
        if (s) {
          s.emit("progress:update", {
            code,
            charsTyped: value.length,
            errors: errorIndicesRef.current.size,
            finished: value.length >= maxLen,
          });
        }
      };

      const firstErr = firstErrorIndexRef.current;
      const allowedLen = firstErr !== null ? firstErr + 1 : maxLen;
      const isPrintable =
        e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (isPrintable) {
        const start = ta.selectionStart ?? 0;
        const end = ta.selectionEnd ?? start;
        const resultingLen = typed.length - (end - start) + 1;
        if (resultingLen > allowedLen) {
          e.preventDefault();
          return;
        }
      }

      if (e.key === "Backspace") {
        e.preventDefault();
        const start = ta.selectionStart ?? 0;
        const end = ta.selectionEnd ?? start;
        if (start === 0 && end === 0) return;

        const before = typed.slice(0, start);
        const after = typed.slice(end);
        const newValue = start === end ? before.slice(0, -1) + after : before + after;

        prevTypedRef.current = newValue;
        setTyped(newValue);
        const pos = Math.max(0, start === end ? start - 1 : start);
        requestAnimationFrame(() => ta.setSelectionRange(pos, pos));
        emitProgress(newValue);
        return;
      }

      if (e.key === "Delete") {
        e.preventDefault();
        const start = ta.selectionStart ?? 0;
        const end = ta.selectionEnd ?? start;
        if (start >= typed.length && start === end) return;

        const before = typed.slice(0, start);
        const after = typed.slice(end === start ? start + 1 : end);
        const newValue = before + after;

        prevTypedRef.current = newValue;
        setTyped(newValue);
        const pos = start;
        requestAnimationFrame(() => ta.setSelectionRange(pos, pos));
        emitProgress(newValue);
        return;
      }

      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        setTimeout(() => {
          const pos = ta.selectionStart ?? 0;
          if (pos > typed.length) {
            ta.setSelectionRange(typed.length, typed.length);
          }
        }, 0);
        return;
      }
    },
    [typed, prompt, match, countdown, code, maxLen]
  );

  const clientAccuracy = maxLen > 0 ? Math.round(Math.max(0, 100 * (1 - (errorsTotal / maxLen)))) : 100;
  const myServerWpm = me?.wpm ?? calculateWpm(typed, startedAt);
  const myServerAcc = me?.accuracy ?? clientAccuracy;
  const myProgressPct = maxLen > 0 ? Math.floor(((me?.charsTyped ?? typed.length) / maxLen) * 100) : 0;
  const oppProgressPct = maxLen > 0 ? Math.floor(((opponent?.charsTyped ?? 0) / maxLen) * 100) : 0;
  const iWon = (winnerUserId ?? match?.winnerUserId ?? null) === String(myUserId);
  const overlayHtml = useMemo(() => buildOverlayHtml(prompt, typed), [prompt, typed]);

  const onLeave = useCallback(() => {
    const s = socketRef.current;
    try {
      const up = code?.toUpperCase();
      if (s && up) {
        s.emit("match:unsubscribe", { code: up });
        s.emit("lobby:unsubscribe", { code: up });
        setTimeout(() => {
          try { s.disconnect(); } catch (_) { }
        }, 100);
      }
    } catch (err) {
      console.warn("[onLeave] error while emitting unsubscribe:", err);
    }
    router.push("/dashboard");
  }, [router, code]);

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

      {/* Left character (YOU) */}
      {myHeroSrc && (
        <img
          src={myHeroSrc}
          alt={me?.character || "Your Hero"}
          // use a valid Tailwind bottom spacing and keep image visible
          className="fixed left-5 bottom-24 w-48 h-auto object-contain z-20 animate-idle"
        />
      )}

      {/* Right character (OPPONENT) */}
      {opponentHeroSrc && (
        <img
          src={opponentHeroSrc}
          alt={opponent?.character || "Opponent Hero"}
          className="fixed right-5 bottom-24 w-48 h-auto object-contain z-20 animate-idle"
          style={{ animationDelay: '0.3s' }} /* Give it a slight offset */
        />
      )}
      {/* --- COUNTDOWN & VS ANIMATION OVERLAY --- */}
      {vsScreenVisible && (
        <motion.div
          className="absolute inset-0 flex items-center justify-center z-30 overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          style={{
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
          }}
        >
          {/* Animated grid background */}
          <div className="absolute inset-0 opacity-20">
            <div className="absolute inset-0" style={{
              backgroundImage: `
                linear-gradient(to right, #334155 1px, transparent 1px),
                linear-gradient(to bottom, #334155 1px, transparent 1px)
              `,
              backgroundSize: '40px 40px',
              animation: 'grid-scroll 20s linear infinite'
            }} />
          </div>

          {/* Glowing orbs */}
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-rose-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />

          {/* Player cards */}
          <div className="grid grid-cols-2 gap-16 items-center w-full max-w-5xl px-8 relative z-10">

            {/* Player 1 (Me) */}
            <motion.div
              className="flex flex-col items-center text-center relative"
              initial={{ x: "-100vw", rotate: -20 }}
              animate={{ x: 0, rotate: 0 }}
              transition={{ type: "spring", stiffness: 60, damping: 12, delay: 0.2 }}
            >
              <div className="relative">
                {/* Hexagonal border effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-400 to-cyan-600 opacity-30 blur-xl rounded-2xl transform scale-110" />
                <div className="relative bg-slate-800/80 backdrop-blur-sm p-6 rounded-2xl border-2 border-cyan-400/50 shadow-2xl">
                  <img 
                    src={overlayMyHeroSrc} 
                    alt={me?.character ?? overlayMyHeroKey} 
                    className="w-56 h-auto drop-shadow-2xl"
                  />
                  {/* Corner accents */}
                  <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-cyan-400" />
                  <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-cyan-400" />
                  <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-cyan-400" />
                  <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-cyan-400" />
                </div>
              </div>
              <h2 className="text-4xl font-black text-white mt-6 tracking-wider uppercase" style={{ 
                textShadow: '0 0 20px rgba(34, 211, 238, 0.8), 0 4px 8px rgba(0,0,0,0.8)',
                fontFamily: 'ui-monospace, monospace'
              }}>
                {me?.username ?? "You"}
              </h2>
              <span className="text-xl text-cyan-400 capitalize font-bold tracking-widest mt-2 px-4 py-1 bg-cyan-900/30 rounded-lg border border-cyan-500/50">
                {me?.character ?? overlayMyHeroKey}
              </span>
            </motion.div>

            {/* Player 2 (Opponent) */}
            <motion.div
              className="flex flex-col items-center text-center relative"
              initial={{ x: "100vw", rotate: 20 }}
              animate={{ x: 0, rotate: 0 }}
              transition={{ type: "spring", stiffness: 60, damping: 12, delay: 0.2 }}
            >
              <div className="relative">
                {/* Hexagonal border effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-rose-400 to-rose-600 opacity-30 blur-xl rounded-2xl transform scale-110" />
                <div className="relative bg-slate-800/80 backdrop-blur-sm p-6 rounded-2xl border-2 border-rose-400/50 shadow-2xl">
                  <img 
                    src={overlayOppHeroSrc} 
                    alt={opponent?.character ?? overlayOppHeroKey} 
                    className="w-56 h-auto drop-shadow-2xl"
                  />
                  {/* Corner accents */}
                  <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-rose-400" />
                  <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-rose-400" />
                  <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-rose-400" />
                  <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-rose-400" />
                </div>
              </div>
              <h2 className="text-4xl font-black text-white mt-6 tracking-wider uppercase" style={{ 
                textShadow: '0 0 20px rgba(251, 113, 133, 0.8), 0 4px 8px rgba(0,0,0,0.8)',
                fontFamily: 'ui-monospace, monospace'
              }}>
                {opponent?.username ?? "Opponent"}
              </h2>
              <span className="text-xl text-rose-400 capitalize font-bold tracking-widest mt-2 px-4 py-1 bg-rose-900/30 rounded-lg border border-rose-500/50">
                {opponent?.character ?? overlayOppHeroKey}
              </span>
            </motion.div>
          </div>

          {/* --- ROBOTIC "VS" TEXT --- */}
          <div className="absolute flex items-center justify-center">
            <motion.div 
              className="relative"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 100, damping: 10, delay: 0.5 }}
            >
              {/* Glowing background circle */}
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/20 to-rose-500/20 rounded-full blur-3xl transform scale-150 animate-pulse" />
              
              {/* Main VS container */}
              <div className="relative flex items-center justify-center gap-3 px-8 py-6 bg-slate-900/90 backdrop-blur-md rounded-2xl border-4 border-slate-700 shadow-2xl">
                {/* Circuit pattern background */}
                <div className="absolute inset-0 opacity-10 rounded-2xl overflow-hidden">
                  <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                    <pattern id="circuit" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                      <circle cx="5" cy="5" r="2" fill="#64748b" />
                      <path d="M5 5 L35 5 M5 5 L5 35" stroke="#64748b" strokeWidth="1" fill="none" />
                    </pattern>
                    <rect width="100%" height="100%" fill="url(#circuit)" />
                  </svg>
                </div>

                {/* Left bracket */}
                <motion.span 
                  className="text-cyan-400 font-black text-7xl relative z-10"
                  initial={{ x: -50, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.7, duration: 0.3 }}
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    textShadow: '0 0 30px rgba(34, 211, 238, 0.8), 0 0 60px rgba(34, 211, 238, 0.4)',
                  }}
                >
                  {'['}
                </motion.span>

                {/* V letter */}
                <motion.span
                  className="font-black text-8xl relative z-10"
                  initial={{ y: -100, opacity: 0, rotate: -45 }}
                  animate={{ y: 0, opacity: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 120, damping: 8, delay: 0.8 }}
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    background: 'linear-gradient(135deg, #22d3ee 0%, #06b6d4 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    textShadow: '0 0 40px rgba(34, 211, 238, 0.6)',
                    filter: 'drop-shadow(0 0 20px rgba(34, 211, 238, 0.8))',
                  }}
                >
                  V
                </motion.span>

                {/* Separator - animated lightning bolt */}
                <motion.div
                  className="relative"
                  animate={{ 
                    opacity: [0.5, 1, 0.5],
                    scale: [1, 1.1, 1],
                  }}
                  transition={{ 
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                >
                  <svg width="30" height="60" viewBox="0 0 30 60" className="relative z-10">
                    <path 
                      d="M15 0 L10 25 L20 25 L15 60 L25 30 L15 30 Z" 
                      fill="url(#lightning-gradient)"
                      filter="url(#glow)"
                    />
                    <defs>
                      <linearGradient id="lightning-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#fbbf24" />
                        <stop offset="100%" stopColor="#f59e0b" />
                      </linearGradient>
                      <filter id="glow">
                        <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                        <feMerge>
                          <feMergeNode in="coloredBlur"/>
                          <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                      </filter>
                    </defs>
                  </svg>
                </motion.div>

                {/* S letter */}
                <motion.span
                  className="font-black text-8xl relative z-10"
                  initial={{ y: 100, opacity: 0, rotate: 45 }}
                  animate={{ y: 0, opacity: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 120, damping: 8, delay: 0.8 }}
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    background: 'linear-gradient(135deg, #fb7185 0%, #f43f5e 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    textShadow: '0 0 40px rgba(251, 113, 133, 0.6)',
                    filter: 'drop-shadow(0 0 20px rgba(251, 113, 133, 0.8))',
                  }}
                >
                  S
                </motion.span>

                {/* Right bracket */}
                <motion.span 
                  className="text-rose-400 font-black text-7xl relative z-10"
                  initial={{ x: 50, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.7, duration: 0.3 }}
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    textShadow: '0 0 30px rgba(251, 113, 133, 0.8), 0 0 60px rgba(251, 113, 133, 0.4)',
                  }}
                >
                  {']'}
                </motion.span>

                {/* Corner tech details */}
                <div className="absolute -top-2 -left-2 w-3 h-3 bg-cyan-400 rounded-sm animate-pulse" />
                <div className="absolute -top-2 -right-2 w-3 h-3 bg-rose-400 rounded-sm animate-pulse" style={{ animationDelay: '0.5s' }} />
                <div className="absolute -bottom-2 -left-2 w-3 h-3 bg-cyan-400 rounded-sm animate-pulse" style={{ animationDelay: '1s' }} />
                <div className="absolute -bottom-2 -right-2 w-3 h-3 bg-rose-400 rounded-sm animate-pulse" style={{ animationDelay: '1.5s' }} />
              </div>

              {/* Scanning lines effect */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-b from-transparent via-white/5 to-transparent h-full"
                animate={{ y: ['-100%', '200%'] }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              />
            </motion.div>
          </div>
          {/* --- END OF "VS" TEXT --- */}

        </motion.div>
      )}

      {/* GET READY Screen */}
      {getReadyVisible && (
        <motion.div
          key="get-ready-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-20 flex items-center justify-center"
          style={{
            background: 'linear-gradient(to bottom, rgb(15, 23, 42), rgb(30, 41, 59))'
          }}
        >
          {/* Animated grid background */}
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: `
                linear-gradient(rgba(6, 182, 212, 0.3) 1px, transparent 1px),
                linear-gradient(90deg, rgba(6, 182, 212, 0.3) 1px, transparent 1px)
              `,
              backgroundSize: '40px 40px',
              animation: 'grid-scroll 20s linear infinite'
            }}
          />

          {/* Glowing orbs */}
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-rose-500/20 rounded-full blur-3xl" />

          {/* GET READY text */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="relative z-10"
          >
            {/* Outer glow */}
            <div
              className="absolute inset-0"
              style={{
                background: 'radial-gradient(ellipse, rgba(6, 182, 212, 0.4) 0%, transparent 70%)',
                filter: 'blur(40px)',
                transform: 'scale(1.5)'
              }}
            />

            {/* Main text container */}
            <div className="relative flex items-center gap-8">
              {/* Left bracket */}
              <motion.div
                className="text-cyan-400 text-6xl font-bold"
                style={{ fontFamily: "'Courier New', monospace" }}
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                {'<<'}
              </motion.div>

              {/* GET READY text */}
              <div
                className="text-7xl font-bold tracking-wider"
                style={{
                  fontFamily: "'Courier New', monospace",
                  background: 'linear-gradient(to right, rgb(6, 182, 212), rgb(244, 63, 94))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  textShadow: '0 0 40px rgba(6, 182, 212, 0.8)',
                  filter: 'drop-shadow(0 0 30px rgba(6, 182, 212, 0.6))'
                }}
              >
                GET READY
              </div>

              {/* Right bracket */}
              <motion.div
                className="text-rose-400 text-6xl font-bold"
                style={{ fontFamily: "'Courier New', monospace" }}
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                {'>>'}
              </motion.div>
            </div>

            {/* Underline effect */}
            <motion.div
              className="absolute -bottom-4 left-0 right-0 h-1 bg-gradient-to-r from-cyan-400 via-purple-500 to-rose-400"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              style={{
                boxShadow: '0 0 20px rgba(6, 182, 212, 0.8)'
              }}
            />
          </motion.div>

          {/* Pulsing rings */}
          <motion.div
            className="absolute w-96 h-96 rounded-full border-2 border-cyan-400/30"
            animate={{
              scale: [1, 1.5],
              opacity: [0.5, 0]
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeOut"
            }}
          />
          <motion.div
            className="absolute w-96 h-96 rounded-full border-2 border-rose-400/30"
            animate={{
              scale: [1, 1.5],
              opacity: [0.5, 0]
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeOut",
              delay: 0.75
            }}
          />

          {/* Scanning lines effect */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-b from-transparent via-white/5 to-transparent h-full"
            animate={{ y: ['-100%', '200%'] }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          />
        </motion.div>
      )}

      {!vsScreenVisible && !getReadyVisible && countdown !== null && (
        <motion.div
          key="countdown-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-20 flex items-center justify-center"
          style={{
            background: 'linear-gradient(to bottom, rgb(15, 23, 42), rgb(30, 41, 59))'
          }}
        >
          {/* Animated grid background */}
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: `
                linear-gradient(rgba(6, 182, 212, 0.3) 1px, transparent 1px),
                linear-gradient(90deg, rgba(6, 182, 212, 0.3) 1px, transparent 1px)
              `,
              backgroundSize: '40px 40px',
              animation: 'grid-scroll 20s linear infinite'
            }}
          />

          {/* Glowing orbs */}
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-rose-500/20 rounded-full blur-3xl" />

          {/* Countdown number container */}
          <motion.div
            key={countdown}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.2, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="relative z-10"
          >
            {/* Hexagonal frame */}
            <div className="relative flex items-center justify-center">
              {/* Outer glow */}
              <div
                className="absolute w-80 h-80"
                style={{
                  background: 'radial-gradient(circle, rgba(6, 182, 212, 0.4) 0%, transparent 70%)',
                  filter: 'blur(30px)'
                }}
              />

              {/* Main hexagonal container */}
              <div
                className="relative w-64 h-64 flex items-center justify-center"
                style={{
                  clipPath: 'polygon(30% 0%, 70% 0%, 100% 50%, 70% 100%, 30% 100%, 0% 50%)',
                  background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(244, 63, 94, 0.1))',
                  border: '2px solid rgba(6, 182, 212, 0.5)',
                  boxShadow: `
                    0 0 20px rgba(6, 182, 212, 0.5),
                    inset 0 0 20px rgba(6, 182, 212, 0.2)
                  `
                }}
              >
                {/* Inner hexagon */}
                <div
                  className="absolute w-56 h-56"
                  style={{
                    clipPath: 'polygon(30% 0%, 70% 0%, 100% 50%, 70% 100%, 30% 100%, 0% 50%)',
                    border: '1px solid rgba(6, 182, 212, 0.3)'
                  }}
                />

                {/* Countdown number */}
                <motion.div
                  initial={{ scale: 1.2 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.2 }}
                  className="text-9xl font-bold"
                  style={{
                    fontFamily: "'Courier New', monospace",
                    background: 'linear-gradient(to bottom, rgb(6, 182, 212), rgb(244, 63, 94))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    textShadow: '0 0 30px rgba(6, 182, 212, 0.8)',
                    filter: 'drop-shadow(0 0 20px rgba(6, 182, 212, 0.6))'
                  }}
                >
                  {countdown}
                </motion.div>
              </div>

              {/* Corner accents */}
              <div className="absolute -top-4 -left-4 w-8 h-8 border-t-2 border-l-2 border-cyan-400" />
              <div className="absolute -top-4 -right-4 w-8 h-8 border-t-2 border-r-2 border-cyan-400" />
              <div className="absolute -bottom-4 -left-4 w-8 h-8 border-b-2 border-l-2 border-rose-400" />
              <div className="absolute -bottom-4 -right-4 w-8 h-8 border-b-2 border-r-2 border-rose-400" />
            </div>

            {/* Tech brackets */}
            <div
              className="absolute -left-16 top-1/2 -translate-y-1/2 text-cyan-400 text-4xl font-bold"
              style={{ fontFamily: "'Courier New', monospace" }}
            >
              {'['}
            </div>
            <div
              className="absolute -right-16 top-1/2 -translate-y-1/2 text-rose-400 text-4xl font-bold"
              style={{ fontFamily: "'Courier New', monospace" }}
            >
              {']'}
            </div>
          </motion.div>

          {/* Pulsing ring */}
          <motion.div
            className="absolute w-96 h-96 rounded-full border-2 border-cyan-400/30"
            animate={{
              scale: [1, 1.3],
              opacity: [0.5, 0]
            }}
            transition={{
              duration: 1,
              repeat: Infinity,
              ease: "easeOut"
            }}
          />

          {/* Scanning lines effect */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-b from-transparent via-white/5 to-transparent h-full"
            animate={{ y: ['-100%', '200%'] }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          />
        </motion.div>
      )}

      {/* Typing area */}
      <div className="max-w-7xl mx-auto w-full px-6 py-8 flex-1 flex flex-col gap-6">
        
        {/* Top HUD - Player Stats Bar */}
        <div className="grid grid-cols-2 gap-6">
          {/* Player 1 (You) - Left Side */}
          <motion.div
            initial={{ x: -50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="relative"
          >
            <div className="relative bg-gradient-to-br from-cyan-900/30 via-slate-900/50 to-slate-900/30 border-2 border-cyan-500/60 rounded-xl p-5 backdrop-blur-sm shadow-lg shadow-cyan-500/20">
              {/* Corner accents */}
              <div className="absolute -top-1.5 -left-1.5 w-6 h-6 border-t-2 border-l-2 border-cyan-400 rounded-tl" />
              <div className="absolute -top-1.5 -right-1.5 w-6 h-6 border-t-2 border-r-2 border-cyan-400 rounded-tr" />
              
              <div className="flex items-center gap-4">
                {/* Avatar/Character */}
                <div className="relative flex-shrink-0">
                  <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-cyan-500/30 to-cyan-600/20 border-2 border-cyan-400 flex items-center justify-center overflow-hidden shadow-lg">
                    {me?.character ? (
                      <div className="text-4xl">{me.character}</div>
                    ) : (
                      <div className="text-cyan-300 font-bold text-sm tracking-wider" style={{ fontFamily: "'Courier New', monospace" }}>YOU</div>
                    )}
                  </div>
                  {/* Level badge */}
                  <div className="absolute -top-2 -right-2 bg-gradient-to-br from-cyan-400 to-cyan-600 text-white text-xs font-bold rounded-full w-7 h-7 flex items-center justify-center border-2 border-slate-900 shadow-lg">
                    1
                  </div>
                </div>
                
                {/* Player info */}
                <div className="flex-1 min-w-0">
                  <div className="text-cyan-200 font-bold text-xs truncate mb-2" style={{ fontFamily: "'Courier New', monospace", maxWidth: '100%' }}>
                    {me?.username ?? "You"}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-slate-800/60 rounded px-2 py-1 border border-cyan-500/30">
                      <div className="text-cyan-400/70 text-[10px]">WPM</div>
                      <div className="font-bold text-white text-sm">{myServerWpm ?? 0}</div>
                    </div>
                    <div className="bg-slate-800/60 rounded px-2 py-1 border border-cyan-500/30">
                      <div className="text-cyan-400/70 text-[10px]">ACC</div>
                      <div className="font-bold text-white text-sm">{myServerAcc ?? 100}%</div>
                    </div>
                    <div className="bg-slate-800/60 rounded px-2 py-1 border border-cyan-500/30">
                      <div className="text-cyan-400/70 text-[10px]">ERR</div>
                      <div className="font-bold text-white text-sm">{me?.errors ?? errorsTotal}</div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Progress bar */}
              <div className="mt-4 relative">
                <div className="h-4 bg-slate-800/80 rounded-full overflow-hidden border-2 border-cyan-500/40 shadow-inner">
                  <motion.div
                    className="h-full bg-gradient-to-r from-cyan-500 via-cyan-400 to-cyan-300 relative"
                    initial={{ width: "0%" }}
                    animate={{ width: `${clamp(myProgressPct, 0, 100)}%` }}
                    transition={{ type: "spring", stiffness: 100, damping: 20 }}
                  >
                    {/* Animated shine */}
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent"
                      animate={{ x: ['-100%', '200%'] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    />
                  </motion.div>
                </div>
                <div className="text-sm text-cyan-200 font-bold mt-2 text-right" style={{ fontFamily: "'Courier New', monospace" }}>
                  PROGRESS: {myProgressPct}%
                </div>
              </div>
            </div>
          </motion.div>

          {/* Player 2 (Opponent) - Right Side */}
          <motion.div
            initial={{ x: 50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="relative"
          >
            <div className="relative bg-gradient-to-bl from-rose-900/30 via-slate-900/50 to-slate-900/30 border-2 border-rose-500/60 rounded-xl p-5 backdrop-blur-sm shadow-lg shadow-rose-500/20">
              {/* Corner accents */}
              <div className="absolute -top-1.5 -left-1.5 w-6 h-6 border-t-2 border-l-2 border-rose-400 rounded-tl" />
              <div className="absolute -top-1.5 -right-1.5 w-6 h-6 border-t-2 border-r-2 border-rose-400 rounded-tr" />
              
              <div className="flex items-center gap-4">
                {/* Player info */}
                <div className="flex-1 min-w-0 text-right">
                  <div className="text-rose-200 font-bold text-xs truncate mb-2" style={{ fontFamily: "'Courier New', monospace", maxWidth: '100%' }}>
                    {opponent?.username ?? "Opponent"}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-slate-800/60 rounded px-2 py-1 border border-rose-500/30">
                      <div className="text-rose-400/70 text-[10px]">WPM</div>
                      <div className="font-bold text-white text-sm">{opponent?.wpm ?? 0}</div>
                    </div>
                    <div className="bg-slate-800/60 rounded px-2 py-1 border border-rose-500/30">
                      <div className="text-rose-400/70 text-[10px]">ACC</div>
                      <div className="font-bold text-white text-sm">{opponent?.accuracy ?? 100}%</div>
                    </div>
                    <div className="bg-slate-800/60 rounded px-2 py-1 border border-rose-500/30">
                      <div className="text-rose-400/70 text-[10px]">ERR</div>
                      <div className="font-bold text-white text-sm">{opponent?.errors ?? 0}</div>
                    </div>
                  </div>
                </div>
                
                {/* Avatar/Character */}
                <div className="relative flex-shrink-0">
                  <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-rose-500/30 to-rose-600/20 border-2 border-rose-400 flex items-center justify-center overflow-hidden shadow-lg">
                    {opponent?.character ? (
                      <div className="text-4xl">{opponent.character}</div>
                    ) : (
                      <div className="text-rose-300 font-bold text-sm tracking-wider" style={{ fontFamily: "'Courier New', monospace" }}>OPP</div>
                    )}
                  </div>
                  {/* Level badge */}
                  <div className="absolute -top-2 -left-2 bg-gradient-to-br from-rose-400 to-rose-600 text-white text-xs font-bold rounded-full w-7 h-7 flex items-center justify-center border-2 border-slate-900 shadow-lg">
                    2
                  </div>
                </div>
              </div>
              
              {/* Progress bar */}
              <div className="mt-4 relative">
                <div className="h-4 bg-slate-800/80 rounded-full overflow-hidden border-2 border-rose-500/40 shadow-inner">
                  <motion.div
                    className="h-full bg-gradient-to-r from-rose-500 via-rose-400 to-rose-300 relative ml-auto"
                    initial={{ width: "0%" }}
                    animate={{ width: `${clamp(oppProgressPct, 0, 100)}%` }}
                    transition={{ type: "spring", stiffness: 100, damping: 20 }}
                    style={{ float: 'right' }}
                  >
                    {/* Animated shine */}
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent"
                      animate={{ x: ['-100%', '200%'] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    />
                  </motion.div>
                </div>
                <div className="text-sm text-rose-200 font-bold mt-2" style={{ fontFamily: "'Courier New', monospace" }}>
                  PROGRESS: {oppProgressPct}%
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Main typing arena */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="relative w-full h-[450px] mt-4"
        >
          {/* Top label - positioned above the container, hidden during VS/countdown */}
          {!vsScreenVisible && !getReadyVisible && countdown === null && (
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-900 px-6 py-1.5 border-2 border-purple-500/60 rounded-full shadow-lg z-40">
              <span className="text-sm text-purple-300 font-bold tracking-widest" style={{ fontFamily: "'Courier New', monospace" }}>
                TYPING ARENA
              </span>
            </div>
          )}

          {/* Outer container with glow */}
          <div className="relative w-full h-full">
            {/* Animated border glow */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 via-purple-500 to-rose-500 rounded-xl blur-sm opacity-40" />
            
            {/* Main typing box */}
            <div className="relative w-full h-full bg-slate-900/95 border-2 border-slate-700/80 rounded-xl overflow-hidden backdrop-blur-sm">
              {/* Grid background */}
              <div
                className="absolute inset-0 opacity-5"
                style={{
                  backgroundImage: `
                    linear-gradient(rgba(6, 182, 212, 0.3) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(6, 182, 212, 0.3) 1px, transparent 1px)
                  `,
                  backgroundSize: '40px 40px'
                }}
              />
              
              {/* Corner tech elements - smaller and more refined */}
              <div className="absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 border-cyan-500/40 rounded-tl" />
              <div className="absolute top-0 right-0 w-16 h-16 border-t-2 border-r-2 border-rose-500/40 rounded-tr" />
              <div className="absolute bottom-0 left-0 w-16 h-16 border-b-2 border-l-2 border-cyan-500/40 rounded-bl" />
              <div className="absolute bottom-0 right-0 w-16 h-16 border-b-2 border-r-2 border-rose-500/40 rounded-br" />

              {/* Prompt overlay */}
              <pre
                ref={promptScrollRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none font-mono text-lg leading-6 whitespace-pre-wrap overflow-y-auto z-20"
                style={{
                  paddingTop: '1.5rem',
                  paddingLeft: '1.5rem',
                  paddingRight: '1.5rem',
                  paddingBottom: '1.5rem',
                  margin: 0,
                  boxSizing: 'border-box',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace',
                  fontSize: '18px',
                  lineHeight: '28px',
                  letterSpacing: 'normal',
                  fontVariantLigatures: 'none'
                }}
                dangerouslySetInnerHTML={{ __html: overlayHtml }}
              />

              {/* Textarea */}
              <textarea
                ref={textAreaRef}
                value={typed}
                onChange={onType}
                onKeyDown={onKeyDown}
                onPaste={(e) => {
                  e.preventDefault();
                  const pasted = (e.clipboardData || (window as any).clipboardData).getData("text").replace(/\r?\n/g, "");
                  const base = textAreaRef.current?.value ?? "";
                  let combined = (base + pasted).slice(0, maxLen);

                  const errorsSet = errorIndicesRef.current;
                  for (let i = 0; i < combined.length; i++) {
                    const typedCh = combined[i];
                    const expected = prompt[i] ?? "";
                    if (typedCh !== expected && !errorsSet.has(i)) errorsSet.add(i);
                  }
                  const errorsTotalNow = errorsSet.size;
                  setErrorsTotal(errorsTotalNow);

                  setTyped(combined);
                  const isFinished = combined.length >= maxLen;
                  const s = socketRef.current;
                  if (!s) return;

                  s.emit("progress:update", {
                    code,
                    charsTyped: combined.length,
                    errors: errorsTotalNow,
                    finished: isFinished,
                  });

                  if (isFinished) {
                    const finishedAt = new Date();
                    const wpm = calculateWpm(combined, startedAt ?? new Date());
                    const finalAccuracy = maxLen > 0 ? Math.round(Math.max(0, 100 * (1 - (errorsTotalNow / maxLen)))) : 100;

                    const finishPayload = {
                      code,
                      charsTyped: combined.length,
                      errors: errorsTotalNow,
                      finished: true,
                      startedAt: (startedAt ?? new Date()).toISOString(),
                      finishedAt: finishedAt.toISOString(),
                      wpm,
                      accuracy: finalAccuracy,
                    };
                    emitWithAck("match:finish", finishPayload, 1500).catch(() => sendFinishWithRetry(finishPayload, 3));
                    setFinished(true);
                  }
                }}
                onScroll={(e) => {
                  if (promptScrollRef.current) {
                    promptScrollRef.current.scrollTop = e.currentTarget.scrollTop;
                  }
                }}
                disabled={finished || match?.status === "countdown" || match?.status === "vs" || countdown !== null}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                wrap="soft"
                className="absolute top-0 left-0 w-full h-full font-mono text-lg leading-6 bg-transparent border-none focus:outline-none resize-none z-10 caret-white text-transparent overflow-y-auto whitespace-pre-wrap box-border"
                style={{
                  paddingTop: '1.5rem',
                  paddingLeft: '1.5rem',
                  paddingRight: '1.5rem',
                  paddingBottom: '1.5rem',
                  margin: 0,
                  caretColor: 'transparent',
                  whiteSpace: 'pre-wrap',
                  boxSizing: 'border-box',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace',
                  fontSize: '18px',
                  lineHeight: '28px',
                  letterSpacing: 'normal',
                  fontVariantLigatures: 'none'
                }}
              />
            </div>
          </div>
        </motion.div>
      </div>


      {/* --- RESULTS MODAL --- */}
      <Modal isOpen={finished || match?.status === "finished"} onClose={onLeave}>
        <motion.div
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 25 }}
        >
          <ModalContent className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-2 border-purple-500/50 shadow-2xl shadow-purple-500/20">
            <ModalHeader className="flex flex-col items-center gap-2 pb-2 pt-6">
              {/* Winner announcement with gradient */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                className="relative"
              >
                <h2 
                  className={`text-5xl font-bold tracking-wider ${
                    iWon 
                      ? 'bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent' 
                      : 'bg-gradient-to-r from-rose-400 via-pink-400 to-rose-400 bg-clip-text text-transparent'
                  }`}
                  style={{ fontFamily: "'Courier New', monospace" }}
                >
                  {iWon ? "VICTORY!" : "DEFEAT"}
                </h2>
                {/* Glowing underline */}
                <div className={`h-1 w-full mt-2 rounded-full ${iWon ? 'bg-emerald-400' : 'bg-rose-400'} shadow-lg ${iWon ? 'shadow-emerald-400/50' : 'shadow-rose-400/50'}`} />
              </motion.div>
              
              {/* Subtitle */}
              <p className="text-gray-400 text-sm tracking-wider" style={{ fontFamily: "'Courier New', monospace" }}>
                {iWon ? "FLAWLESS EXECUTION" : "BATTLE LOST"}
              </p>
            </ModalHeader>
            
            <ModalBody className="px-6 pb-6">
              <div className="space-y-6">
                {/* VS Badge */}
                <div className="flex items-center justify-center gap-4">
                  <div className="flex-1 h-px bg-gradient-to-r from-transparent via-cyan-500 to-transparent" />
                  <div className="bg-purple-900/40 border-2 border-purple-500/60 rounded-full px-4 py-1 backdrop-blur-sm">
                    <span className="text-sm font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-rose-400 bg-clip-text text-transparent" style={{ fontFamily: "'Courier New', monospace" }}>
                      VS
                    </span>
                  </div>
                  <div className="flex-1 h-px bg-gradient-to-l from-transparent via-rose-500 to-transparent" />
                </div>

                {/* Stats Comparison */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Player Stats Card */}
                  <motion.div 
                    initial={{ x: -50, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className={`relative p-5 rounded-xl backdrop-blur-sm ${
                      iWon 
                        ? 'bg-gradient-to-br from-emerald-900/40 via-cyan-900/30 to-slate-900/40 border-2 border-emerald-500/60 shadow-lg shadow-emerald-500/20' 
                        : 'bg-gradient-to-br from-slate-800/60 to-slate-900/60 border-2 border-slate-700'
                    }`}
                  >
                    {/* Corner accent */}
                    <div className={`absolute -top-1 -left-1 w-6 h-6 border-t-2 border-l-2 ${iWon ? 'border-emerald-400' : 'border-cyan-500'} rounded-tl`} />
                    
                    <div className="text-center space-y-3">
                      <div className="text-lg font-bold text-cyan-300" style={{ fontFamily: "'Courier New', monospace" }}>
                        {me?.username ?? "YOU"}
                      </div>
                      
                      {/* WPM */}
                      <div>
                        <div className="text-4xl font-bold text-white font-mono">
                          {me?.wpm ?? myServerWpm ?? 0}
                        </div>
                        <div className="text-xs text-gray-400 tracking-wider" style={{ fontFamily: "'Courier New', monospace" }}>WPM</div>
                      </div>
                      
                      {/* Accuracy */}
                      <div>
                        <div className="text-2xl font-bold text-emerald-400 font-mono">
                          {me?.accuracy ?? myServerAcc ?? 100}%
                        </div>
                        <div className="text-xs text-gray-400 tracking-wider" style={{ fontFamily: "'Courier New', monospace" }}>ACCURACY</div>
                      </div>
                      
                      {/* Time */}
                      <div>
                        <div className="text-xl font-bold text-purple-400 font-mono">
                          {formatDuration(match?.startedAt, me?.finishedAt)}
                        </div>
                        <div className="text-xs text-gray-400 tracking-wider" style={{ fontFamily: "'Courier New', monospace" }}>TIME</div>
                      </div>
                      
                      {/* Characters */}
                      <div className="text-xs text-gray-500 pt-2 border-t border-slate-700">
                        {me?.charsTyped ?? typed.length} / {maxLen} chars
                      </div>
                    </div>
                  </motion.div>

                  {/* Opponent Stats Card */}
                  <motion.div 
                    initial={{ x: 50, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className={`relative p-5 rounded-xl backdrop-blur-sm ${
                      !iWon 
                        ? 'bg-gradient-to-br from-emerald-900/40 via-cyan-900/30 to-slate-900/40 border-2 border-emerald-500/60 shadow-lg shadow-emerald-500/20' 
                        : 'bg-gradient-to-br from-slate-800/60 to-slate-900/60 border-2 border-slate-700'
                    }`}
                  >
                    {/* Corner accent */}
                    <div className={`absolute -top-1 -right-1 w-6 h-6 border-t-2 border-r-2 ${!iWon ? 'border-emerald-400' : 'border-rose-500'} rounded-tr`} />
                    
                    <div className="text-center space-y-3">
                      <div className="text-lg font-bold text-rose-300" style={{ fontFamily: "'Courier New', monospace" }}>
                        {opponent?.username ?? "OPPONENT"}
                      </div>
                      
                      {/* WPM */}
                      <div>
                        <div className="text-4xl font-bold text-white font-mono">
                          {opponent?.wpm ?? 0}
                        </div>
                        <div className="text-xs text-gray-400 tracking-wider" style={{ fontFamily: "'Courier New', monospace" }}>WPM</div>
                      </div>
                      
                      {/* Accuracy */}
                      <div>
                        <div className="text-2xl font-bold text-emerald-400 font-mono">
                          {opponent?.accuracy ?? 100}%
                        </div>
                        <div className="text-xs text-gray-400 tracking-wider" style={{ fontFamily: "'Courier New', monospace" }}>ACCURACY</div>
                      </div>
                      
                      {/* Time */}
                      <div>
                        <div className="text-xl font-bold text-purple-400 font-mono">
                          {formatDuration(match?.startedAt, opponent?.finishedAt)}
                        </div>
                        <div className="text-xs text-gray-400 tracking-wider" style={{ fontFamily: "'Courier New', monospace" }}>TIME</div>
                      </div>
                      
                      {/* Characters */}
                      <div className="text-xs text-gray-500 pt-2 border-t border-slate-700">
                        {opponent?.charsTyped ?? 0} / {maxLen} chars
                      </div>
                    </div>
                  </motion.div>
                </div>

                {/* Button to leave */}
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.5 }}
                >
                  <Button
                    onPress={onLeave}
                    className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold py-6 text-lg shadow-lg shadow-purple-500/30 transition-all duration-300 hover:shadow-xl hover:shadow-purple-500/40 uppercase tracking-wider border-2 border-purple-400/50"
                    style={{ fontFamily: "'Courier New', monospace" }}
                  >
                    Return to Dashboard
                  </Button>
                </motion.div>
              </div>
            </ModalBody>
          </ModalContent>
        </motion.div>
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
  const progressColor = highlight ? "bg-emerald-500" : "bg-cyan-500";

  return (
    <div className={`rounded-lg p-4 ${highlight ? "border-emerald-500/60" : "border-slate-800"} bg-slate-900/60 border`}>
      <div className="flex justify-between mb-2">
        <div className="text-sm opacity-80">{title}</div>
        <div className="text-xs opacity-70">
          WPM: <b>{wpm ?? 0}</b> · ACC: <b>{acc ?? 100}%</b>
        </div>
      </div>

      {/* This replaces your <Progress> component */}
      <div className="w-full bg-slate-700 rounded-full h-2.5">
        <motion.div
          className={`h-2.5 rounded-full ${progressColor}`}
          initial={{ width: "0%" }}
          animate={{ width: `${clamp(pct, 0, 100)}%` }}
          transition={{ type: "spring", stiffness: 100, damping: 20 }}
        />
      </div>
    </div>
  );
}