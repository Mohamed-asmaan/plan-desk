import { useEffect, useState } from "react";
import { emptyState, formatStamp, normalize } from "./model.js";
import { mergeBoardDocs, normalizeBoardDoc, readBoardDoc, writeBoardDoc } from "./board/doc.js";

/* GitHub Gist sync. Progress and whiteboards are mirrored to one private
   Gist so a phone and a laptop stay in step. Each side keeps the last copy both agreed on (base)
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

/* The Gist holds { ...study, board }. Older devices wrote study only. The
   base we keep is { study, board }; a base saved before boards synced is
   the study object itself. */
function baseStudy(base) {
  if (!base || typeof base !== "object") return {};
  if (base.study && typeof base.study === "object") return base.study;
  if (base.done || base.dayNotes || base.stickies || base.logs) return base;
  return {};
}

function parsePayload(text) {
  const data = JSON.parse(text);
  return { study: syncable(normalize(data)), board: data && data.board ? normalizeBoardDoc(data.board) : null };
}

async function gistText(gist) {
  const file = gist.files && gist.files[GIST_FILE];
  if (!file) return "";
  if (typeof file.content === "string" && !file.truncated) return file.content;
  if (!file.raw_url) return typeof file.content === "string" ? file.content : "";
  const res = await fetch(file.raw_url, { headers: { Authorization: "Bearer " + conf.token, Accept: "application/vnd.github.raw" } });
  if (!res.ok) throw new Error("http " + res.status);
  return res.text();
}

async function readGist(id) {
  const gist = await gh("/gists/" + id);
  const text = await gistText(gist);
  return { id, updated: gist.updated_at || "", payload: text ? parsePayload(text) : { study: syncable(emptyState()), board: null } };
}

// Every sync Gist on the account: a second one made by another device is
// folded in rather than ignored.
async function listSyncGists() {
  const found = [];
  for (let page = 1; page <= 10; page++) {
    const list = await gh("/gists?per_page=100&page=" + page);
    if (!Array.isArray(list) || !list.length) break;
    for (const gist of list) if (gist && gist.id && gist.description === GIST_DESC) found.push(gist);
    if (list.length < 100) break;
  }
  return found;
}

function writeGist(id, packed) {
  const body = JSON.stringify({ description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: JSON.stringify(packed) } } });
  return id ? gh("/gists/" + id, { method: "PATCH", body }) : gh("/gists", { method: "POST", body });
}

export async function syncNow() {
  if (!conf || !host) return;
  if (syncing) { again = true; return; }
  if (!navigator.onLine) { error = "Offline. Will sync when you're back online."; emit(); return; }
  syncing = true;
  error = "";
  emit();
  try {
    const ids = new Set(conf.gistId ? [conf.gistId] : []);
    for (const gist of await listSyncGists()) ids.add(gist.id);
    const copies = [];
    for (const id of ids) {
      try { copies.push(await readGist(id)); }
      catch (e) { if (e.message !== "http 404") throw e; }
    }
    copies.sort((a, b) => (a.updated < b.updated ? -1 : 1));
    let remoteStudy = null;
    let remoteBoard = null;
    for (const copy of copies) {
      remoteStudy = remoteStudy ? syncable(normalize(mergeState(remoteStudy, copy.payload.study, null))) : copy.payload.study;
      remoteBoard = remoteBoard ? mergeBoardDocs(remoteBoard, copy.payload.board, null) : copy.payload.board;
    }
    const localStudy = syncable(host.getState());
    const localBoard = readBoardDoc();
    const base = conf.base;
    const mergedStudy = remoteStudy ? syncable(normalize(mergeState(localStudy, remoteStudy, baseStudy(base)))) : localStudy;
    const mergedBoard = remoteBoard ? mergeBoardDocs(localBoard, remoteBoard, base && base.board) : localBoard;
    if (!same(mergedStudy, localStudy)) host.applyState(mergedStudy);
    if (mergedBoard && !same(mergedBoard, localBoard)) writeBoardDoc(mergedBoard, { fromRemote: true });
    const target = copies.length ? copies[copies.length - 1].id : "";
    if (!target || !same(mergedStudy, remoteStudy) || !same(mergedBoard, remoteBoard)) {
      const written = await writeGist(target, Object.assign({}, mergedStudy, { board: mergedBoard }));
      conf.gistId = written.id || target;
    } else conf.gistId = target;
    conf.base = { study: mergedStudy, board: mergedBoard };
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
