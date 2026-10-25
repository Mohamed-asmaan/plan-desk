/* Named practice snippets. Stored apart from study progress so a corrupt
   snippet cannot wipe tasks. Synced on the same gist as the rest of the desk. */

const KEY = "gsoc-study-code";
const LIMIT = 40;
const CODE_CAP = 40000;
const NOTE_CAP = 2000;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function cleanItem(item, index) {
  if (!item || typeof item !== "object") return null;
  const lang = item.lang === "javascript" ? "javascript" : "python";
  const name = typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 40) : "Snippet " + (index + 1);
  return {
    id: typeof item.id === "string" && item.id ? item.id : uid(),
    name,
    lang,
    code: typeof item.code === "string" ? item.code.slice(0, CODE_CAP) : "",
    note: typeof item.note === "string" ? item.note.slice(0, NOTE_CAP) : "",
    updatedAt: typeof item.updatedAt === "number" && item.updatedAt > 0 ? item.updatedAt : 0
  };
}

export function blankSnippet(index = 0) {
  return { id: uid(), name: index ? "Snippet " + (index + 1) : "Snippet", lang: "python", code: "", note: "", updatedAt: 0 };
}

export function normalizeCodeDoc(raw) {
  const blank = () => ({ v: 1, active: "", updatedAt: 0, items: [] });
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return blank();
  const items = [];
  const seen = new Set();
  for (const item of raw.items) {
    const clean = cleanItem(item, items.length);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    items.push(clean);
    if (items.length >= LIMIT) break;
  }
  const active = items.some((item) => item.id === raw.active) ? raw.active : (items[0] ? items[0].id : "");
  return {
    v: 1,
    active,
    updatedAt: typeof raw.updatedAt === "number" && raw.updatedAt > 0 ? raw.updatedAt : 0,
    items
  };
}

export function readCodeDoc() {
  try { return normalizeCodeDoc(JSON.parse(localStorage.getItem(KEY) || "null")); }
  catch (e) { return normalizeCodeDoc(null); }
}

export function writeCodeDoc(doc, { fromRemote = false } = {}) {
  const out = normalizeCodeDoc(doc);
  if (!fromRemote) out.updatedAt = Date.now();
  let ok = true;
  try { localStorage.setItem(KEY, JSON.stringify(out)); }
  catch (e) { ok = false; }
  if (fromRemote && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("code:replaced"));
  return ok;
}

function same(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeItems(local, remote, base) {
  const L = new Map((local || []).map((item) => [item.id, item]));
  const R = new Map((remote || []).map((item) => [item.id, item]));
  const B = new Map((base || []).map((item) => [item.id, item]));
  const out = [];
  for (const id of new Set([...L.keys(), ...R.keys(), ...B.keys()])) {
    const l = L.get(id);
    const r = R.get(id);
    const b = B.get(id);
    if (same(l, b) && same(r, b)) { if (l) out.push(l); continue; }
    if (same(l, b)) { if (r) out.push(r); continue; }
    if (same(r, b)) { if (l) out.push(l); continue; }
    const pick = l && r ? ((r.updatedAt || 0) >= (l.updatedAt || 0) ? r : l) : (l || r);
    if (pick) out.push(pick);
  }
  return out.slice(0, LIMIT);
}

export function mergeCodeDocs(local, remote, base) {
  const L = local ? normalizeCodeDoc(local) : null;
  const R = remote ? normalizeCodeDoc(remote) : null;
  if (!R) return L || normalizeCodeDoc(null);
  if (!L) return R;
  const B = base ? normalizeCodeDoc(base) : null;
  const items = mergeItems(L.items, R.items, B && B.items);
  const preferRemote = same(L, B) || (!same(R, B) && (R.updatedAt || 0) >= (L.updatedAt || 0));
  const shell = preferRemote ? R : L;
  const active = items.some((item) => item.id === shell.active) ? shell.active : (items[0] ? items[0].id : "");
  return { v: 1, active, updatedAt: Math.max(L.updatedAt || 0, R.updatedAt || 0), items };
}
