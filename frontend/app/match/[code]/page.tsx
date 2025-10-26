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

// NEW: build overlay HTML with 1ch boxes per character so wrapping matches textarea exactly
function buildOverlayHtml(promptText: string, typedText: string) {
  if (!promptText) return "";
  const parts: string[] = [];
  for (let i = 0; i < promptText.length; i++) {
    const ch = promptText[i];
    const typedCh = typedText[i];
    // render spaces as NBSP so they occupy width even at line ends
    const esc = ch === " "
      ? "&nbsp;"
      : ch === "&" ? "&amp;"
      : ch === "<" ? "&lt;"
      : ch === ">" ? "&gt;"
      : ch === '"' ? "&quot;"
      : ch === "'" ? "&#039;"
      : ch;

    let cls = "opacity-50";
    if (typedCh !== undefined) {
      cls = typedCh === ch ? "text-emerald-400" : "text-rose-400 underline";
    }

    // fixed 1ch box to avoid trailing-space collapse and ensure identical wrapping
    parts.push(
      `<span class="${cls}" style="display:inline-block;width:1ch;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,'Roboto Mono','Courier New',monospace;font-size:18px;line-height:24px;white-space:pre;">${esc}</span>`
    );
  }
  return parts.join("");
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

      // autofocus textarea when match actually starts
      requestAnimationFrame(() => {
        if (textAreaRef.current) {
          try {
            textAreaRef.current.focus();
            // place caret at end
            const len = textAreaRef.current.value.length;
            textAreaRef.current.setSelectionRange(len, len);
          } catch (err) {
            /* ignore focus errors */
          }
        }
      });
    });

    // clean up on page unload to avoid stale sockets
    const onBeforeUnload = () => {
      try {
        s.emit("match:unsubscribe", { code });
        s.emit("lobby:unsubscribe", { code });
      } catch (_) {}
      try { s.disconnect(); } catch (_) {}
    };
    window.addEventListener("beforeunload", onBeforeUnload);

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
      window.removeEventListener("beforeunload", onBeforeUnload);
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

  // track first outstanding error (user cannot type past firstErrorIndex + 1)
  const firstErrorIndexRef = useRef<number | null>(null);

  // track indices that were ever typed incorrectly so accuracy counts them even after fixing
  const errorIndicesRef = useRef<Set<number>>(new Set());
  const [errorsTotal, setErrorsTotal] = useState<number>(0);
  const prevTypedRef = useRef<string>("");

  // reset error tracking when prompt/match resets
  useEffect(() => {
    errorIndicesRef.current.clear();
    setErrorsTotal(0);
    prevTypedRef.current = "";
    setTyped("");
  }, [prompt, code]);

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

      // Block typing during finished OR countdown states
      if (match?.status === "finished" || match?.status === "countdown" || countdown !== null) {
        console.log("[onType] Blocked - match finished by server");
        return;
      }

      // ensure startedAt is set BEFORE emitting so timings are accurate
      let localStartedAt = startedAt;
      if (!localStartedAt) {
        localStartedAt = new Date();
        setStartedAt(localStartedAt);
      }

      // strip newlines (prevent multi-line mismatches)
      let raw = e.target.value.replace(/\r?\n/g, "");
      let value = raw.slice(0, maxLen);

      // --- NEW: detect first mismatch & clamp to allowed length ---
      const errorsSet = errorIndicesRef.current;
      let firstMismatch: number | null = null;
      for (let i = 0; i < value.length; i++) {
        const typedCh = value[i];
        const expected = prompt[i] ?? "";
        if (typedCh !== expected) {
          // record cumulative error
          if (!errorsSet.has(i)) errorsSet.add(i);
          // first mismatch if not set
          if (firstMismatch === null) firstMismatch = i;
        }
      }
      // persist cumulative errors count
      const errorsTotalNow = errorsSet.size;
      setErrorsTotal(errorsTotalNow);

      // If there is a first outstanding mismatch, clamp the typed value so the user
      // can type that incorrect char but not advance beyond it (i.e., allow length <= i+1).
      if (firstMismatch !== null) {
        firstErrorIndexRef.current = firstMismatch;
        const allowedLen = firstMismatch + 1;
        if (value.length > allowedLen) {
          value = value.slice(0, allowedLen);
        }
      } else {
        // no outstanding mismatch
        firstErrorIndexRef.current = null;
      }
      // --- END NEW ---

      // store prev typed for next diff
      prevTypedRef.current = value;

      setTyped(value);

      const errorsNow = countErrors(prompt.slice(0, value.length), value);
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
            errors: errorsTotalNow,
            finished: true,
          }, 1000);
          console.log("[onType] final progress:update ack received");
        } catch (err) {
          console.warn("[onType] final progress:update ack failed/timed out, emitting without ack", err);
          // fire-and-forget
          s.emit("progress:update", {
            code,
            charsTyped: value.length,
            errors: errorsTotalNow,
            finished: true,
          });
        }

        // Prepare finish payload WITHOUT client userId (server attaches socket user)
        const finishedAt = new Date();
        const wpm = calculateWpm(value, localStartedAt);
        // use cumulative errorsTotal for client-side accuracy (server computes authoritative one)
        const clientAcc = value.length > 0 ? Math.round(Math.max(0, 100 * (1 - errorsTotalNow / maxLen))) : 100;
        const acc = calculateAccuracy(value, prompt);
        const finishPayload = {
          code,
          charsTyped: value.length,
          errors: errorsTotalNow,
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
          errors: errorsTotalNow,
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
    // update deps: include prompt in deps and errorsTotal (for clientAcc usage)
    [prompt, finished, code, maxLen, startedAt, match, myUserId, sendFinishWithRetry, emitWithAck, countdown]
  );

  // Handle keydown for special keys
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Prevent Enter entirely
      if (e.key === "Enter") {
        e.preventDefault();
        return;
      }

      // Block navigation/edits while countdown/finished
      if (match?.status === "finished" || match?.status === "countdown" || countdown !== null) {
        e.preventDefault();
        return;
      }

      const ta = textAreaRef.current;
      if (!ta) return;

      const s = socketRef.current;

      // Helper to emit current progress
      const emitProgress = (value: string) => {
        const errorsTotalNow = errorIndicesRef.current.size;
        if (s) {
          s.emit("progress:update", {
            code,
            charsTyped: value.length,
            errors: errorsTotalNow,
            finished: value.length >= maxLen,
          });
        }
      };

      // NEW: prevent typing beyond allowed length for printable keys
      const firstErr = firstErrorIndexRef.current;
      const allowedLen = firstErr !== null ? firstErr + 1 : maxLen;
      // detect printable character (single length and not control/meta/alt)
      const isPrintable =
        e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (isPrintable) {
        const start = ta.selectionStart ?? 0;
        const end = ta.selectionEnd ?? start;
        // If selection will be replaced, compute resulting length; otherwise it's a simple insert
        const resultingLen = typed.length - (end - start) + 1;
        if (resultingLen > allowedLen) {
          // block forward typing until mistake is fixed
          e.preventDefault();
          return;
        }
      }

      // Backspace handling: remove selected range or char before caret
      if (e.key === "Backspace") {
        e.preventDefault();
        const start = ta.selectionStart ?? 0;
        const end = ta.selectionEnd ?? start;
        if (start === 0 && end === 0) return;

        const before = typed.slice(0, start);
        const after = typed.slice(end);
        // remove one char before caret if no selection
        const newValue = start === end ? before.slice(0, -1) + after : before + after;
        // update cumulative error indices: drop indices >= new length
        const errorsSet = errorIndicesRef.current;
        for (const idx of Array.from(errorsSet)) {
          if (idx >= newValue.length) errorsSet.delete(idx);
        }
        setErrorsTotal(errorsSet.size);
        prevTypedRef.current = newValue;
        setTyped(newValue);
        // place caret
        const pos = Math.max(0, start === end ? start - 1 : start);
        requestAnimationFrame(() => ta.setSelectionRange(pos, pos));
        emitProgress(newValue);
        return;
      }

      // Delete handling: remove selected range or char at caret
      if (e.key === "Delete") {
        e.preventDefault();
        const start = ta.selectionStart ?? 0;
        const end = ta.selectionEnd ?? start;
        if (start >= typed.length && start === end) return;

        const before = typed.slice(0, start);
        const after = typed.slice(end === start ? start + 1 : end);
        const newValue = before + after;
        const errorsSet = errorIndicesRef.current;
        for (const idx of Array.from(errorsSet)) {
          if (idx >= newValue.length) errorsSet.delete(idx);
        }
        setErrorsTotal(errorsSet.size);
        prevTypedRef.current = newValue;
        setTyped(newValue);
        const pos = start;
        requestAnimationFrame(() => ta.setSelectionRange(pos, pos));
        emitProgress(newValue);
        return;
      }

      // Arrow/Home/End: allow default but clamp caret if it goes past typed length
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

  // compute client-side immediate accuracy using cumulative errors
  // Use prompt length (maxLen) as denominator so correcting mistakes later
  // does not increase accuracy — errors are permanent penalties.
  const clientAccuracy = maxLen > 0 ? Math.round(Math.max(0, 100 * (1 - (errorsTotal / maxLen)))) : 100;

  const myServerWpm = me?.wpm ?? calculateWpm(typed, startedAt);
  // prefer server accuracy if available, otherwise show client cumulative accuracy
  const myServerAcc = me?.accuracy ?? clientAccuracy;

  const myProgressPct = maxLen > 0 ? Math.floor(((me?.charsTyped ?? typed.length) / maxLen) * 100) : 0;
  const oppProgressPct = maxLen > 0 ? Math.floor(((opponent?.charsTyped ?? 0) / maxLen) * 100) : 0;

  const iWon = (winnerUserId ?? match?.winnerUserId ?? null) === String(myUserId);

  const overlayHtml = useMemo(() => buildOverlayHtml(prompt, typed), [prompt, typed]);

  // replace onLeave to notify server and disconnect socket before navigating
  const onLeave = useCallback(() => {
    const s = socketRef.current;
    try {
      const up = code?.toUpperCase();
      if (s && up) {
        s.emit("match:unsubscribe", { code: up });
        s.emit("lobby:unsubscribe", { code: up });
        // give server a brief moment to process then disconnect
        setTimeout(() => {
          try { s.disconnect(); } catch (_) {}
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
            className="absolute top-0 left-0 w-full h-full pointer-events-none font-mono text-lg leading-6 whitespace-pre-wrap overflow-y-auto z-20"
            style={{
              padding: '0.75rem',
              margin: 0,
              // break per character so overlay and textarea wrap identically with 1ch boxes
              wordBreak: 'break-all',
              overflowWrap: 'anywhere',
              boxSizing: 'border-box',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace',
              fontSize: '18px',
              lineHeight: '24px',
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
              // sanitize pasted content: remove newlines, clamp to maxLen, update UI & emit progress/finish
              e.preventDefault();
              const pasted = (e.clipboardData || (window as any).clipboardData).getData("text").replace(/\r?\n/g, "");
              const base = textAreaRef.current?.value ?? "";
              let combined = (base + pasted).slice(0, maxLen);

              // update cumulative error indices for pasted content
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

              // emit final progress if finished, otherwise normal progress (send cumulative errors)
              s.emit("progress:update", {
                code,
                charsTyped: combined.length,
                errors: errorsTotalNow,
                finished: isFinished,
              });

              if (isFinished) {
                const finishedAt = new Date();
                const wpm = calculateWpm(combined, startedAt ?? new Date());
                const acc = calculateAccuracy(combined, prompt);
                const finishPayload = {
                  code,
                  charsTyped: combined.length,
                  errors: errorsTotalNow,
                  finished: true,
                  startedAt: (startedAt ?? new Date()).toISOString(),
                  finishedAt: finishedAt.toISOString(),
                  wpm,
                  accuracy: acc,
                };
                // try ack first, fallback to retry
                emitWithAck("match:finish", finishPayload, 1500).catch(() => sendFinishWithRetry(finishPayload, 3));
                setFinished(true);
              }
            }}
            onScroll={(e) => {
              if (promptScrollRef.current) {
                promptScrollRef.current.scrollTop = e.currentTarget.scrollTop;
              }
            }}
            disabled={finished || match?.status === "countdown" || countdown !== null}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            wrap="soft"
            className="absolute top-0 left-0 w-full h-full font-mono text-lg leading-6 bg-transparent border-none focus:outline-none resize-none z-10 caret-white text-transparent overflow-y-auto whitespace-pre-wrap box-border"
            style={{
              padding: '0.75rem',
              margin: 0,
              caretColor: 'white',
              // match overlay: break per character
              wordBreak: 'break-all',
              overflowWrap: 'anywhere',
              whiteSpace: 'pre-wrap',
              boxSizing: 'border-box',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace',
              fontSize: '18px',
              lineHeight: '24px',
              letterSpacing: 'normal',
              fontVariantLigatures: 'none'
            }}
          />
        </div>

        <div className="text-xs opacity-70 mt-1">
          {/* Show cumulative errors made so far (even if fixed) */}
          {me?.errors ?? errorsTotal ?? countErrors(prompt.slice(0, typed.length), typed)} errors
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
          {/* center header content so the title sits perfectly centered */}
          <ModalHeader className="flex justify-center">
            <h2 className={`text-3xl text-center font-bold ${iWon ? 'text-emerald-400' : 'text-rose-400'}`}>
              {iWon ? "You Win!" : "You Lose!"}
            </h2>
          </ModalHeader>
          <ModalBody>
            <div className="space-y-6 py-4">


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