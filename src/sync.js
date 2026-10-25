import { useEffect, useState } from "react";
import { formatStamp, normalize } from "./model.js";

/* GitHub Gist sync. Progress is mirrored to one private Gist so a phone and
   a laptop stay in step. Each side keeps the last copy both agreed on (base)
   and merges field by field: whatever changed here since the base wins over
   the remote, everything else takes the remote. So a tick on one device and
   an untick on another both survive. The timer stays per device.

   App calls connectSync({ getState, applyState }) once. Everything else
   (status, connect, disconnect, syncNow) is read by components through
   useSyncStatus() and the exported functions. */

const SYNC_KEY = "gsoc-study-sync";
const GIST_FILE = "plan-desk.json";
const GIST_DESC = "GSoC plan desk sync";

let conf = loadConf();
let host = null;
let syncing = false;
let again = false;
let timer = 0;
let error = "";
const listeners = new Set();

function loadConf() {
  try {
    const raw = JSON.parse(localStorage.getItem(SYNC_KEY) || "null");
    if (raw && typeof raw.token === "string" && raw.token) {
      return {
        token: raw.token,
        gistId: typeof raw.gistId === "string" ? raw.gistId : "",
        base: raw.base && typeof raw.base === "object" ? raw.base : null,
        at: typeof raw.at === "number" ? raw.at : 0
      };
    }
  } catch (e) { /* not connected */ }
  return null;
}

function saveConf() {
  try {
    if (conf) localStorage.setItem(SYNC_KEY, JSON.stringify(conf));
    else localStorage.removeItem(SYNC_KEY);
  } catch (e) { /* sync settings last for this visit */ }
}

function emit() {
  for (const fn of listeners) fn();
}

function syncable(s) {
  return { done: s.done, doneAt: s.doneAt, dayNotes: s.dayNotes, dayNoteAt: s.dayNoteAt, stickies: s.stickies, logs: s.logs, reminders: s.reminders, focusMin: s.focusMin, breakMin: s.breakMin };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function mergeMap(local, remote, base) {
  const out = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const value = same(local[k], base[k]) ? remote[k] : local[k];
    if (value !== undefined) out[k] = value;
  }
  return out;
}

const byId = (list) => Object.fromEntries((list || []).map((item) => [item.id, item]));

export function mergeState(local, remote, base) {
  const b = base || {};
  const pair = (a, at) => Object.fromEntries(Object.keys(a || {}).map((k) => [k, [a[k], (at || {})[k] || null]]));
  const done = mergeMap(pair(local.done, local.doneAt), pair(remote.done, remote.doneAt), pair(b.done, b.doneAt));
  const notes = mergeMap(pair(local.dayNotes, local.dayNoteAt), pair(remote.dayNotes, remote.dayNoteAt), pair(b.dayNotes, b.dayNoteAt));
  const out = {
    done: {}, doneAt: {}, dayNotes: {}, dayNoteAt: {},
    stickies: Object.values(mergeMap(byId(local.stickies), byId(remote.stickies), byId(b.stickies))).sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0)),
    logs: Object.values(mergeMap(byId(local.logs), byId(remote.logs), byId(b.logs))).sort((x, y) => x.at - y.at),
    reminders: Object.values(mergeMap(byId(local.reminders), byId(remote.reminders), byId(b.reminders))).slice(0, 5),
    focusMin: same(local.focusMin, b.focusMin) ? remote.focusMin : local.focusMin,
    breakMin: same(local.breakMin, b.breakMin) ? remote.breakMin : local.breakMin
  };
  for (const [k, [v, at]] of Object.entries(done)) { out.done[k] = v; if (at) out.doneAt[k] = at; }
  for (const [k, [v, at]] of Object.entries(notes)) { out.dayNotes[k] = v; if (at) out.dayNoteAt[k] = at; }
  return out;
}

async function gh(path, opts) {
  const res = await fetch("https://api.github.com" + path, Object.assign({}, opts, {
    headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + conf.token, "Content-Type": "application/json" }
  }));
  if (res.status === 401) throw new Error("token");
  if (!res.ok) throw new Error("http " + res.status);
  return res.json();
}

async function findOrMakeGist() {
  const list = await gh("/gists?per_page=100");
  const found = list.find((g) => g.description === GIST_DESC && g.files && g.files[GIST_FILE]);
  if (found) return found.id;
  const made = await gh("/gists", {
    method: "POST",
    body: JSON.stringify({ description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: JSON.stringify(syncable(host.getState())) } } })
  });
  return made.id;
}

export async function syncNow() {
  if (!conf || !host) return;
  if (syncing) { again = true; return; }
  if (!navigator.onLine) { error = "Offline. Will sync when you're back online."; emit(); return; }
  syncing = true;
  error = "";
  emit();
  try {
    if (!conf.gistId) { conf.gistId = await findOrMakeGist(); saveConf(); }
    const gist = await gh("/gists/" + conf.gistId);
    const file = gist.files && gist.files[GIST_FILE];
    const current = host.getState();
    const remote = file && file.content ? syncable(normalize(JSON.parse(file.content))) : syncable(current);
    const local = syncable(current);
    const merged = syncable(normalize(mergeState(local, remote, conf.base)));
    if (!same(merged, local)) host.applyState(merged);
    if (!same(merged, remote)) {
      await gh("/gists/" + conf.gistId, { method: "PATCH", body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(merged) } } }) });
    }
    conf.base = merged;
    conf.at = Date.now();
    saveConf();
  } catch (e) {
    if (e.message === "token") error = "GitHub didn't accept the token. Connect again with a token that has the gist scope.";
    else if (e.message === "http 404") { conf.gistId = ""; saveConf(); error = "The sync Gist was missing. It will be recreated on the next sync."; }
    else error = "Couldn't reach GitHub. Will try again.";
  } finally {
    syncing = false;
    emit();
    if (again) { again = false; scheduleSync(0); }
  }
}

/** Debounced sync; called after each local save and on wake-up events. */
export function scheduleSync(delay) {
  if (!conf) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay == null ? 2500 : delay);
}

export async function connectSync(token) {
  conf = { token, gistId: "", base: null, at: 0 };
  saveConf();
  await syncNow();
  if (/token/.test(error)) {
    conf = null;
    saveConf();
    emit();
    return false;
  }
  return true;
}

export function disconnectSync() {
  conf = null;
  error = "";
  saveConf();
  emit();
}

/** Wires the controller to App's state. Returns a cleanup. */
export function attachSync({ getState, applyState }) {
  host = { getState, applyState };
  const online = () => scheduleSync(0);
  const visible = () => { if (document.visibilityState === "visible") scheduleSync(0); };
  window.addEventListener("online", online);
  document.addEventListener("visibilitychange", visible);
  const every = setInterval(visible, 120000);
  scheduleSync(0);
  return () => {
    host = null;
    window.removeEventListener("online", online);
    document.removeEventListener("visibilitychange", visible);
    clearInterval(every);
    clearTimeout(timer);
  };
}

function statusText() {
  if (!conf) return "";
  if (syncing) return "Syncing…";
  if (error) return error;
  if (!conf.at) return "Not synced yet";
  const min = Math.round((Date.now() - conf.at) / 60000);
  return min < 1 ? "Synced just now" : min < 60 ? "Synced " + min + " min ago" : "Synced at " + formatStamp(conf.at);
}

export function useSyncStatus() {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return { connected: !!conf, syncing, error, text: statusText() };
}
