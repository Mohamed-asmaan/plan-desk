/* Personal study tracker. Plan text lives in plan.js and is read-only. */
(function () {
  if (!window.PLAN || !Array.isArray(PLAN.days) || PLAN.days.length !== 61) {
    document.body.textContent = "The plan didn't load. Refresh the page.";
    return;
  }

  const KEY = "gsoc-study-desk-v1";
  const OLD_KEY = "gsoc-plan-v2";
  const CAP = 12 * 60 * 60 * 1000;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const NOTE_COLORS = ["cream", "blush", "sage", "sky", "sand"];
  const COLOR_LABEL = { cream: "Cream", blush: "Blush", sage: "Sage", sky: "Sky", sand: "Sand" };
  const SUBTITLE = "October 26 to December 25. Five focused hours a day around your 10–5 job, with Python orgs as your GSoC target.";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const dayByKey = new Map(PLAN.days.map((day, index) => [day.key, day]));
  const dayIndex = new Map(PLAN.days.map((day, index) => [day.key, index]));
  const taskInfo = new Map();
  PLAN.days.forEach((day) => {
    day.blocks.forEach((block) => {
      block.tasks.forEach((task) => taskInfo.set(task.id, { day, block, task }));
    });
  });

  const openCatch = new Set();
  let state = emptyState();
  let activeDayKey = null;
  let statusText = "Saved on this device";
  let saveError = false;
  let audioCtx = null;
  let endTimer = 0;
  let timerGen = 0;
  let shownStage = -1;
  let toastTimer = 0;
  let lastMinute = -1;
  let lastClock = "";

  function emptyTimer() {
    return {
      mode: "pomodoro",
      phase: "focus",
      running: false,
      startedAt: null,
      elapsedMs: 0,
      durationMs: null,
      taskId: null,
      dayKey: null,
      sessionId: null
    };
  }

  function emptyState() {
    return {
      version: 1,
      done: {},
      doneAt: {},
      dayNotes: {},
      dayNoteAt: {},
      stickies: [],
      logs: [],
      reminders: [],
      reminderFired: {},
      focusMin: 25,
      breakMin: 5,
      timer: emptyTimer()
    };
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  function keyFromParts(p) {
    return p.y + "-" + pad(p.m + 1) + "-" + pad(p.d);
  }

  function todayKey() {
    const n = new Date();
    return keyFromParts({ y: n.getFullYear(), m: n.getMonth(), d: n.getDate() });
  }

  function diffDays(a, b) {
    const ua = Date.UTC(a.y, a.m, a.d);
    const ub = Date.UTC(b.y, b.m, b.d);
    return Math.round((ua - ub) / 86400000);
  }

  function clampedDay() {
    const today = todayKey();
    const first = PLAN.days[0];
    const last = PLAN.days[PLAN.days.length - 1];
    if (today <= first.key) return first;
    if (today >= last.key) return last;
    return dayByKey.get(today) || first;
  }

  function uid() {
    return Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
  }

  function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isInteger(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normalizeTimer(raw) {
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
    if (!timer.sessionId) {
      timer.running = false;
      timer.elapsedMs = 0;
    }
    return timer;
  }

  function normalize(raw) {
    const base = emptyState();
    if (!raw || typeof raw !== "object") return base;
    if (raw.done && typeof raw.done === "object") {
      for (const [k, v] of Object.entries(raw.done)) {
        if (v === true && typeof k === "string") base.done[k] = true;
      }
    }
    if (raw.doneAt && typeof raw.doneAt === "object") {
      for (const [k, v] of Object.entries(raw.doneAt)) {
        if (base.done[k] && typeof v === "number" && Number.isFinite(v) && v > 0) base.doneAt[k] = v;
      }
    }
    if (raw.dayNotes && typeof raw.dayNotes === "object") {
      for (const [k, v] of Object.entries(raw.dayNotes)) {
        if (typeof k === "string" && typeof v === "string" && v.trim()) base.dayNotes[k] = v.slice(0, 4000);
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
        base.logs.push({
          id: log.id,
          taskId: typeof log.taskId === "string" ? log.taskId : null,
          dayKey: typeof log.dayKey === "string" ? log.dayKey : null,
          ms: Math.round(log.ms),
          at: log.at
        });
      }
    }
    const focus = clampInt(raw.focusMin, 5, 90, 25);
    base.focusMin = Math.round(focus / 5) * 5;
    base.breakMin = clampInt(raw.breakMin, 1, 15, 5);
    base.timer = normalizeTimer(raw.timer);
    if (Array.isArray(raw.reminders)) {
      for (const rem of raw.reminders.slice(0, 5)) {
        if (!rem || typeof rem.id !== "string") continue;
        const hour = clampInt(rem.hour, 0, 23, -1);
        const minute = clampInt(rem.minute, 0, 59, -1);
        if (hour < 0 || minute < 0) continue;
        base.reminders.push({
          id: rem.id.slice(0, 40),
          hour,
          minute,
          label: typeof rem.label === "string" && rem.label.trim() ? rem.label.trim().slice(0, 80) : "Reminder"
        });
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

  function setStatus(text) {
    statusText = text;
    const node = document.getElementById("save-status");
    if (node) node.textContent = text;
  }

  function save() {
    const json = JSON.stringify(state);
    try {
      localStorage.setItem(KEY, json);
      if (saveError) {
        saveError = false;
        setStatus("Saved on this device");
      }
    } catch (e) {
      try {
        localStorage.setItem(KEY, json);
        saveError = false;
        setStatus("Saved on this device");
      } catch (e2) {
        saveError = true;
        setStatus("Couldn't save. Free a little space, then try that again.");
      }
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return emptyState();
      return normalize(JSON.parse(raw));
    } catch (e) {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) localStorage.setItem(KEY + "-bak", raw);
      } catch (err) { /* keep going with a fresh desk */ }
      statusText = "Couldn't read saved progress. A copy was kept on this device.";
      return emptyState();
    }
  }

  function maybeMigrate() {
    if (localStorage.getItem(KEY)) return;
    try {
      const raw = localStorage.getItem(OLD_KEY);
      if (!raw) return;
      const old = JSON.parse(raw);
      if (old && old.done && typeof old.done === "object") {
        for (const [k, v] of Object.entries(old.done)) if (v === true) state.done[k] = true;
      }
      if (old && old.notes && typeof old.notes === "object") {
        for (const [k, v] of Object.entries(old.notes)) {
          if (typeof v === "string" && v.trim()) state.dayNotes[k] = v.slice(0, 4000);
        }
      }
      if (Object.keys(state.done).length || Object.keys(state.dayNotes).length) save();
    } catch (e) { /* old file stays untouched */ }
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue;
        if (key === "class") node.className = value;
        else if (key === "dataset") {
          for (const [dk, dv] of Object.entries(value)) node.dataset[dk] = dv;
        } else if (key.startsWith("on") && typeof value === "function") {
          node.addEventListener(key.slice(2), value);
        } else if (key === "checked" || key === "value" || key === "disabled" || key === "hidden") {
          node[key] = value;
        } else node.setAttribute(key, value === true ? "" : String(value));
      }
    }
    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children == null || children === false) return;
    const list = Array.isArray(children) ? children : [children];
    for (const kid of list) {
      if (kid == null || kid === false) continue;
      if (Array.isArray(kid)) append(node, kid);
      else node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
  }

  function fmtMin(m) {
    if (!m) return "";
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (h && r) return h + " h " + r + " min";
    if (h) return h + " h";
    return r + " min";
  }

  function fmtDur(ms) {
    const totalMin = Math.floor(ms / 60000);
    if (totalMin < 1) return "under a minute";
    const h = Math.floor(totalMin / 60);
    const r = totalMin % 60;
    if (h && r) return h + " h " + r + " min";
    if (h) return h + " h";
    return r + " min";
  }

  function formatHours(ms) {
    if (ms < 1000) return "0 min";
    return fmtDur(ms);
  }

  function formatStamp(ms) {
    const date = new Date(ms);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function noteStamp(note) {
    const created = note.createdAt || note.updatedAt;
    if (!created) return "";
    let text = formatStamp(created);
    if (note.createdAt && note.updatedAt && note.updatedAt - note.createdAt > 60000) {
      text += " · Edited " + formatStamp(note.updatedAt);
    }
    return text;
  }

  function formatMs(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (hh > 0) return hh + ":" + pad(mm) + ":" + pad(ss);
    return mm + ":" + pad(ss);
  }

  function longDate(day) {
    return WEEKDAYS[day.weekday] + ", " + MONTHS[day.m] + " " + day.d;
  }

  function shortWhen(day) {
    return WEEKDAYS[day.weekday].slice(0, 3) + ", " + MONTHS_SHORT[day.m] + " " + day.d;
  }

  function dayTasks(day) {
    return day.blocks.flatMap((block) => block.tasks);
  }

  function dayStats(day) {
    const tasks = dayTasks(day);
    const done = tasks.filter((task) => state.done[task.id]).length;
    return { done, total: tasks.length };
  }

  function dayMinutes(day) {
    return dayTasks(day).reduce((sum, task) => sum + (task.min || 0), 0);
  }

  function level(done, total) {
    if (!total || done <= 0) return 0;
    const p = done / total;
    if (p < 0.34) return 1;
    if (p < 0.67) return 2;
    if (p < 1) return 3;
    return 4;
  }

  function mustsDone(day) {
    const musts = dayTasks(day).filter((task) => task.must);
    return musts.length > 0 && musts.every((task) => state.done[task.id]);
  }

  function overall() {
    let done = 0;
    let total = 0;
    for (const info of taskInfo.values()) {
      total += 1;
      if (state.done[info.task.id]) done += 1;
    }
    return { done, total, ratio: total ? done / total : 0 };
  }

function plantStageNow() {
  const o = overall();
  if (!o.done) return 0;
  if (o.ratio < 0.15) return 1;
  if (o.ratio < 0.35) return 2;
  if (o.ratio < 0.6) return 3;
  if (o.ratio < 0.85) return 4;
  return 5;
}

function pctText(done, total) {
  if (!done || !total) return "0%";
  const raw = (done / total) * 100;
  if (raw < 1) return "<1%";
  return Math.round(raw) + "%";
}

  function dateKeyFromTs(ts) {
    const d = new Date(ts);
    return keyFromParts({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate() });
  }

  function rawElapsed() {
    const timer = state.timer;
    let ms = timer.elapsedMs || 0;
    if (timer.running && timer.startedAt) ms += Date.now() - timer.startedAt;
    if (!Number.isFinite(ms) || ms < 0) return 0;
    return ms;
  }

  function cappedElapsed() {
    const ms = rawElapsed();
    if (state.timer.mode === "stopwatch" || state.timer.phase === "stopwatch") return Math.min(ms, CAP);
    if (state.timer.durationMs) return Math.min(ms, state.timer.durationMs);
    return ms;
  }

  function sessionActive() {
    const timer = state.timer;
    return !!(timer.running || timer.elapsedMs > 0 || (timer.phase === "break" && timer.sessionId));
  }

  function inProgressFocus() {
    const timer = state.timer;
    if (timer.phase === "break") return false;
    return timer.running || timer.elapsedMs > 0;
  }

  function currentFocusMs() {
    return inProgressFocus() ? cappedElapsed() : 0;
  }

  function weekBounds(now) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    return [start.getTime(), end.getTime()];
  }

  function focusMsBetween(start, end) {
    let ms = 0;
    for (const log of state.logs) {
      if (log.at >= start && log.at < end) ms += log.ms;
    }
    if (inProgressFocus()) {
      const now = Date.now();
      if (now >= start && now < end) ms += currentFocusMs();
    }
    return ms;
  }

  function weekFocusMs() {
    const [start, end] = weekBounds(new Date());
    return focusMsBetween(start, end);
  }

  function todayFocusMs() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime();
    return focusMsBetween(start.getTime(), end);
  }

  function taskLoggedMs(id) {
    let ms = 0;
    for (const log of state.logs) if (log.taskId === id) ms += log.ms;
    if (state.timer.taskId === id && state.timer.phase !== "break") ms += cappedElapsed();
    return ms;
  }

  function activeDays() {
    const set = new Set();
    for (const [id, on] of Object.entries(state.done)) {
      if (!on) continue;
      const ts = state.doneAt[id];
      if (typeof ts === "number") set.add(dateKeyFromTs(ts));
    }
    for (const log of state.logs) set.add(dateKeyFromTs(log.at));
    if (currentFocusMs() >= 1000) set.add(todayKey());
    return set;
  }

  function streakCount() {
    const active = activeDays();
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

  function catchUpDays() {
    const today = todayKey();
    const rows = [];
    for (const day of PLAN.days) {
      if (day.key >= today) continue;
      const left = dayTasks(day).filter((task) => !state.done[task.id]);
      if (left.length) rows.push({ day, left });
    }
    rows.reverse();
    return rows;
  }

  function hackGroups() {
    const groups = [];
    for (const day of PLAN.days) {
      if (day.type !== "hack") continue;
      const label = String(day.name || "Hackathon").replace(/, day \d+$/, "");
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.days.push(day);
      else groups.push({ label, days: [day] });
    }
    return groups;
  }

  function rangeLabel(days) {
    const a = days[0];
    const b = days[days.length - 1];
    if (a.m === b.m) return MONTHS_SHORT[a.m] + " " + a.d + "–" + b.d;
    return shortWhen(a) + " – " + shortWhen(b);
  }

  function countdown(days) {
    const n = new Date();
    const today = { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() };
    const start = diffDays(days[0], today);
    const end = diffDays(days[days.length - 1], today);
    if (end < 0) return "done";
    if (start <= 0) return "now";
    return start === 1 ? "tomorrow" : "in " + start + " days";
  }

  function clearEnd() {
    clearTimeout(endTimer);
    timerGen += 1;
  }

  function scheduleEnd() {
    clearTimeout(endTimer);
    const timer = state.timer;
    if (!timer.running) return;
    let remain = null;
    if (timer.mode === "stopwatch" || timer.phase === "stopwatch") remain = CAP - rawElapsed();
    else if (timer.durationMs) remain = timer.durationMs - rawElapsed();
    if (remain == null) return;
    const gen = ++timerGen;
    endTimer = setTimeout(() => {
      if (gen !== timerGen) return;
      onTimerEnd();
    }, Math.max(0, remain));
  }

  function commitFocus(ms) {
    const timer = state.timer;
    if (timer.phase === "break") return;
    if (!timer.sessionId || !Number.isFinite(ms) || ms < 1000) return;
    if (state.logs.some((log) => log.id === timer.sessionId)) return;
    state.logs.push({
      id: timer.sessionId,
      taskId: timer.taskId || null,
      dayKey: timer.dayKey || clampedDay().key,
      ms: Math.round(ms),
      at: Date.now()
    });
  }

  function finishFocus(chime) {
    const timer = state.timer;
    if (timer.phase !== "focus") return;
    const ms = timer.durationMs || cappedElapsed();
    commitFocus(ms);
    timer.phase = "break";
    timer.mode = "pomodoro";
    timer.elapsedMs = 0;
    timer.startedAt = Date.now();
    timer.running = true;
    timer.durationMs = state.breakMin * 60000;
    timer.sessionId = uid();
    save();
    scheduleEnd();
    if (chime) {
      playChime("done");
      notify("Focus session saved", fmtDur(ms) + " logged. Break started.");
      hopPlant();
    } else {
      toast("Saved " + fmtDur(ms) + ". Break is still going.");
    }
    refreshAfterTimer();
  }

  function finishBreak(chime) {
    const timer = state.timer;
    if (timer.phase !== "break") return;
    timer.running = false;
    timer.startedAt = null;
    timer.elapsedMs = 0;
    timer.phase = "focus";
    timer.durationMs = null;
    timer.sessionId = null;
    clearEnd();
    save();
    if (chime) {
      playChime("done");
      notify("Break's over", "Ready when you are.");
    } else toast("Break's over.");
    refreshAfterTimer();
  }

  function stopForCap() {
    commitFocus(CAP);
    const timer = state.timer;
    timer.running = false;
    timer.startedAt = null;
    timer.elapsedMs = 0;
    timer.sessionId = null;
    timer.phase = "stopwatch";
    timer.durationMs = null;
    clearEnd();
    save();
    toast("The stopwatch paused at 12 hours.");
    refreshAfterTimer();
  }

  function onTimerEnd() {
    const timer = state.timer;
    if (!timer.running) return;
    if (timer.mode === "stopwatch" || timer.phase === "stopwatch") {
      if (rawElapsed() + 250 < CAP) { scheduleEnd(); return; }
      stopForCap();
      return;
    }
    if (!timer.durationMs || rawElapsed() + 250 < timer.durationMs) {
      scheduleEnd();
      return;
    }
    if (timer.phase === "break") finishBreak(true);
    else finishFocus(true);
  }

  function reconcileTimer() {
    clearEnd();
    const timer = state.timer;
    if (timer.startedAt && timer.startedAt > Date.now() + 5000) {
      timer.running = false;
      timer.startedAt = null;
      save();
      return;
    }
    if (!timer.running || !timer.startedAt) return;
    const elapsed = rawElapsed();
    if (timer.mode === "stopwatch" || timer.phase === "stopwatch") {
      if (elapsed >= CAP) stopForCap();
      else scheduleEnd();
      return;
    }
    if (timer.phase === "focus" && timer.durationMs && elapsed >= timer.durationMs) {
      const overtime = elapsed - timer.durationMs;
      const ms = timer.durationMs;
      commitFocus(ms);
      const breakMs = state.breakMin * 60000;
      if (overtime >= breakMs) {
        timer.running = false;
        timer.startedAt = null;
        timer.elapsedMs = 0;
        timer.phase = "focus";
        timer.durationMs = null;
        timer.sessionId = null;
        save();
        toast("Saved " + fmtDur(ms) + ". The break finished while you were away.");
      } else {
        timer.phase = "break";
        timer.mode = "pomodoro";
        timer.elapsedMs = overtime;
        timer.startedAt = Date.now();
        timer.running = true;
        timer.durationMs = breakMs;
        timer.sessionId = uid();
        save();
        scheduleEnd();
        toast("Saved " + fmtDur(ms) + ". Break is still going.");
      }
      return;
    }
    if (timer.phase === "break" && timer.durationMs && elapsed >= timer.durationMs) {
      timer.running = false;
      timer.startedAt = null;
      timer.elapsedMs = 0;
      timer.phase = "focus";
      timer.durationMs = null;
      timer.sessionId = null;
      save();
      toast("Break's over.");
      return;
    }
    scheduleEnd();
  }

  function startTimer() {
    const timer = state.timer;
    if (timer.running) return;
    if (timer.sessionId && (timer.elapsedMs > 0 || timer.phase === "break")) {
      resumeTimer();
      return;
    }
    timer.phase = timer.mode === "stopwatch" ? "stopwatch" : "focus";
    timer.elapsedMs = 0;
    timer.startedAt = Date.now();
    timer.running = true;
    timer.durationMs = timer.mode === "stopwatch" ? null : state.focusMin * 60000;
    timer.sessionId = uid();
    if (!timer.dayKey) timer.dayKey = clampedDay().key;
    save();
    unlockAudio();
    scheduleEnd();
  }

  function pauseTimer() {
    const timer = state.timer;
    if (!timer.running) return;
    if ((timer.durationMs && rawElapsed() >= timer.durationMs - 40) || ((timer.mode === "stopwatch" || timer.phase === "stopwatch") && rawElapsed() >= CAP - 40)) {
      onTimerEnd();
      return;
    }
    let ms = rawElapsed();
    if (timer.durationMs) ms = Math.min(ms, timer.durationMs);
    if (timer.mode === "stopwatch" || timer.phase === "stopwatch") ms = Math.min(ms, CAP);
    timer.elapsedMs = ms;
    timer.startedAt = null;
    timer.running = false;
    clearEnd();
    save();
    refreshAfterTimer();
  }

  function resumeTimer() {
    const timer = state.timer;
    if (timer.running || !timer.sessionId) return;
    timer.startedAt = Date.now();
    timer.running = true;
    save();
    unlockAudio();
    scheduleEnd();
    refreshAfterTimer();
  }

  function stopTimer() {
    const timer = state.timer;
    const phase = timer.phase;
    const ms = cappedElapsed();
    if (phase === "focus" || phase === "stopwatch") commitFocus(ms);
    timer.running = false;
    timer.startedAt = null;
    timer.elapsedMs = 0;
    timer.phase = timer.mode === "stopwatch" ? "stopwatch" : "focus";
    timer.durationMs = null;
    timer.sessionId = null;
    clearEnd();
    save();
    if (phase === "break") toast("Break skipped.");
    else if (ms >= 1000) toast("Saved " + fmtDur(ms) + ".");
    refreshAfterTimer();
  }

  function shownMs() {
    const timer = state.timer;
    if (!sessionActive()) return timer.mode === "stopwatch" ? 0 : state.focusMin * 60000;
    if (timer.mode === "stopwatch" || timer.phase === "stopwatch") return cappedElapsed();
    return Math.max(0, (timer.durationMs || 0) - cappedElapsed());
  }

  function phaseLabel() {
    const timer = state.timer;
    if (!sessionActive()) return timer.mode === "stopwatch" ? "Stopwatch" : "Focus";
    if (timer.phase === "break") return "Break";
    if (!timer.running) return "Paused";
    return timer.phase === "stopwatch" ? "Stopwatch" : "Focus";
  }

  function refreshAfterTimer() {
    if (currentRoute().name === "focus") render({ scroll: false });
    else {
      paintLive();
      paintOverall();
      paintCalendar();
      const day = viewedDay();
      if (day) paintDayBar(day);
    }
  }

  function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  }

  function playChime(kind) {
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") {
      audioCtx.resume().then(() => playChimeNow(kind)).catch(() => {});
      return;
    }
    playChimeNow(kind);
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

  function toast(message) {
    const node = document.getElementById("toast");
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    const hide = () => { toastTimer = setTimeout(() => { node.hidden = true; }, 4200); };
    if (document.hidden) {
      document.addEventListener("visibilitychange", function onVis() {
        if (!document.hidden) {
          document.removeEventListener("visibilitychange", onVis);
          hide();
        }
      });
    } else hide();
  }

  function notify(title, body) {
    toast(body ? title + " · " + body : title);
    if (!document.hidden) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try { new Notification(title, { body: body || "", silent: true }); } catch (e) { /* in-app toast remains */ }
  }

  function checkReminders() {
    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes();
    const key = todayKey();
    let changed = false;
    for (const rem of state.reminders) {
      if (rem.hour * 60 + rem.minute !== minute) continue;
      if (state.reminderFired[rem.id] === key) continue;
      state.reminderFired[rem.id] = key;
      changed = true;
      playChime("reminder");
      notify("Reminder", rem.label);
    }
    if (changed) save();
  }

  function reminderHelp() {
    const bits = ["These ring only while this page is open."];
    if (!("Notification" in window)) bits.push("This browser can't send notifications, so a reminder will show on this page instead.");
    else if (Notification.permission === "denied") bits.push("Browser notifications are blocked, so a reminder will show on this page instead.");
    return bits.join(" ");
  }

const POT = [
  [3, 13, 10, 2, "#e4c4a4"],
  [4, 12, 8, 1, "#c48962"],
  [4, 11, 8, 1, "#8d6844"]
];
const PLANT_PIXELS = [
  POT.concat([[7, 10, 2, 1, "#6d8f72"]]),
  POT.concat([[7, 7, 2, 4, "#5e8a68"], [6, 8, 1, 1, "#8fb89a"], [9, 8, 1, 1, "#7aa88a"]]),
  POT.concat([[7, 5, 2, 6, "#5e8a68"], [4, 6, 3, 2, "#8fb89a"], [9, 6, 3, 2, "#7aa88a"]]),
  POT.concat([[7, 3, 2, 8, "#5e8a68"], [3, 5, 4, 2, "#8fb89a"], [9, 5, 4, 2, "#7aa88a"], [4, 8, 3, 1, "#a3c9ae"], [9, 8, 3, 1, "#8fb89a"]]),
  POT.concat([[7, 4, 2, 7, "#5e8a68"], [3, 6, 4, 2, "#8fb89a"], [9, 6, 4, 2, "#7aa88a"], [5, 2, 2, 2, "#f0c2be"], [9, 2, 2, 2, "#e7b4b0"], [7, 3, 2, 1, "#f3dd8a"]]),
  POT.concat([[7, 5, 2, 6, "#5e8a68"], [3, 7, 4, 2, "#8fb89a"], [9, 7, 4, 2, "#7aa88a"], [4, 9, 3, 1, "#a3c9ae"], [9, 9, 3, 1, "#8fb89a"], [4, 2, 2, 2, "#f0c2be"], [6, 1, 4, 2, "#f6d0cb"], [10, 2, 2, 2, "#e7b4b0"], [7, 2, 2, 1, "#f3dd8a"]])
];

  function plantSVG(stage) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("shape-rendering", "crispEdges");
    for (const [x, y, w, h, fill] of PLANT_PIXELS[stage] || PLANT_PIXELS[0]) {
      const rect = document.createElementNS(svg.namespaceURI, "rect");
      rect.setAttribute("x", x);
      rect.setAttribute("y", y);
      rect.setAttribute("width", w);
      rect.setAttribute("height", h);
      rect.setAttribute("fill", fill);
      svg.append(rect);
    }
    return svg;
  }

  function renderPlant(animateGrow) {
    const stage = plantStageNow();
    const grew = animateGrow && shownStage >= 0 && stage > shownStage;
    if (stage === shownStage && !grew) return;
    shownStage = stage;
    const root = document.getElementById("plant");
    if (!root) return;
    root.replaceChildren(plantSVG(stage));
    if (grew && !reducedMotion.matches) {
      root.classList.remove("grew");
      void root.offsetWidth;
      root.classList.add("grew");
      sparkleAt(root);
    }
  }

  function hopPlant() {
    const root = document.getElementById("plant");
    if (!root || reducedMotion.matches) return;
    root.classList.remove("hop");
    void root.offsetWidth;
    root.classList.add("hop");
    sparkleAt(root);
  }

  function sparkleAt(node) {
    if (!node || reducedMotion.matches) return;
    const rect = node.getBoundingClientRect();
    sparkle(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function sparkle(x, y) {
    if (reducedMotion.matches) return;
    const colors = ["#6e8b78", "#e7b4b0", "#e7d7a1", "#8fb9a8", "#c4963a"];
    for (let i = 0; i < 5; i++) {
      const bit = document.createElement("i");
      bit.className = "px";
      bit.style.left = x + "px";
      bit.style.top = y + "px";
      bit.style.background = colors[i];
      const ang = -Math.PI / 2 + (i - 2) * 0.55;
      const dist = 12 + (i % 3) * 4;
      bit.style.setProperty("--dx", (Math.cos(ang) * dist) + "px");
      bit.style.setProperty("--dy", (Math.sin(ang) * dist - 4) + "px");
      document.body.append(bit);
      bit.addEventListener("animationend", () => bit.remove());
    }
  }

  function currentRoute() {
    const parts = (location.hash || "").replace(/^#/, "").split("/").filter(Boolean);
    if (parts[0] === "day" && parts[1] && dayByKey.has(parts[1])) return { name: "day", key: parts[1] };
    if (parts[0] === "plan" || parts[0] === "focus" || parts[0] === "notes") return { name: parts[0] };
    if (parts[0] === "day") return { name: "missing" };
    return { name: "today" };
  }

  function viewedDay() {
    const route = currentRoute();
    if (route.name === "today" || route.name === "plan") return clampedDay();
    if (route.name === "day") return dayByKey.get(route.key) || null;
    return null;
  }

  function hashForDay(key) {
    return key === clampedDay().key ? "#/today" : "#/day/" + key;
  }

  function revealCell(key) {
    const pane = document.querySelector(".cal-pane");
    const cell = pane && pane.querySelector('[data-day="' + key + '"]');
    if (!pane || !cell) return;
    const paneRect = pane.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const pad = 10;
    if (cellRect.top < paneRect.top + pad) pane.scrollTop -= paneRect.top + pad - cellRect.top;
    else if (cellRect.bottom > paneRect.bottom - pad) pane.scrollTop += cellRect.bottom - (paneRect.bottom - pad);
  }

  function setActiveDay(key, opts) {
    const options = opts || {};
    if (!dayByKey.has(key)) return;
    activeDayKey = key;
    document.querySelectorAll(".cell.is-selected").forEach((btn) => {
      btn.classList.remove("is-selected");
      btn.removeAttribute("aria-current");
    });
    document.querySelectorAll(".day-card.is-current").forEach((card) => card.classList.remove("is-current"));
    const cell = document.querySelector('.cal-pane [data-day="' + key + '"]');
    const card = document.getElementById("card-" + key);
    if (cell) {
      cell.classList.add("is-selected");
      cell.setAttribute("aria-current", "date");
    }
    if (card) card.classList.add("is-current");
    // Phones show only the month of the open day; mark it.
    document.querySelectorAll(".tile.cal-tile.has-active").forEach((tile) => tile.classList.remove("has-active"));
    const month = cell && cell.closest(".tile.cal-tile");
    if (month) month.classList.add("has-active");
    paintPager(key);
    if (options.scrollHash) {
      const next = hashForDay(key);
      if (location.hash !== next) history.replaceState(null, "", next);
      document.title = (key === clampedDay().key ? "Today" : "Day") + " · GSoC-ready";
    }
    if (options.revealCell) revealCell(key);
  }

  function focusDay(key, behavior) {
    const sheet = document.getElementById("stats-sheet");
    if (sheet && sheet.open) sheet.close();
    if (!dayByKey.has(key)) {
      location.hash = hashForDay(key);
      return;
    }
    const card = document.getElementById("card-" + key);
    if (!card) {
      activeDayKey = key;
      return;
    }
    setActiveDay(key, { scrollHash: true, revealCell: true });
    const smooth = behavior === "smooth" && !reducedMotion.matches;
    // Phones page one day at a time: no travel, only bring the card's top
    // back into view if the reader had scrolled past it.
    if (phone.matches) {
      if (card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: "start" });
      return;
    }
    // Hold the highlight on the chosen day while the page travels to it, so
    // rows passed on the way don't take it over.
    pendingKey = key;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pendingKey = null; }, smooth ? 1200 : 150);
    card.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  }

  // On phones the board shows one day; Previous / Today / Next page it.
  const phone = window.matchMedia("(max-width: 719px)");

  function paintPager(key) {
    const pager = document.querySelector(".day-pager");
    if (!pager) return;
    const i = dayIndex.get(key);
    pager.querySelector('[data-step="-1"]').disabled = i <= 0;
    pager.querySelector('[data-step="1"]').disabled = i >= PLAN.days.length - 1;
    pager.querySelector('[data-step="0"]').disabled = key === clampedDay().key;
  }

  function dayPager() {
    const step = (n, label, text) => el("button", {
      type: "button",
      class: "pager-btn",
      dataset: { step: String(n) },
      "aria-label": label,
      onclick: () => (n ? shiftDay(n) : focusDay(clampedDay().key, "smooth"))
    }, text);
    return el("nav", { class: "day-pager", "aria-label": "Change day" }, [
      step(-1, "Previous day", "‹ Previous"),
      step(0, "Go to today", "Today"),
      step(1, "Next day", "Next ›")
    ]);
  }

  // Scrolling the day cards moves the highlight to the row at the reading
  // line. Inside that row the open day keeps it; otherwise the first day does.
  let pendingKey = null;
  let pendingTimer = 0;
  let syncQueued = false;

  function syncFromScroll() {
    syncQueued = false;
    const cards = [...document.querySelectorAll(".day-board .day-card")];
    if (!cards.length) return;
    const line = (parseFloat(getComputedStyle(cards[0]).scrollMarginTop) || 0) + 48;
    let rowTop = -Infinity;
    const tops = cards.map((card) => card.getBoundingClientRect().top);
    for (const top of tops) if (top <= line && top > rowTop) rowTop = top;
    const row = rowTop === -Infinity
      ? cards.filter((card, i) => Math.abs(tops[i] - tops[0]) < 2)
      : cards.filter((card, i) => Math.abs(tops[i] - rowTop) < 2);
    const keys = row.map((card) => card.dataset.key);
    if (pendingKey) {
      if (keys.includes(pendingKey)) pendingKey = null;
      return;
    }
    if (keys.includes(activeDayKey)) return;
    setActiveDay(keys[0], { scrollHash: true, revealCell: true });
  }

  window.addEventListener("scroll", () => {
    if (syncQueued || phone.matches || !document.querySelector(".day-board")) return;
    syncQueued = true;
    requestAnimationFrame(syncFromScroll);
  }, { passive: true });

  function shiftDay(delta) {
    const key = activeDayKey || (viewedDay() && viewedDay().key);
    if (!key || !dayIndex.has(key)) return;
    const next = PLAN.days[dayIndex.get(key) + delta];
    if (next) focusDay(next.key, "smooth");
  }

  function onToggle(task, checked, input) {
    if (checked) {
      state.done[task.id] = true;
      state.doneAt[task.id] = Date.now();
    } else {
      delete state.done[task.id];
      delete state.doneAt[task.id];
    }
    save();
    const cardBox = document.getElementById(task.id);
    if (cardBox) {
      cardBox.checked = checked;
      const row = cardBox.closest(".task");
      if (row) row.classList.toggle("is-done", checked);
    }
    const info = taskInfo.get(task.id);
    if (info) paintDayBar(info.day);
    paintOverall();
    paintCalendar();
    const catchBox = document.getElementById("catch-up");
    if (catchBox) catchBox.replaceChildren(...catchNodes());
    renderPlant(true);
    paintLive();
    if (checked) sparkleAt(input);
  }

  function seal() {
    return el("span", { class: "seal" }, [
      el("span", { class: "seal-mark", "aria-hidden": "true" }, "★"),
      el("span", { class: "sr" }, "Important")
    ]);
  }

  function progressBar(id, done, total, label) {
    const pct = total ? Math.round(done / total * 100) : 0;
    const bar = el("div", {
      class: "bar",
      id,
      role: "progressbar",
      "aria-valuemin": "0",
      "aria-valuemax": String(total),
      "aria-valuenow": String(done),
      "aria-label": label
    }, el("div", { class: "bar-fill" }));
    bar.querySelector(".bar-fill").style.width = pct + "%";
    return bar;
  }

  function paintDayBar(day) {
    const card = document.getElementById("card-" + day.key);
    if (!card) return;
    const stats = dayStats(day);
    const pct = stats.total ? (stats.done / stats.total) * 100 : 0;
    const bar = card.querySelector(".bar");
    if (bar) {
      const fill = bar.querySelector(".bar-fill");
      if (fill) fill.style.width = pct + "%";
      bar.setAttribute("aria-valuenow", String(stats.done));
      bar.setAttribute("aria-valuemax", String(stats.total));
      bar.setAttribute("aria-label", stats.done + " of " + stats.total + " tasks done");
    }
    const count = card.querySelector(".bar-label");
    if (count) count.textContent = stats.done + " of " + stats.total + " tasks";
  }

  function paintOverall() {
    const o = overall();
    const pct = o.total ? (o.done / o.total) * 100 : 0;
    const chip = document.getElementById("stats-open-pct");
    if (chip) chip.textContent = pctText(o.done, o.total);
    const pctNode = document.getElementById("overall-pct");
    if (pctNode) pctNode.textContent = pctText(o.done, o.total);
    const count = document.getElementById("overall-count");
    if (count) count.textContent = o.done + " of " + o.total + " tasks";
    const bar = document.getElementById("overall-bar");
    if (bar) {
      const fill = bar.querySelector(".bar-fill");
      if (fill) fill.style.width = pct + "%";
      bar.setAttribute("aria-valuenow", String(o.done));
      bar.setAttribute("aria-valuemax", String(o.total));
      bar.setAttribute("aria-label", o.done + " of " + o.total + " tasks done");
    }
  }

  function dayAria(day, stats) {
    const bits = [longDate(day), stats.done + " of " + stats.total + " tasks done"];
    if (day.key === todayKey()) bits.push("today");
    if (day.type === "hack" && day.name) bits.push(day.name);
    if (mustsDone(day)) bits.push("important tasks done");
    return bits.join(", ");
  }

  function paintCalendar() {
    document.querySelectorAll("[data-day]").forEach((btn) => {
      const day = dayByKey.get(btn.dataset.day);
      if (!day) return;
      const stats = dayStats(day);
      btn.dataset.level = String(level(stats.done, stats.total));
      btn.classList.toggle("musts", mustsDone(day));
      btn.setAttribute("aria-label", dayAria(day, stats));
      const star = btn.querySelector(".star");
      if (mustsDone(day)) {
        if (!star) btn.append(el("span", { class: "star", "aria-hidden": "true" }, "★"));
      } else if (star) star.remove();
    });
  }

  function paintChip() {
    const chip = document.getElementById("timer-chip");
    if (!chip) return;
    const timer = state.timer;
    const visible = timer.running || timer.elapsedMs > 0 || (timer.phase === "break" && timer.sessionId && timer.running);
    chip.hidden = !visible;
    if (!visible) return;
    let text = formatMs(shownMs());
    if (timer.phase === "break") text += " break";
    else if (!timer.running) text += " paused";
    chip.textContent = text;
    chip.setAttribute("aria-label", "Open timer, " + text);
  }

  function paintLogged() {
    document.querySelectorAll("[data-logged-for]").forEach((node) => {
      const ms = taskLoggedMs(node.dataset.loggedFor);
      if (ms >= 1000) {
        node.hidden = false;
        node.textContent = fmtDur(ms) + " logged";
      } else node.hidden = true;
    });
  }

  function calendarOnDay(day) {
    const events = eventsOn(day.key);
    if (!events.length) return null;
    return el("section", { class: "day-cal" }, [
      el("h3", {}, "On your calendar"),
      el("ul", {}, events.map((item) => el("li", {}, (item.time ? item.time + " · " : "") + item.title)))
    ]);
  }

  function paintLive() {
    const time = document.getElementById("time-left");
    if (time) time.textContent = formatMs(shownMs());
    const phase = document.getElementById("phase-label");
    if (phase) phase.textContent = phaseLabel();
    paintChip();
    const week = document.getElementById("week-hours");
    if (week) week.textContent = formatHours(weekFocusMs());
    const streak = document.getElementById("streak-num");
    if (streak) streak.textContent = String(streakCount());
    const today = document.getElementById("today-focus");
    if (today) {
      const ms = todayFocusMs();
      today.hidden = ms < 1000;
      if (ms >= 1000) today.textContent = formatHours(ms) + " focused today.";
    }
    paintLogged();
  }

  function homeNote(day) {
    if (day.key !== clampedDay().key) return "";
    const now = new Date();
    const today = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
    const todayK = keyFromParts(today);
    const first = PLAN.days[0];
    const last = PLAN.days[PLAN.days.length - 1];
    if (todayK < first.key) {
      if (diffDays(first, today) === 1) return "Your plan starts tomorrow.";
      return "Your plan starts on " + MONTHS[first.m] + " " + first.d + ".";
    }
    if (todayK > last.key) return "This plan ended on " + MONTHS[last.m] + " " + last.d + ".";
    return "";
  }

  function taskNode(task) {
    const box = el("input", { class: "tick", type: "checkbox", id: task.id });
    box.checked = !!state.done[task.id];
    box.addEventListener("change", () => onToggle(task, box.checked, box));
    const logged = taskLoggedMs(task.id);
    const moreId = "more-" + task.id;
    const more = el("div", { class: "task-more", id: moreId, hidden: true });
    if (task.how) more.append(el("p", {}, task.how));
    if (task.res && task.res.length) {
      more.append(el("ul", {}, task.res.map((link) => el("li", {}, el("a", {
        href: link.u,
        target: "_blank",
        rel: "noopener"
      }, link.l)))));
    }
    const busy = sessionActive();
    const mine = busy && state.timer.taskId === task.id;
    const focusLabel = mine ? "Open timer" : busy ? "Timer is running" : "Start focus";
    more.append(el("button", {
      type: "button",
      class: "btn btn-primary",
      onclick: () => startFromTask(task.id)
    }, focusLabel));
    const toggle = el("button", {
      type: "button",
      class: "btn-line",
      "aria-expanded": "false",
      "aria-controls": moreId,
      onclick: () => {
        const open = more.hidden;
        more.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        toggle.textContent = open ? "Hide" : "Details";
      }
    }, "Details");
    const row = el("article", { class: "task" + (state.done[task.id] ? " is-done" : "") }, [
      el("div", { class: "task-top" }, [
        box,
        el("div", {}, [
          el("label", { class: "task-label", for: task.id }, [
            el("span", { class: "task-text" }, task.text),
            task.must ? seal() : null
          ]),
          el("div", { class: "subline" }, [
            task.min ? el("span", { class: "mins" }, fmtMin(task.min)) : null,
            el("span", {
              class: "logged",
              dataset: { loggedFor: task.id },
              hidden: logged < 1000
            }, logged >= 1000 ? fmtDur(logged) + " logged" : ""),
            toggle
          ])
        ])
      ]),
      more
    ]);
    return row;
  }

  function dayCard(day) {
    const index = dayIndex.get(day.key);
    const stats = dayStats(day);
    const note = homeNote(day);
    const planned = day.type === "hack"
      ? "DSA and GSoC are paused today."
      : fmtMin(dayMinutes(day)) + " planned.";
    const bar = progressBar("day-bar-" + day.key, stats.done, stats.total, stats.done + " of " + stats.total + " tasks done");
    const area = el("textarea", {
      id: "day-note-" + day.key,
      maxlength: "4000",
      placeholder: "What you learned, or what got stuck."
    });
    area.value = state.dayNotes[day.key] || "";
    const when = el("p", { class: "note-when" }, state.dayNoteAt[day.key] ? formatStamp(state.dayNoteAt[day.key]) : "");
    when.hidden = !state.dayNoteAt[day.key];
    area.addEventListener("input", () => {
      const value = area.value;
      if (value.trim()) {
        state.dayNotes[day.key] = value;
        state.dayNoteAt[day.key] = Date.now();
        when.hidden = false;
        when.textContent = formatStamp(state.dayNoteAt[day.key]);
      } else {
        delete state.dayNotes[day.key];
        delete state.dayNoteAt[day.key];
        when.hidden = true;
        when.textContent = "";
      }
      save();
    });
    return el("article", { class: "day-card", id: "card-" + day.key, dataset: { key: day.key } }, [
      el("header", { class: "card-head" }, [
        el("h2", {}, longDate(day)),
        el("p", { class: "meta" }, "Day " + (index + 1) + " of " + PLAN.days.length + " · Week " + (day.week + 1) + ", " + PLAN.weeks[day.week].title + " · " + planned)
      ]),
      note ? el("p", { class: "home-note" }, note) : null,
      el("div", { class: "progress-row" }, [
        bar,
        el("p", { class: "bar-label" }, stats.done + " of " + stats.total + " tasks")
      ]),
      day.key === clampedDay().key ? el("p", { class: "today-focus", id: "today-focus", hidden: true }, "") : null,
      el("div", { class: "blocks" }, day.blocks.map((block) => {
        const minutes = block.tasks.reduce((sum, task) => sum + (task.min || 0), 0);
        return el("section", { class: "block" }, [
          el("div", { class: "block-head" }, [
            el("h3", {}, [
              block.hack ? el("i", { class: "px-flag", "aria-hidden": "true" }) : null,
              block.name
            ]),
            el("span", { class: "block-time" }, minutes ? fmtMin(minutes) : "All day")
          ]),
          ...block.tasks.map(taskNode)
        ]);
      })),
      calendarOnDay(day),
      el("section", { class: "day-note" }, [
        el("label", { for: "day-note-" + day.key }, "Note for this day"),
        area,
        when
      ])
    ]);
  }

  function monthCells(days) {
    const firstCol = (days[0].weekday + 6) % 7;
    const cells = Array(firstCol).fill(null);
    cells.push(...days);
    while (cells.length % 7) cells.push(null);
    return cells;
  }

  function catchNodes() {
    const rows = catchUpDays();
    const nodes = [el("h3", {}, "Catch-up")];
    if (todayKey() < PLAN.days[0].key) {
      nodes.push(el("p", { class: "quiet" }, "The plan starts on " + MONTHS[PLAN.days[0].m] + " " + PLAN.days[0].d + ". Unfinished tasks will gather here."));
      return nodes;
    }
    if (!rows.length) {
      nodes.push(el("p", { class: "quiet" }, "Nothing left over. You're up to date."));
      return nodes;
    }
    const total = rows.reduce((sum, row) => sum + row.left.length, 0);
    nodes.push(el("p", { class: "quiet" }, total === 1 ? "1 task left on a past day." : total + " tasks left on past days."));
    nodes.push(el("div", {}, rows.map((row) => {
      const open = openCatch.has(row.day.key);
      const panel = el("div", { hidden: !open }, [
        ...row.left.map((task) => {
          const box = el("input", { class: "tick", type: "checkbox", id: "catch-" + task.id });
          box.checked = false;
          box.addEventListener("change", () => onToggle(task, box.checked, box));
          return el("div", { class: "catch-task" }, [
            box,
            el("label", { for: "catch-" + task.id }, [
              el("span", {}, task.text),
              task.must ? seal() : null
            ])
          ]);
        }),
        el("button", { type: "button", class: "btn-line open-day", onclick: () => focusDay(row.day.key, "smooth") }, "Open day")
      ]);
      const toggle = el("button", {
        type: "button",
        class: "catch-toggle",
        "aria-expanded": String(open),
        onclick: () => {
          if (openCatch.has(row.day.key)) openCatch.delete(row.day.key);
          else openCatch.add(row.day.key);
          const box = document.getElementById("catch-up");
          if (box) box.replaceChildren(...catchNodes());
        }
      }, shortWhen(row.day) + " · " + row.left.length + " left");
      return el("div", { class: "catch-day" }, [toggle, panel]);
    })));
    return nodes;
  }

  // Full months, from the real calendar: every date of each month the plan
  // touches, plus the month you are actually in. Days outside the plan stay
  // visible and are not study days.
  function monthsCovered() {
    const first = PLAN.days[0];
    const last = PLAN.days[PLAN.days.length - 1];
    const now = new Date();
    const start = Math.min(first.y * 12 + first.m, now.getFullYear() * 12 + now.getMonth());
    const end = Math.max(last.y * 12 + last.m, now.getFullYear() * 12 + now.getMonth());
    const list = [];
    for (let i = start; i <= end; i++) list.push({ y: Math.floor(i / 12), m: i % 12 });
    return list;
  }

  function monthCells(y, m) {
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

  function monthNode(y, m) {
    const cells = monthCells(y, m);
    const today = todayKey();
    return el("section", { class: "month", "aria-label": MONTHS[m] + " " + y }, [
      el("h3", {}, MONTHS[m]),
      el("div", { class: "dows", "aria-hidden": "true" }, ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => el("span", {}, d))),
      el("div", { class: "cal" }, cells.map((day) => {
        if (!day) return el("span", { class: "cell blank", "aria-hidden": "true" });
        const events = eventsOn(day.key);
        const eventBit = events.length ? ". " + events.map((item) => (item.time ? item.time + " " : "") + item.title).join(", ") : "";
        if (day.outside) {
          const node = el("span", {
            class: "cell outside" + (day.key === today ? " is-today" : ""),
            "aria-label": MONTHS[m] + " " + day.d + ", outside the plan" + eventBit
          }, String(day.d));
          if (events.length) node.append(el("span", { class: "cal-dot", "aria-hidden": "true" }));
          return node;
        }
        const stats = dayStats(day);
        const btn = el("button", {
          type: "button",
          class: "cell" + (day.type === "hack" ? " hack" : "") + (day.key === today ? " is-today" : "") + (day.key > today ? " is-future" : ""),
          dataset: { day: day.key, level: String(level(stats.done, stats.total)) },
          "aria-label": dayAria(day, stats) + eventBit,
          onclick: () => focusDay(day.key, "smooth")
        }, String(day.d));
        if (day.type === "hack") btn.append(el("span", { class: "hackdot", "aria-hidden": "true" }));
        if (mustsDone(day)) btn.append(el("span", { class: "star", "aria-hidden": "true" }, "★"));
        if (events.length) btn.append(el("span", { class: "cal-dot", "aria-hidden": "true" }));
        return btn;
      }))
    ]);
  }

  // A calendar file exported from Google or Outlook. Live sync needs an
  // account on their servers, which this page does not have, so the file is
  // read once and kept on this device.
  const CAL_KEY = "gsoc-study-cal";

  function loadCal() {
    const empty = { name: "", events: [] };
    try {
      const raw = JSON.parse(localStorage.getItem(CAL_KEY) || "null");
      if (!raw || !Array.isArray(raw.events)) return empty;
      return {
        name: typeof raw.name === "string" ? raw.name : "",
        events: raw.events.filter((item) => item && typeof item.date === "string" && typeof item.title === "string").slice(0, 2000)
      };
    } catch (e) { return empty; }
  }

  function eventsOn(key) {
    return loadCal().events.filter((item) => item.date === key);
  }


  // Tiles on the plan pane. Order, hidden tiles and sizes are saved per device.
  const TILES_KEY = "gsoc-study-tiles";
  let tileEdit = false;

  function tileDefs() {
    const o = overall();
    const streak = streakCount();
    const week = weekFocusMs();
    const defs = [
      {
        id: "progress", name: "Progress", half: true,
        build: () => [
          el("h3", { class: "tile-label" }, "Progress"),
          el("div", { class: "stats" }, [
            el("div", {}, [el("b", { id: "overall-pct" }, pctText(o.done, o.total)), el("span", { id: "overall-count" }, o.done + " of " + o.total + " tasks")])
          ]),
          progressBar("overall-bar", o.done, o.total, o.done + " of " + o.total + " tasks done")
        ]
      },
      {
        id: "stats", name: "Streak and hours", half: true,
        build: () => [
          el("h3", { class: "tile-label" }, "Streak and focus"),
          el("div", { class: "stats" }, [
            el("div", {}, [el("b", { id: "streak-num" }, String(streak)), el("span", {}, "day streak")]),
            el("div", {}, [el("b", { id: "week-hours" }, formatHours(week)), el("span", {}, "focused this week")])
          ])
        ]
      }
    ];
    for (const group of monthsCovered()) {
      defs.push({ id: "month-" + group.y + "-" + group.m, name: MONTHS[group.m], half: false, build: () => [monthNode(group.y, group.m)] });
    }
    defs.push({
      id: "key", name: "Key dates", half: true,
      build: () => [
        el("h3", { class: "tile-label" }, "Key dates"),
        el("ul", { class: "hack-list" }, hackGroups().map((group) => el("li", {}, [
          el("i", { class: "px-flag", "aria-hidden": "true" }),
          el("span", { class: "key-name" }, group.label),
          el("span", { class: "key-when" }, rangeLabel(group.days) + " · " + countdown(group.days))
        ])))
      ]
    });
    // Catch-up only earns a tile once there is something to catch up on.
    if (catchUpDays().length) {
      defs.push({ id: "catch", name: "Catch-up", half: false, build: () => [el("section", { class: "catch", id: "catch-up" }, catchNodes())] });
    }
    return defs;
  }

  function loadTiles() {
    const config = { order: [], hidden: [], size: {} };
    try {
      const raw = JSON.parse(localStorage.getItem(TILES_KEY) || "null");
      if (raw && typeof raw === "object") {
        if (Array.isArray(raw.order)) config.order = raw.order.filter((id) => typeof id === "string");
        if (Array.isArray(raw.hidden)) config.hidden = raw.hidden.filter((id) => typeof id === "string");
        if (raw.size && typeof raw.size === "object") {
          for (const [id, size] of Object.entries(raw.size)) if (size === "half") config.size[id] = "half";
        }
      }
    } catch (e) { /* start from the default layout */ }
    return config;
  }

  function saveTiles(config) {
    try { localStorage.setItem(TILES_KEY, JSON.stringify(config)); } catch (e) { /* keep it for this visit */ }
  }

  function orderedTiles(defs, config) {
    const byId = new Map(defs.map((def) => [def.id, def]));
    const seen = new Set();
    const list = [];
    for (const id of config.order) {
      if (byId.has(id) && !seen.has(id)) { list.push(byId.get(id)); seen.add(id); }
    }
    for (const def of defs) if (!seen.has(def.id)) list.push(def);
    return list;
  }

  function refreshPane() {
    const old = document.querySelector(".cal-pane");
    if (!old) return;
    const scrollTop = old.scrollTop;
    const fresh = renderPlan();
    old.replaceWith(fresh);
    fresh.scrollTop = scrollTop;
    if (activeDayKey) setActiveDay(activeDayKey, { revealCell: false });
    paintLive();
  }

  function bindTileMove(grip, tile, grid, config) {
    const pane = () => grid.closest(".cal-pane");
    function commit() {
      const box = pane() || grid;
      config.order = [...box.querySelectorAll(".tile")].map((node) => node.dataset.tile);
      saveTiles(config);
    }
    grip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try { grip.setPointerCapture(event.pointerId); } catch (e) { /* fall back to plain pointer events */ }
      tile.classList.add("is-dragging");
      function move(e) {
        const box = pane();
        if (box) {
          const rect = box.getBoundingClientRect();
          if (e.clientY < rect.top + 40) box.scrollTop -= 10;
          else if (e.clientY > rect.bottom - 40) box.scrollTop += 10;
        }
        const over = document.elementsFromPoint(e.clientX, e.clientY).find((node) => node.classList && node.classList.contains("tile") && node !== tile && node.parentNode === grid);
        if (!over) return;
        const r = over.getBoundingClientRect();
        const mine = tile.getBoundingClientRect();
        const sameRow = Math.abs(mine.top - r.top) < 1;
        const before = sameRow ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
        grid.insertBefore(tile, before ? over : over.nextSibling);
      }
      function end() {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", end);
        grip.removeEventListener("pointercancel", end);
        tile.classList.remove("is-dragging");
        commit();
      }
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", end);
      grip.addEventListener("pointercancel", end);
    });
    grip.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      if (event.key === "ArrowUp" && tile.previousElementSibling) grid.insertBefore(tile, tile.previousElementSibling);
      if (event.key === "ArrowDown" && tile.nextElementSibling) grid.insertBefore(tile.nextElementSibling, tile);
      commit();
      grip.focus();
    });
  }

  function tileNode(def, config, grid) {
    const half = def.half && config.size[def.id] === "half";
    const tile = el("section", {
      class: "tile" + (def.id.startsWith("month-") ? " cal-tile" : "") + (half ? " half" : ""),
      dataset: { tile: def.id },
      "aria-label": def.name
    });
    if (tileEdit) {
      const grip = el("button", { type: "button", class: "grip", "aria-label": "Move " + def.name + ". Drag, or use the arrow keys." }, el("i", { "aria-hidden": "true" }));
      bindTileMove(grip, tile, grid, config);
      const bar = [grip, el("span", { class: "tile-name" }, def.name)];
      if (def.half) {
        bar.push(el("button", {
          type: "button",
          class: "btn btn-ghost mini",
          "aria-pressed": String(half),
          onclick: () => {
            if (half) delete config.size[def.id];
            else config.size[def.id] = "half";
            saveTiles(config);
            refreshPane();
          }
        }, half ? "Half" : "Full"));
      }
      bar.push(el("button", {
        type: "button",
        class: "btn btn-ghost mini",
        "aria-label": "Hide " + def.name,
        onclick: () => {
          if (!config.hidden.includes(def.id)) config.hidden.push(def.id);
          saveTiles(config);
          refreshPane();
        }
      }, "Hide"));
      tile.append(el("div", { class: "tile-bar" }, bar));
    }
    tile.append(...def.build());
    return tile;
  }

  function renderPlan() {
    const config = loadTiles();
    const defs = tileDefs();
    const list = orderedTiles(defs, config);
    // Summary tiles sit in one strip on top; month grids line up below them.
    // Each group reorders within itself.
    const editing = tileEdit ? " is-editing" : "";
    const summary = el("div", { class: "tiles tiles-summary" + editing });
    const months = el("div", { class: "tiles tiles-months" + editing });
    for (const def of list) {
      if (config.hidden.includes(def.id)) continue;
      const grid = def.id.startsWith("month-") ? months : summary;
      grid.append(tileNode(def, config, grid));
    }
    const hidden = list.filter((def) => config.hidden.includes(def.id));
    const nodes = [
      el("div", { class: "cal-head" }, [
        el("h2", { class: "pane-title" }, "Overview"),
        el("div", { class: "cal-actions" }, [
          el("button", { type: "button", class: "btn btn-ghost mini", onclick: () => focusDay(clampedDay().key, "smooth") }, "Today"),
          el("button", {
            type: "button",
            class: "btn mini " + (tileEdit ? "btn-primary" : "btn-ghost"),
            "aria-pressed": String(tileEdit),
            onclick: () => { tileEdit = !tileEdit; refreshPane(); }
          }, tileEdit ? "Done" : "Edit")
        ])
      ]),
      summary,
      months,
      // The key for the month grids sits right under them.
      el("p", { class: "legend cal-legend" }, [
        el("span", {}, [el("i", { class: "swatch", style: "background:#f3efe8" }), "Not started"]),
        el("span", {}, [el("i", { class: "swatch", style: "background:#3d6b52" }), "All done"]),
        el("span", {}, [el("i", { class: "swatch is-today" }), "Today"]),
        el("span", {}, [el("i", { class: "px-flag" }), "Hackathon"]),
        el("span", {}, "★ Key tasks done")
      ])
    ];
    if (tileEdit) {
      nodes.push(el("p", { class: "quiet tile-help" }, "Drag a tile by its handle to move it. Hidden tiles come back from here."));
      if (hidden.length) {
        nodes.push(el("div", { class: "hidden-tiles" }, [
          el("span", {}, "Hidden:"),
          ...hidden.map((def) => el("button", {
            type: "button",
            class: "text-btn",
            onclick: () => {
              config.hidden = config.hidden.filter((id) => id !== def.id);
              saveTiles(config);
              refreshPane();
            }
          }, "Show " + def.name))
        ]));
      }
      nodes.push(el("button", {
        type: "button",
        class: "text-btn",
        onclick: () => {
          try { localStorage.removeItem(TILES_KEY); } catch (e) { /* ignore */ }
          refreshPane();
        }
      }, "Reset layout"));
    }
    return el("aside", { class: "cal-pane" }, nodes);
  }

  const LAYOUT_KEY = "gsoc-study-layout";

  function savedCalWidth() {
    const n = Number(localStorage.getItem(LAYOUT_KEY));
    return Number.isFinite(n) && n >= 240 ? n : null;
  }

  // Each side keeps a floor: the calendar never drops under CAL_MIN, the
  // tickets never under TICKET_MIN. The handle moves freely in between.
  const CAL_MIN = 240;
  const TICKET_MIN = 340;
  const SPLIT_W = 48; // handle plus its gaps (--pane-gutter on each side)

  function splitLimits(desk) {
    const width = desk.getBoundingClientRect().width;
    return { min: CAL_MIN, max: Math.max(CAL_MIN, width - SPLIT_W - TICKET_MIN) };
  }

  function fitCalWidth(desk) {
    if (!desk) return;
    const saved = savedCalWidth();
    if (!saved) {
      desk.style.removeProperty("--cal");
      return;
    }
    const width = desk.getBoundingClientRect().width;
    const max = width < 100 ? saved : splitLimits(desk).max;
    desk.style.setProperty("--cal", Math.round(Math.min(saved, max)) + "px");
  }

  function bindSplit(desk, handle) {
    function limits() { return splitLimits(desk); }
    function setWidth(px) {
      const box = limits();
      const next = Math.round(Math.min(box.max, Math.max(box.min, px)));
      desk.style.setProperty("--cal", next + "px");
      handle.setAttribute("aria-valuenow", String(next));
      handle.setAttribute("aria-valuemin", String(box.min));
      handle.setAttribute("aria-valuemax", String(Math.round(box.max)));
      return next;
    }
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (window.matchMedia("(max-width: 719px)").matches) return;
      event.preventDefault();
      const startX = event.clientX;
      const startW = desk.querySelector(".cal-pane").getBoundingClientRect().width;
      try { handle.setPointerCapture(event.pointerId); } catch (e) { /* fall back to plain pointer events */ }
      document.body.classList.add("is-resizing");
      function move(e) { setWidth(startW + (e.clientX - startX)); }
      function end(e) {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        document.body.classList.remove("is-resizing");
        try { localStorage.setItem(LAYOUT_KEY, String(setWidth(startW + (e.clientX - startX)))); } catch (err) { /* this device blocked storage */ }
      }
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const current = desk.querySelector(".cal-pane").getBoundingClientRect().width;
      const next = setWidth(current + (event.key === "ArrowRight" ? 28 : -28));
      try { localStorage.setItem(LAYOUT_KEY, String(next)); } catch (err) { /* keep the width for this visit */ }
    });
    handle.addEventListener("dblclick", () => {
      desk.style.removeProperty("--cal");
      try { localStorage.removeItem(LAYOUT_KEY); } catch (err) { /* ignore */ }
      handle.removeAttribute("aria-valuenow");
    });
    const saved = savedCalWidth();
    if (saved) handle.setAttribute("aria-valuenow", String(saved));
  }

  function renderDesk() {
    const handle = el("div", {
      class: "split",
      role: "separator",
      tabindex: "0",
      "aria-orientation": "vertical",
      "aria-label": "Drag to resize the calendar. Double-click to reset.",
      "aria-valuemin": "240"
    });
    const desk = el("div", { class: "desk" }, [
      renderPlan(),
      handle,
      el("div", { class: "day-pane" }, [
        el("div", { class: "day-board" }, PLAN.days.map(dayCard)),
        dayPager()
      ])
    ]);
    fitCalWidth(desk);
    bindSplit(desk, handle);
    return [desk];
  }

  function timerActions() {
    const timer = state.timer;
    if (timer.running && timer.phase === "break") {
      return [
        el("button", { type: "button", class: "btn btn-ghost", onclick: pauseTimer }, "Pause"),
        el("button", { type: "button", class: "btn btn-ghost", onclick: stopTimer }, "Skip break")
      ];
    }
    if (!timer.running && timer.phase === "break" && timer.sessionId) {
      return [
        el("button", { type: "button", class: "btn btn-primary", onclick: resumeTimer }, "Resume"),
        el("button", { type: "button", class: "btn btn-ghost", onclick: stopTimer }, "Skip break")
      ];
    }
    if (timer.running) {
      return [
        el("button", { type: "button", class: "btn btn-ghost", onclick: pauseTimer }, "Pause"),
        el("button", { type: "button", class: "btn btn-ghost", onclick: stopTimer }, "End and save")
      ];
    }
    if (!timer.running && timer.elapsedMs > 0 && timer.sessionId) {
      return [
        el("button", { type: "button", class: "btn btn-primary", onclick: resumeTimer }, "Resume"),
        el("button", { type: "button", class: "btn btn-ghost", onclick: stopTimer }, "End and save")
      ];
    }
    return [el("button", { type: "button", class: "btn btn-primary", onclick: () => { startTimer(); refreshAfterTimer(); } }, "Start")];
  }

  function lengthControl(label, value, min, max, step, onChange) {
    return el("div", {}, [
      el("p", { class: "quiet" }, label),
      el("div", { class: "stepper" }, [
        el("button", {
          type: "button",
          "aria-label": "Shorter " + label.toLowerCase(),
          disabled: sessionActive() || value <= min,
          onclick: () => onChange(-step)
        }, "−"),
        el("b", {}, value + " min"),
        el("button", {
          type: "button",
          "aria-label": "Longer " + label.toLowerCase(),
          disabled: sessionActive() || value >= max,
          onclick: () => onChange(step)
        }, "+")
      ])
    ]);
  }

  function renderFocus() {
    const timer = state.timer;
    const active = sessionActive();
    const info = timer.taskId ? taskInfo.get(timer.taskId) : null;
    const stage = [
      el("h2", {}, "Focus"),
      el("div", { class: "modes" }, [
        el("button", {
          type: "button",
          "aria-pressed": String(timer.mode === "pomodoro"),
          disabled: active,
          onclick: () => setMode("pomodoro")
        }, "Focus"),
        el("button", {
          type: "button",
          "aria-pressed": String(timer.mode === "stopwatch"),
          disabled: active,
          onclick: () => setMode("stopwatch")
        }, "Stopwatch")
      ]),
      el("p", { class: "phase", id: "phase-label" }, phaseLabel()),
      el("p", { class: "time-left", id: "time-left" }, formatMs(shownMs()))
    ];
    if (timer.phase === "break") stage.push(el("p", { class: "quiet" }, "This break isn't added to your hours."));
    if (!active && timer.mode === "pomodoro") {
      stage.push(lengthControl("Focus length", state.focusMin, 5, 90, 5, (delta) => bumpLength("focusMin", delta, 5, 90)));
      stage.push(lengthControl("Break length", state.breakMin, 1, 15, 1, (delta) => bumpLength("breakMin", delta, 1, 15)));
    }
    stage.push(el("div", { class: "timer-actions" }, timerActions()));
    if (info) {
      stage.push(el("div", { class: "link-card" }, [
        el("p", { class: "quiet" }, shortWhen(info.day)),
        el("p", {}, info.task.text),
        active ? null : el("button", { type: "button", class: "btn-line", onclick: clearLink }, "Unlink")
      ]));
    } else {
      stage.push(el("p", { class: "quiet link-card" }, "On its own. This still counts toward your week."));
    }
    return [
      el("div", { class: "focus-stage" }, stage),
      el("section", { class: "reminders" }, renderReminders())
    ];
  }

  function renderReminders() {
    const nodes = [
      el("h3", {}, "Reminders"),
      el("p", { class: "quiet" }, reminderHelp())
    ];
    if (state.reminders.length) {
      nodes.push(el("ul", { class: "rem-list" }, state.reminders.map((rem) => {
        const time = el("input", { type: "time", "aria-label": "Reminder time", value: pad(rem.hour) + ":" + pad(rem.minute) });
        time.addEventListener("change", () => {
          const [hh, mm] = time.value.split(":").map(Number);
          if (!Number.isInteger(hh) || !Number.isInteger(mm)) return;
          rem.hour = hh;
          rem.minute = mm;
          delete state.reminderFired[rem.id];
          save();
          checkReminders();
        });
        const label = el("input", { type: "text", "aria-label": "Reminder label", maxlength: "80", value: rem.label });
        label.addEventListener("input", () => {
          rem.label = label.value.slice(0, 80) || "Reminder";
          save();
        });
        label.addEventListener("blur", () => {
          rem.label = label.value.trim() || "Reminder";
          label.value = rem.label;
          save();
        });
        return el("li", { class: "rem-row" }, [
          time,
          label,
          el("button", { type: "button", class: "btn-line", onclick: () => removeReminder(rem.id) }, "Remove")
        ]);
      })));
    } else {
      nodes.push(el("p", { class: "quiet" }, "Add a time, like when you sit down to study."));
    }
    if (state.reminders.length >= 5) {
      nodes.push(el("p", { class: "quiet" }, "Five is the limit, so they stay gentle."));
    } else {
      const form = el("form", { class: "add-rem" }, [
        el("label", { class: "field" }, [el("span", {}, "Time"), el("input", { type: "time", name: "time", value: "17:30", required: true })]),
        el("label", { class: "field" }, [el("span", {}, "Label"), el("input", { type: "text", name: "label", maxlength: "80", placeholder: "Start studying" })]),
        el("button", { type: "submit", class: "btn btn-ghost" }, "Add reminder")
      ]);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const [hh, mm] = String(data.get("time") || "").split(":").map(Number);
        if (!Number.isInteger(hh) || !Number.isInteger(mm)) return;
        addReminder(hh, mm, String(data.get("label") || ""));
      });
      nodes.push(form);
    }
    return nodes;
  }

  async function addReminder(hour, minute, label) {
    if (state.reminders.length >= 5) return;
    unlockAudio();
    if (state.reminders.length === 0 && "Notification" in window && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch (e) { /* in-app reminder still works */ }
    }
    state.reminders.push({
      id: uid(),
      hour,
      minute,
      label: label.trim() || "Start studying"
    });
    save();
    render({ scroll: false });
    checkReminders();
  }

  function removeReminder(id) {
    state.reminders = state.reminders.filter((rem) => rem.id !== id);
    delete state.reminderFired[id];
    save();
    render({ scroll: false });
  }

  function setMode(mode) {
    if (sessionActive() || state.timer.mode === mode) return;
    state.timer.mode = mode;
    state.timer.phase = mode === "stopwatch" ? "stopwatch" : "focus";
    save();
    render({ scroll: false });
  }

  function bumpLength(key, delta, min, max) {
    if (sessionActive()) return;
    const next = Math.min(max, Math.max(min, state[key] + delta));
    if (next === state[key]) return;
    state[key] = next;
    save();
    render({ scroll: false });
  }

  function clearLink() {
    if (sessionActive()) return;
    state.timer.taskId = null;
    state.timer.dayKey = null;
    save();
    render({ scroll: false });
  }

  function startFromTask(taskId) {
    const info = taskInfo.get(taskId);
    if (!info) return;
    const timer = state.timer;
    if (sessionActive()) {
      toast(timer.taskId === taskId ? "That timer is already going." : "A timer is already running.");
      if (location.hash !== "#/focus") location.hash = "#/focus";
      else render({ scroll: false });
      return;
    }
    timer.taskId = taskId;
    timer.dayKey = info.day.key;
    startTimer();
    if (location.hash === "#/focus") render({ scroll: false });
    else location.hash = "#/focus";
  }

  function renderNotes() {
    const boardKids = state.stickies.length
      ? state.stickies.map(noteCard)
      : [el("p", { class: "quiet" }, "Nothing here yet. Add a note for a thought, a blocker, or an idea.")];
    return [
      el("h2", {}, "Notes"),
      el("div", { class: "board" }, boardKids),
      el("button", { type: "button", class: "dashed", onclick: addNote }, "Add a note")
    ];
  }

  function noteCard(note) {
    const area = el("textarea", {
      id: "note-" + note.id,
      maxlength: "1000",
      "aria-label": "Note text",
      placeholder: "A thought, a blocker, an idea."
    });
    area.value = note.text;
    const when = el("p", { class: "note-when" }, noteStamp(note));
    area.addEventListener("input", () => {
      note.text = area.value;
      const now = Date.now();
      if (!note.createdAt) note.createdAt = now;
      note.updatedAt = now;
      when.textContent = noteStamp(note);
      save();
    });
    return el("article", { class: "note c-" + note.color }, [
      area,
      when,
      el("div", { class: "note-tools" }, [
        el("div", { class: "colors" }, NOTE_COLORS.map((color) => el("button", {
          type: "button",
          class: "sw-" + color,
          "aria-label": COLOR_LABEL[color],
          "aria-pressed": String(note.color === color),
          onclick: () => {
            note.color = color;
            const now = Date.now();
            if (!note.createdAt) note.createdAt = now;
            note.updatedAt = now;
            when.textContent = noteStamp(note);
            save();
            const card = area.closest(".note");
            if (card) {
              card.className = "note c-" + color;
              card.querySelectorAll(".colors button").forEach((btn) => {
                btn.setAttribute("aria-pressed", String(btn.classList.contains("sw-" + color)));
              });
            }
          }
        }))),
        el("button", { type: "button", class: "btn-line", onclick: () => deleteNote(note.id) }, "Delete")
      ])
    ]);
  }

  function addNote() {
    const now = Date.now();
    const note = { id: uid(), text: "", color: "cream", createdAt: now, updatedAt: now };
    state.stickies.unshift(note);
    save();
    render({ scroll: false });
    const area = document.getElementById("note-" + note.id);
    if (area) area.focus();
  }

  function deleteNote(id) {
    if (!confirm("Delete this note?")) return;
    state.stickies = state.stickies.filter((note) => note.id !== id);
    save();
    render({ scroll: false });
  }

  function downloadBackup() {
    const blob = new Blob([JSON.stringify(Object.assign({ exportedAt: new Date().toISOString() }, state), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gsoc-study-backup.json";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function onRestore(file) {
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) {
      toast("That file couldn't be read. Choose a backup you downloaded from this app.");
      return;
    }
    if (!data || typeof data !== "object" || data.version == null && !data.done && !data.logs && !data.stickies && !data.dayNotes && !data.reminders) {
      toast("That file isn't a study backup.");
      return;
    }
    if (!confirm("Replace all progress on this device with the backup?")) return;
    state = normalize(data);
    save();
    clearEnd();
    reconcileTimer();
    if (state.reminders.length && "Notification" in window && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch (e) { /* page reminder still works */ }
    }
    render();
    toast("Backup restored.");
  }

  function renderMissing() {
    return [
      el("h2", {}, "That day isn't in the plan"),
      el("p", { class: "quiet" }, "The plan runs from October 26 to December 25."),
      el("p", {}, el("a", { href: "#/today" }, "Back to today"))
    ];
  }

  function render(options) {
    const opts = options || {};
    const route = currentRoute();
    const main = document.getElementById("main");
    const titles = { today: "Today", plan: "Plan", focus: "Focus", notes: "Notes", day: "Day", missing: "Day" };
    document.title = titles[route.name] + " · GSoC-ready";
    let nodes = [];
    let pageClass = "";
    const desk = route.name === "today" || route.name === "day" || route.name === "plan";
    if (desk) {
      pageClass = "desk-page";
      nodes = renderDesk();
    } else if (route.name === "focus") {
      pageClass = "focus-page";
      nodes = renderFocus();
    } else if (route.name === "notes") {
      pageClass = "notes-page";
      nodes = renderNotes();
    } else nodes = renderMissing();
    main.className = pageClass;
    main.replaceChildren(...nodes.flat());
    fitCalWidth(main.querySelector(".desk"));
    paintOverall();
    const navName = route.name === "focus" ? "focus" : route.name === "notes" ? "notes" : route.name === "missing" ? "" : "plan";
    document.querySelectorAll(".tabs a").forEach((link) => {
      if (link.dataset.nav === navName) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    setStatus(statusText);
    renderPlant(false);
    paintLive();
    if (desk) {
      if (opts.keep && activeDayKey && document.getElementById("card-" + activeDayKey)) {
        setActiveDay(activeDayKey, { revealCell: false });
      } else {
        const key = route.name === "day" ? route.key : clampedDay().key;
        focusDay(key, "auto");
      }
    } else if (opts.scroll !== false) window.scrollTo(0, 0);
  }

  let seenDay = todayKey();

  function tick() {
    const now = new Date();
    if (todayKey() !== seenDay) {
      seenDay = todayKey();
      render({ scroll: false, keep: true });
    }
    const label = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (label !== lastClock) {
      lastClock = label;
      const clock = document.getElementById("clock");
      if (clock) {
        clock.textContent = label;
        clock.dateTime = todayKey() + "T" + pad(now.getHours()) + ":" + pad(now.getMinutes());
      }
      paintRail(now);
    }
    const minute = now.getHours() * 60 + now.getMinutes();
    if (minute !== lastMinute) {
      lastMinute = minute;
      checkReminders();
    }
    paintLive();
    setTimeout(tick, 1000 - (Date.now() % 1000) + 30);
  }

  // Where you are in the plan, under the title, and today's date by the clock.
  function paintRail(now) {
    const date = document.getElementById("rail-date");
    if (date) date.textContent = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const line = document.getElementById("rail-day");
    if (!line) return;
    const today = todayKey();
    const first = PLAN.days[0];
    const last = PLAN.days[PLAN.days.length - 1];
    if (today < first.key) line.textContent = "Starts " + shortWhen(first);
    else if (today > last.key) line.textContent = "Plan finished";
    else {
      const day = clampedDay();
      line.textContent = "Day " + (dayIndex.get(day.key) + 1) + " of " + PLAN.days.length + " · Week " + (day.week + 1);
    }
  }

  const RAIL_KEY = "gsoc-study-rail";
  const railToggle = document.getElementById("rail-toggle");
  function setRail(closed) {
    document.querySelector(".app").classList.toggle("is-rail-closed", closed);
    railToggle.setAttribute("aria-expanded", closed ? "false" : "true");
    railToggle.querySelector(".sr").textContent = closed ? "Open sidebar" : "Close sidebar";
  }
  try { setRail(localStorage.getItem(RAIL_KEY) === "closed"); } catch (e) { setRail(false); }
  railToggle.addEventListener("click", () => {
    const closed = railToggle.getAttribute("aria-expanded") !== "false";
    setRail(closed);
    try { localStorage.setItem(RAIL_KEY, closed ? "closed" : "open"); } catch (err) { /* keep it for this visit */ }
    fitCalWidth(document.querySelector(".desk"));
  });

  document.getElementById("timer-chip").addEventListener("click", () => {
    if (location.hash !== "#/focus") location.hash = "#/focus";
  });
  const file = el("input", { type: "file", id: "import-file", accept: "application/json,.json", hidden: true });
  file.addEventListener("change", () => {
    const chosen = file.files && file.files[0];
    file.value = "";
    if (chosen) onRestore(chosen);
  });
  document.body.append(file);
  const settings = document.getElementById("rail-settings");
  document.getElementById("backup-download").addEventListener("click", () => {
    settings.open = false;
    downloadBackup();
  });
  document.getElementById("backup-restore").addEventListener("click", () => {
    settings.open = false;
    file.click();
  });
  document.addEventListener("click", (event) => {
    if (settings.open && !settings.contains(event.target)) settings.open = false;
  });

  // Phone stats sheet. The live stat tiles move into the sheet while it is
  // open and go back to the pane when it closes, so nothing is duplicated.
  const statsSheet = document.getElementById("stats-sheet");
  let summaryHome = null;
  document.getElementById("stats-open").addEventListener("click", () => {
    const summary = document.querySelector(".cal-pane .tiles-summary");
    if (summary) {
      summaryHome = document.createComment("summary");
      summary.before(summaryHome);
      document.getElementById("stats-sheet-body").append(summary);
    }
    statsSheet.showModal();
  });
  document.getElementById("stats-close").addEventListener("click", () => statsSheet.close());
  statsSheet.addEventListener("click", (event) => {
    if (event.target === statsSheet) statsSheet.close();
  });
  statsSheet.addEventListener("close", () => {
    const summary = statsSheet.querySelector(".tiles-summary");
    if (summary && summaryHome && summaryHome.isConnected) summaryHome.replaceWith(summary);
    else if (summary) summary.remove();
    if (summaryHome && summaryHome.isConnected) summaryHome.remove();
    summaryHome = null;
  });

  document.addEventListener("pointerdown", unlockAudio, { passive: true });
  document.addEventListener("keydown", (event) => {
    unlockAudio();
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.target.closest("input, textarea, .split")) return;
    const route = currentRoute();
    if (route.name !== "today" && route.name !== "day" && route.name !== "plan") return;
    if (event.key === "ArrowLeft") { event.preventDefault(); shiftDay(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); shiftDay(1); }
  });
  window.addEventListener("resize", () => fitCalWidth(document.querySelector(".desk")));
  window.addEventListener("hashchange", () => render());
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY || !event.newValue) return;
    try { state = normalize(JSON.parse(event.newValue)); } catch (e) { return; }
    clearEnd();
    reconcileTimer();
    render({ scroll: false, keep: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    let fresh = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) fresh = normalize(JSON.parse(raw));
    } catch (e) { fresh = null; }
    const before = JSON.stringify(state);
    if (fresh) state = fresh;
    clearEnd();
    reconcileTimer();
    if (JSON.stringify(state) !== before) render({ scroll: false, keep: true });
    else paintLive();
  });

  state = load();
  maybeMigrate();
  reconcileTimer();
  renderPlant(false);
  if (!location.hash || location.hash === "#") history.replaceState(null, "", "#/today");
  render({ scroll: false });
  tick();
})();
