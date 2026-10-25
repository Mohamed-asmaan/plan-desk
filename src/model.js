import { PLAN } from "../plan.js";

/* Data model and pure helpers shared by every view. Functions that read
   progress take the state object as their first argument. */

export const KEY = "gsoc-study-desk-v1";
export const OLD_KEY = "gsoc-plan-v2";
export const BOARD_KEY = "gsoc-study-board";
export const NOTE_COLORS = ["cream", "blush", "sage", "sky", "sand"];
export const COLOR_LABEL = { cream: "Cream", blush: "Blush", sage: "Sage", sky: "Sky", sand: "Sand" };
export const CAP = 12 * 60 * 60 * 1000;

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const days = PLAN.days;
export const weeks = PLAN.weeks;
export const dayByKey = new Map(days.map((day) => [day.key, day]));
export const dayIndex = new Map(days.map((day, index) => [day.key, index]));
export const taskInfo = new Map();
days.forEach((day) => day.blocks.forEach((block) => block.tasks.forEach((task) => taskInfo.set(task.id, { day, block, task }))));

/* ---------- Dates ---------- */

export function pad(n) { return String(n).padStart(2, "0"); }

export function keyFromParts(p) {
  return p.y + "-" + pad(p.m + 1) + "-" + pad(p.d);
}

export function todayKey() {
  const n = new Date();
  return keyFromParts({ y: n.getFullYear(), m: n.getMonth(), d: n.getDate() });
}

export function dateKeyFromTs(ts) {
  const d = new Date(ts);
  return keyFromParts({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate() });
}

export function diffDays(a, b) {
  return Math.round((Date.UTC(a.y, a.m, a.d) - Date.UTC(b.y, b.m, b.d)) / 86400000);
}

export function clampedDay() {
  const today = todayKey();
  const first = days[0];
  const last = days[days.length - 1];
  if (today <= first.key) return first;
  if (today >= last.key) return last;
  return dayByKey.get(today) || first;
}

export function hashForDay(key) {
  return key === clampedDay().key ? "#/today" : "#/day/" + key;
}

export function uid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
}

/* ---------- Formatting ---------- */

export function fmtMin(m) {
  if (!m) return "";
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return h + " h " + r + " min";
  if (h) return h + " h";
  return r + " min";
}

export function fmtDur(ms) {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return "under a minute";
  const h = Math.floor(totalMin / 60);
  const r = totalMin % 60;
  if (h && r) return h + " h " + r + " min";
  if (h) return h + " h";
  return r + " min";
}

export function formatHours(ms) {
  return ms < 1000 ? "0 min" : fmtDur(ms);
}

export function formatStamp(ms) {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function noteStamp(note) {
  const created = note.createdAt || note.updatedAt;
  if (!created) return "";
  let text = formatStamp(created);
  if (note.createdAt && note.updatedAt && note.updatedAt - note.createdAt > 60000) text += " · Edited " + formatStamp(note.updatedAt);
  return text;
}

export function formatMs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return hh + ":" + pad(mm) + ":" + pad(ss);
  return mm + ":" + pad(ss);
}

export function longDate(day) {
  return WEEKDAYS[day.weekday] + ", " + MONTHS[day.m] + " " + day.d;
}

export function shortWhen(day) {
  return WEEKDAYS[day.weekday].slice(0, 3) + ", " + MONTHS_SHORT[day.m] + " " + day.d;
}

export function pctText(done, total) {
  if (!done || !total) return "0%";
  const raw = (done / total) * 100;
  return raw < 1 ? "<1%" : Math.round(raw) + "%";
}

/* ---------- Plan progress ---------- */

export function dayTasks(day) {
  return day.blocks.flatMap((block) => block.tasks);
}

export function dayMinutes(day) {
  return dayTasks(day).reduce((sum, task) => sum + (task.min || 0), 0);
}

export function dayStats(state, day) {
  const tasks = dayTasks(day);
  return { done: tasks.filter((task) => state.done[task.id]).length, total: tasks.length };
}

export function level(done, total) {
  if (!total || done <= 0) return 0;
  const p = done / total;
  if (p < 0.34) return 1;
  if (p < 0.67) return 2;
  if (p < 1) return 3;
  return 4;
}

export function mustsDone(state, day) {
  const musts = dayTasks(day).filter((task) => task.must);
  return musts.length > 0 && musts.every((task) => state.done[task.id]);
}

export function overall(state) {
  let done = 0;
  let total = 0;
  for (const info of taskInfo.values()) {
    total += 1;
    if (state.done[info.task.id]) done += 1;
  }
  return { done, total, ratio: total ? done / total : 0 };
}

export function plantStage(state) {
  const o = overall(state);
  if (!o.done) return 0;
  if (o.ratio < 0.15) return 1;
  if (o.ratio < 0.35) return 2;
  if (o.ratio < 0.6) return 3;
  if (o.ratio < 0.85) return 4;
  return 5;
}

export function catchUpDays(state) {
  const today = todayKey();
  const rows = [];
  for (const day of days) {
    if (day.key >= today) continue;
    const left = dayTasks(day).filter((task) => !state.done[task.id]);
    if (left.length) rows.push({ day, left });
  }
  return rows.reverse();
}

export function hackGroups() {
  const groups = [];
  for (const day of days) {
    if (day.type !== "hack") continue;
    const label = String(day.name || "Hackathon").replace(/, day \d+$/, "");
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.days.push(day);
    else groups.push({ label, days: [day] });
  }
  return groups;
}

export function rangeLabel(list) {
  const a = list[0];
  const b = list[list.length - 1];
  if (a.m === b.m) return MONTHS_SHORT[a.m] + " " + a.d + "–" + b.d;
  return shortWhen(a) + " – " + shortWhen(b);
}

export function countdown(list) {
  const n = new Date();
  const today = { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() };
  const start = diffDays(list[0], today);
  const end = diffDays(list[list.length - 1], today);
  if (end < 0) return "done";
  if (start <= 0) return "now";
  return start === 1 ? "tomorrow" : "in " + start + " days";
}

export function homeNote(day) {
  const today = todayKey();
  if (day.key !== clampedDay().key) return "";
  if (today < days[0].key) return "Your plan starts tomorrow.";
  if (today > days[days.length - 1].key) return "The plan is finished. Catch up on anything left.";
  return "";
}

export function monthsCovered() {
  const first = days[0];
  const last = days[days.length - 1];
  const now = new Date();
  const start = Math.min(first.y * 12 + first.m, now.getFullYear() * 12 + now.getMonth());
  const end = Math.max(last.y * 12 + last.m, now.getFullYear() * 12 + now.getMonth());
  const list = [];
  for (let i = start; i <= end; i++) list.push({ y: Math.floor(i / 12), m: i % 12 });
  return list;
}

export function monthCells(y, m) {
  const count = new Date(y, m + 1, 0).getDate();
  const firstCol = (new Date(y, m, 1).getDay() + 6) % 7;
  const cells = Array(firstCol).fill(null);
  for (let d = 1; d <= count; d++) {
    const key = keyFromParts({ y, m, d });
    cells.push(dayByKey.get(key) || { y, m, d, key, outside: true });
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

/* ---------- Timer and focus time ---------- */

export function rawElapsed(state) {
  const timer = state.timer;
  let ms = timer.elapsedMs || 0;
  if (timer.running && timer.startedAt) ms += Date.now() - timer.startedAt;
  return Number.isFinite(ms) && ms >= 0 ? ms : 0;
}

export function cappedElapsed(state) {
  const ms = rawElapsed(state);
  const timer = state.timer;
  if (timer.mode === "stopwatch" || timer.phase === "stopwatch") return Math.min(ms, CAP);
  if (timer.durationMs) return Math.min(ms, timer.durationMs);
  return ms;
}

export function shownMs(timer) {
  return cappedElapsed({ timer });
}

export function sessionActive(state) {
  const timer = state.timer;
  return !!(timer.running || timer.elapsedMs > 0 || (timer.phase === "break" && timer.sessionId));
}

export function inProgressFocus(state) {
  const timer = state.timer;
  if (timer.phase === "break") return false;
  return timer.running || timer.elapsedMs > 0;
}

export function currentFocusMs(state) {
  return inProgressFocus(state) ? cappedElapsed(state) : 0;
}

function weekBounds(now) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const wd = start.getDay();
  start.setDate(start.getDate() - (wd === 0 ? 6 : wd - 1));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return [start.getTime(), end.getTime()];
}

function focusMsBetween(state, start, end) {
  let ms = 0;
  for (const log of state.logs) if (log.at >= start && log.at < end) ms += log.ms;
  if (inProgressFocus(state)) {
    const now = Date.now();
    if (now >= start && now < end) ms += currentFocusMs(state);
  }
  return ms;
}

export function weekFocusMs(state) {
  const [start, end] = weekBounds(new Date());
  return focusMsBetween(state, start, end);
}

export function todayFocusMs(state) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime();
  return focusMsBetween(state, start.getTime(), end);
}

export function taskLoggedMs(state, id) {
  let ms = 0;
  for (const log of state.logs) if (log.taskId === id) ms += log.ms;
  if (state.timer.taskId === id && state.timer.phase !== "break") ms += cappedElapsed(state);
  return ms;
}

export function streakCount(state) {
  const active = new Set();
  for (const [id, on] of Object.entries(state.done)) {
    if (on && typeof state.doneAt[id] === "number") active.add(dateKeyFromTs(state.doneAt[id]));
  }
  for (const log of state.logs) active.add(dateKeyFromTs(log.at));
  if (currentFocusMs(state) >= 1000) active.add(todayKey());
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!active.has(todayKey())) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  for (let i = 0; i < 80; i++) {
    const key = keyFromParts({ y: cursor.getFullYear(), m: cursor.getMonth(), d: cursor.getDate() });
    if (!active.has(key)) break;
    n += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

/* ---------- State shape ---------- */

export function emptyTimer() {
  return { mode: "pomodoro", phase: "focus", running: false, startedAt: null, elapsedMs: 0, durationMs: null, taskId: null, dayKey: null, sessionId: null };
}

export function emptyState() {
  return { version: 1, done: {}, doneAt: {}, dayNotes: {}, dayNoteAt: {}, stickies: [], logs: [], reminders: [], reminderFired: {}, focusMin: 25, breakMin: 5, timer: emptyTimer() };
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeTimer(raw) {
  const timer = emptyTimer();
  if (!raw || typeof raw !== "object") return timer;
  timer.mode = raw.mode === "stopwatch" ? "stopwatch" : "pomodoro";
  if (raw.phase === "break" || raw.phase === "stopwatch" || raw.phase === "focus") timer.phase = raw.phase;
  if (timer.mode === "stopwatch" && timer.phase !== "stopwatch") timer.phase = "stopwatch";
  if (timer.mode === "pomodoro" && timer.phase === "stopwatch") timer.phase = "focus";
  timer.running = !!raw.running;
  timer.startedAt = typeof raw.startedAt === "number" && raw.startedAt > 0 ? raw.startedAt : null;
  timer.elapsedMs = typeof raw.elapsedMs === "number" && raw.elapsedMs > 0 ? Math.min(raw.elapsedMs, CAP) : 0;
  timer.durationMs = typeof raw.durationMs === "number" && raw.durationMs > 0 ? Math.min(raw.durationMs, CAP) : null;
  timer.taskId = typeof raw.taskId === "string" ? raw.taskId : null;
  timer.dayKey = typeof raw.dayKey === "string" ? raw.dayKey : null;
  timer.sessionId = typeof raw.sessionId === "string" ? raw.sessionId : null;
  if (timer.running && !timer.startedAt) timer.running = false;
  if (!timer.sessionId) { timer.running = false; timer.elapsedMs = 0; }
  return timer;
}

export function normalize(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;
  if (raw.done && typeof raw.done === "object") {
    for (const [k, v] of Object.entries(raw.done)) if (v === true) base.done[k] = true;
  }
  if (raw.doneAt && typeof raw.doneAt === "object") {
    for (const [k, v] of Object.entries(raw.doneAt)) {
      if (base.done[k] && typeof v === "number" && Number.isFinite(v) && v > 0) base.doneAt[k] = v;
    }
  }
  if (raw.dayNotes && typeof raw.dayNotes === "object") {
    for (const [k, v] of Object.entries(raw.dayNotes)) {
      if (typeof v === "string" && v.trim()) base.dayNotes[k] = v.slice(0, 4000);
    }
  }
  if (raw.dayNoteAt && typeof raw.dayNoteAt === "object") {
    for (const [k, v] of Object.entries(raw.dayNoteAt)) {
      if (base.dayNotes[k] && typeof v === "number" && Number.isFinite(v) && v > 0) base.dayNoteAt[k] = v;
    }
  }
  if (Array.isArray(raw.stickies)) {
    for (const note of raw.stickies) {
      if (!note || typeof note.id !== "string" || typeof note.text !== "string") continue;
      base.stickies.push({
        id: note.id.slice(0, 40),
        text: note.text.slice(0, 1000),
        color: NOTE_COLORS.includes(note.color) ? note.color : "cream",
        createdAt: typeof note.createdAt === "number" && note.createdAt > 0 ? note.createdAt : null,
        updatedAt: typeof note.updatedAt === "number" && note.updatedAt > 0 ? note.updatedAt : null
      });
    }
  }
  if (Array.isArray(raw.logs)) {
    const seen = new Set();
    for (const log of raw.logs) {
      if (!log || typeof log.id !== "string" || seen.has(log.id)) continue;
      if (typeof log.ms !== "number" || !Number.isFinite(log.ms) || log.ms < 1000 || log.ms > CAP + 1000) continue;
      if (typeof log.at !== "number" || !Number.isFinite(log.at)) continue;
      seen.add(log.id);
      base.logs.push({ id: log.id, taskId: typeof log.taskId === "string" ? log.taskId : null, dayKey: typeof log.dayKey === "string" ? log.dayKey : null, ms: Math.round(log.ms), at: log.at });
    }
  }
  base.focusMin = Math.round(clampInt(raw.focusMin, 5, 90, 25) / 5) * 5;
  base.breakMin = clampInt(raw.breakMin, 1, 15, 5);
  base.timer = normalizeTimer(raw.timer);
  if (Array.isArray(raw.reminders)) {
    for (const rem of raw.reminders.slice(0, 5)) {
      if (!rem || typeof rem.id !== "string") continue;
      const hour = clampInt(rem.hour, 0, 23, -1);
      const minute = clampInt(rem.minute, 0, 59, -1);
      if (hour < 0 || minute < 0) continue;
      base.reminders.push({ id: rem.id.slice(0, 40), hour, minute, label: typeof rem.label === "string" && rem.label.trim() ? rem.label.trim().slice(0, 80) : "Reminder" });
    }
  }
  if (raw.reminderFired && typeof raw.reminderFired === "object") {
    for (const rem of base.reminders) {
      const value = raw.reminderFired[rem.id];
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) base.reminderFired[rem.id] = value;
    }
  }
  return base;
}

/** Reads saved progress; on a corrupt save keeps a copy under KEY-bak. */
export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) localStorage.setItem(KEY + "-bak", raw);
    } catch (err) { /* keep going with a fresh desk */ }
    return emptyState();
  }
  return migrateOld(emptyState());
}

function migrateOld(state) {
  try {
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || "null");
    if (!old) return state;
    if (old.done && typeof old.done === "object") for (const [k, v] of Object.entries(old.done)) if (v === true) state.done[k] = true;
    if (old.notes && typeof old.notes === "object") {
      for (const [k, v] of Object.entries(old.notes)) if (typeof v === "string" && v.trim()) state.dayNotes[k] = v.slice(0, 4000);
    }
  } catch (e) { /* old save stays untouched */ }
  return state;
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}
