import { useEffect, useRef, useState } from "react";
import { CAP, cappedElapsed, clampedDay, fmtDur, rawElapsed, sessionActive, taskInfo, uid } from "./model.js";
import { toast } from "./toast.jsx";

/* Timer recipes and the engine that ends sessions on time. Recipes mutate
   and return the draft (App's update() hands them a structuredClone). They
   may run twice under StrictMode, so they only toast; chimes and
   notifications run once, from the engine. */

const isStopwatch = (timer) => timer.mode === "stopwatch" || timer.phase === "stopwatch";

/* ---------- Audio and notifications ---------- */

let audioCtx = null;

export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
}

function playChimeNow(kind) {
  if (!audioCtx || audioCtx.state !== "running") return;
  const now = audioCtx.currentTime;
  const notes = kind === "reminder" ? [523.25] : [523.25, 659.25, 783.99];
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = now + i * 0.13;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.045, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}

export function playChime(kind) {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") {
    audioCtx.resume().then(() => playChimeNow(kind)).catch(() => {});
    return;
  }
  playChimeNow(kind);
}

/** Toast always; a system notification too when the page is hidden and allowed. */
export function notify(title, body) {
  toast(body ? title + " · " + body : title);
  if (!document.hidden) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try { new Notification(title, { body: body || "", silent: true }); } catch (e) { /* in-app toast remains */ }
}

/* ---------- Read helpers ---------- */

/** What the big clock shows: time left, or elapsed for the stopwatch. */
export function displayMs(state) {
  const timer = state.timer;
  if (!sessionActive(state)) return timer.mode === "stopwatch" ? 0 : state.focusMin * 60000;
  if (isStopwatch(timer)) return cappedElapsed(state);
  return Math.max(0, (timer.durationMs || 0) - cappedElapsed(state));
}

export function phaseLabel(state) {
  const timer = state.timer;
  if (!sessionActive(state)) return timer.mode === "stopwatch" ? "Stopwatch" : "Focus";
  if (timer.phase === "break") return "Break";
  if (!timer.running) return "Paused";
  return timer.phase === "stopwatch" ? "Stopwatch" : "Focus";
}

/* ---------- Recipes ---------- */

function commitFocus(draft, ms) {
  const timer = draft.timer;
  if (timer.phase === "break") return;
  if (!timer.sessionId || !Number.isFinite(ms) || ms < 1000) return;
  if (draft.logs.some((log) => log.id === timer.sessionId)) return;
  draft.logs.push({ id: timer.sessionId, taskId: timer.taskId || null, dayKey: timer.dayKey || clampedDay().key, ms: Math.round(ms), at: Date.now() });
}

function clearSession(timer, phase) {
  timer.running = false;
  timer.startedAt = null;
  timer.elapsedMs = 0;
  timer.phase = phase;
  timer.durationMs = null;
  timer.sessionId = null;
}

function beginBreak(draft, elapsedMs) {
  const timer = draft.timer;
  timer.phase = "break";
  timer.mode = "pomodoro";
  timer.elapsedMs = elapsedMs;
  timer.startedAt = Date.now();
  timer.running = true;
  timer.durationMs = draft.breakMin * 60000;
  timer.sessionId = uid();
}

export function startFocus(draft, { taskId, dayKey } = {}) {
  const timer = draft.timer;
  if (timer.running) return draft;
  if (timer.sessionId && (timer.elapsedMs > 0 || timer.phase === "break")) return resumeTimer(draft);
  if (taskId !== undefined) {
    timer.taskId = taskId;
    timer.dayKey = dayKey || (taskId && taskInfo.get(taskId) ? taskInfo.get(taskId).day.key : null);
  }
  timer.phase = timer.mode === "stopwatch" ? "stopwatch" : "focus";
  timer.elapsedMs = 0;
  timer.startedAt = Date.now();
  timer.running = true;
  timer.durationMs = timer.mode === "stopwatch" ? null : draft.focusMin * 60000;
  timer.sessionId = uid();
  if (!timer.dayKey) timer.dayKey = clampedDay().key;
  unlockAudio();
  return draft;
}

export function pauseTimer(draft) {
  const timer = draft.timer;
  if (!timer.running) return draft;
  const raw = rawElapsed(draft);
  // At the very end, leave it running: the engine ends it with the chime.
  if ((timer.durationMs && raw >= timer.durationMs - 40) || (isStopwatch(timer) && raw >= CAP - 40)) return draft;
  let ms = raw;
  if (timer.durationMs) ms = Math.min(ms, timer.durationMs);
  if (isStopwatch(timer)) ms = Math.min(ms, CAP);
  timer.elapsedMs = ms;
  timer.startedAt = null;
  timer.running = false;
  return draft;
}

export function resumeTimer(draft) {
  const timer = draft.timer;
  if (timer.running || !timer.sessionId) return draft;
  timer.startedAt = Date.now();
  timer.running = true;
  unlockAudio();
  return draft;
}

export function stopTimer(draft) {
  const timer = draft.timer;
  const phase = timer.phase;
  const ms = cappedElapsed(draft);
  if (phase === "focus" || phase === "stopwatch") commitFocus(draft, ms);
  clearSession(timer, timer.mode === "stopwatch" ? "stopwatch" : "focus");
  if (phase === "break") toast("Break skipped.");
  else if (ms >= 1000) toast("Saved " + fmtDur(ms) + ".");
  return draft;
}

export function skipBreak(draft) {
  if (draft.timer.phase !== "break") return draft;
  return stopTimer(draft);
}

export function setMode(draft, mode) {
  if (mode !== "pomodoro" && mode !== "stopwatch") return draft;
  if (sessionActive(draft) || draft.timer.mode === mode) return draft;
  draft.timer.mode = mode;
  draft.timer.phase = mode === "stopwatch" ? "stopwatch" : "focus";
  return draft;
}

export function setFocusMin(draft, n) {
  if (sessionActive(draft) || !Number.isFinite(n)) return draft;
  draft.focusMin = Math.min(90, Math.max(5, Math.round(n / 5) * 5));
  return draft;
}

export function setBreakMin(draft, n) {
  if (sessionActive(draft) || !Number.isFinite(n)) return draft;
  draft.breakMin = Math.min(15, Math.max(1, Math.round(n)));
  return draft;
}

export function unlinkTask(draft) {
  if (sessionActive(draft)) return draft;
  draft.timer.taskId = null;
  draft.timer.dayKey = null;
  return draft;
}

/** Start focus on a plan task. The caller then navigates to #/focus. */
export function startFromTask(draft, taskId) {
  const info = taskInfo.get(taskId);
  if (!info) return draft;
  if (sessionActive(draft)) {
    toast(draft.timer.taskId === taskId ? "That timer is already going." : "A timer is already running.");
    return draft;
  }
  return startFocus(draft, { taskId, dayKey: info.day.key });
}

/* ---------- Ending and reconciling (pure; return what happened) ---------- */

/** A running session that reached its end: ends it. Returns { kind, ms }. */
function endDue(draft) {
  const timer = draft.timer;
  if (!timer.running) return null;
  const raw = rawElapsed(draft);
  if (isStopwatch(timer)) {
    if (raw + 250 < CAP) return null;
    commitFocus(draft, CAP);
    clearSession(timer, "stopwatch");
    return { kind: "cap" };
  }
  if (!timer.durationMs || raw + 250 < timer.durationMs) return null;
  if (timer.phase === "break") {
    clearSession(timer, "focus");
    return { kind: "break" };
  }
  if (timer.phase !== "focus") return null;
  const ms = timer.durationMs;
  commitFocus(draft, ms);
  beginBreak(draft, 0);
  return { kind: "focus", ms };
}

/** Port of reconcileTimer for sessions that ended while the page was away. Returns a toast message or "" (null: nothing changed). */
function reconcile(draft) {
  const timer = draft.timer;
  if (timer.startedAt && timer.startedAt > Date.now() + 5000) {
    timer.running = false;
    timer.startedAt = null;
    return "";
  }
  if (!timer.running || !timer.startedAt) return null;
  const elapsed = rawElapsed(draft);
  if (isStopwatch(timer)) {
    if (elapsed < CAP) return null;
    commitFocus(draft, CAP);
    clearSession(timer, "stopwatch");
    return "The stopwatch paused at 12 hours.";
  }
  if (timer.phase === "focus" && timer.durationMs && elapsed >= timer.durationMs) {
    const overtime = elapsed - timer.durationMs;
    const ms = timer.durationMs;
    commitFocus(draft, ms);
    if (overtime >= draft.breakMin * 60000) {
      clearSession(timer, "focus");
      return "Saved " + fmtDur(ms) + ". The break finished while you were away.";
    }
    beginBreak(draft, overtime);
    return "Saved " + fmtDur(ms) + ". Break is still going.";
  }
  if (timer.phase === "break" && timer.durationMs && elapsed >= timer.durationMs) {
    clearSession(timer, "focus");
    return "Break's over.";
  }
  return null;
}

/* ---------- Hooks ---------- */

/** Date.now(), refreshed every `ms` while mounted and `active`. */
export function useNow(ms = 1000, active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, active]);
  return now;
}

/** Mount once in App. Ends sessions on time, reconciles on load and on
   return to the tab, unlocks audio on first input, and returns Date.now()
   refreshed 4x a second while a session runs. */
export function useTimerEngine(state, update) {
  const ref = useRef(state);
  ref.current = state;
  const updateRef = useRef(update);
  updateRef.current = update;
  const timer = state.timer;
  const now = useNow(250, timer.running);

  // Unlock audio on any input (browsers need a gesture first).
  useEffect(() => {
    const onKey = () => unlockAudio();
    document.addEventListener("pointerdown", unlockAudio, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", unlockAudio);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Reconcile on load and whenever the tab comes back.
  useEffect(() => {
    const run = () => {
      const probe = structuredClone(ref.current);
      const message = reconcile(probe);
      if (message === null) return;
      updateRef.current((draft) => { reconcile(draft); return draft; });
      if (message) toast(message);
    };
    run();
    const onVis = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Schedule the end of the running phase.
  useEffect(() => {
    if (!timer.running) return undefined;
    let id = 0;
    const schedule = () => {
      const t = ref.current.timer;
      let remain = null;
      if (isStopwatch(t)) remain = CAP - rawElapsed(ref.current);
      else if (t.durationMs) remain = t.durationMs - rawElapsed(ref.current);
      if (remain == null) return;
      id = setTimeout(fire, Math.max(0, remain));
    };
    const fire = () => {
      const probe = structuredClone(ref.current);
      const result = endDue(probe);
      if (!result) { schedule(); return; }
      updateRef.current((draft) => { endDue(draft); return draft; });
      if (result.kind === "focus") {
        playChime("done");
        notify("Focus session saved", fmtDur(result.ms) + " logged. Break started.");
        window.dispatchEvent(new CustomEvent("focus-saved", { detail: { ms: result.ms } }));
      } else if (result.kind === "break") {
        playChime("done");
        notify("Break's over", "Ready when you are.");
      } else {
        toast("The stopwatch paused at 12 hours.");
      }
    };
    schedule();
    return () => clearTimeout(id);
  }, [timer.running, timer.startedAt, timer.elapsedMs, timer.durationMs, timer.phase, timer.mode, timer.sessionId]);

  return now;
}
