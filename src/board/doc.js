import { BOARD_KEY } from "../model.js";

/* Board document: palette, sizes, storage, migrations and sync merge.

   Stored shape (v3):
   { v: 3, active, prefs, updatedAt,
     boards: [{ id, name, items, view: { x, y, z } | null, updatedAt }] }

   Older shapes still load:
   - v1: an array of strokes with points normalised to the canvas box
   - v2: { v: 2, items, view, prefs } (one board)
   - vanilla multi-board: { active, pens, eraseW, updatedAt,
       boards: [{ id, name, strokes: [{ ink, erase, soft, w, points }], updatedAt }] } */

export const VERSION = 3;
export const BOARD_LIMIT = 8;
export const WIDTH_MIN = 1;
export const WIDTH_MAX = 32;

/* Canvas needs real colour values; these mirror the styles.css tokens. */
export const COLORS = {
  ink: { label: "Ink", hex: "#2c2824" },
  sage: { label: "Sage", hex: "#3d6b52" },
  seal: { label: "Seal", hex: "#9d4a3c" },
  gold: { label: "Gold", hex: "#c4963a" },
  blue: { label: "Blue", hex: "#4a6f8f" },
  plum: { label: "Plum", hex: "#76598a" }
};
export const NOTE_BG = {
  cream: { label: "Cream", hex: "#fbf1cf" },
  sage: { label: "Sage", hex: "#dcebdf" },
  sky: { label: "Sky", hex: "#dbe7f1" },
  blush: { label: "Blush", hex: "#f6e0dc" }
};
export const SIZES = { s: "Small", m: "Medium", l: "Large" };
/* Quick-pick widths. The slider covers everything between. */
export const STROKE = {
  pen: { s: 2, m: 4, l: 8 },
  highlighter: { s: 12, m: 20, l: 32 },
  shape: { s: 2, m: 3, l: 6 },
  eraser: { s: 8, m: 20, l: 32 }
};
export const TEXT_SIZE = { s: 16, m: 24, l: 36 };
export const NOTE_SIZE = 200;

export const DEFAULT_PREFS = {
  pen: { color: "ink", width: 4 },
  highlighter: { color: "gold", width: 20 },
  shape: { color: "ink", width: 3, fill: false },
  text: { color: "ink", size: "m" },
  note: { bg: "cream" },
  eraser: { width: 20 }
};

let counter = 0;
export function uid() {
  counter = (counter + 1) % 1e6;
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + counter.toString(36);
}

export function colorHex(name) { return (COLORS[name] || COLORS.ink).hex; }
export function noteHex(name) { return (NOTE_BG[name] || NOTE_BG.cream).hex; }
export function clampWidth(w) {
  const n = Number(w);
  return Number.isFinite(n) ? Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(n * 2) / 2)) : null;
}

/* ---------- Stroke migration (v1 array and vanilla boards) ----------
   Points were normalised to the canvas box; they map into a 1200x800
   world frame. Erase strokes cut the strokes drawn before them, the way
   they looked on screen, and are then dropped. Ids are derived from the
   board id and position so the same input always migrates to the same
   items; sync compares and merges by id. */
const FRAME_W = 1200;
const FRAME_H = 800;

function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}
function nearPath(pt, path, r) {
  const r2 = r * r;
  if (path.length === 1) return segDist2(pt[0], pt[1], path[0][0], path[0][1], path[0][0], path[0][1]) <= r2;
  for (let i = 1; i < path.length; i++) {
    if (segDist2(pt[0], pt[1], path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]) <= r2) return true;
  }
  return false;
}

export function migrateStrokes(strokes, boardId = "board") {
  let runs = [];
  for (const stroke of strokes || []) {
    if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length) continue;
    const pts = stroke.points
      .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => [Math.round(p[0] * FRAME_W * 10) / 10, Math.round(p[1] * FRAME_H * 10) / 10]);
    if (!pts.length) continue;
    const w = clampWidth(stroke.w);
    if (stroke.erase) {
      const r = (w || 22) / 2 + 1;
      const next = [];
      for (const run of runs) {
        let piece = [];
        for (const pt of run.points) {
          if (nearPath(pt, pts, r)) {
            if (piece.length > 1) next.push({ ...run, points: piece });
            piece = [];
          } else piece.push(pt);
        }
        if (piece.length > 1 || (piece.length === 1 && run.points.length === 1)) next.push({ ...run, points: piece });
      }
      runs = next;
    } else {
      runs.push({
        color: COLORS[stroke.ink] ? stroke.ink : "ink",
        soft: !!stroke.soft,
        sw: w || 2.5,
        points: pts
      });
    }
  }
  return runs.map((run, i) => ({
    id: "m-" + boardId + "-" + i,
    type: run.soft ? "highlighter" : "pen",
    color: run.color,
    sw: run.sw,
    points: run.points
  }));
}
/* Kept for callers of the first version. */
export const migrateV1 = (strokes) => migrateStrokes(strokes, "board");

/* ---------- Normalising ---------- */
const TYPES = new Set(["pen", "highlighter", "rect", "ellipse", "arrow", "line", "text", "note"]);
function validItem(it) {
  if (!it || typeof it !== "object" || !TYPES.has(it.type) || typeof it.id !== "string") return false;
  if (it.points) return Array.isArray(it.points) && it.points.length > 0;
  return Number.isFinite(it.x) && Number.isFinite(it.y);
}
function cleanView(view) {
  return view && Number.isFinite(view.x) && Number.isFinite(view.y) && view.z > 0 ? { x: view.x, y: view.y, z: view.z } : null;
}
const time = (t) => (typeof t === "number" && t > 0 ? t : 0);
function cleanName(name, index) {
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : "Board " + (index + 1);
}
export function boardId() {
  return Math.random().toString(36).slice(2, 10);
}
export function blankBoard(index = 0, id) {
  return { id: id || boardId(), name: index ? "Board " + (index + 1) : "Board", items: [], view: null, updatedAt: 0 };
}

function cleanPrefs(raw) {
  const prefs = structuredClone(DEFAULT_PREFS);
  if (!raw || typeof raw !== "object") return prefs;
  for (const key of Object.keys(prefs)) {
    const p = raw[key];
    if (!p || typeof p !== "object") continue;
    if (typeof p.color === "string" && COLORS[p.color] && "color" in prefs[key]) prefs[key].color = p.color;
    if (typeof p.bg === "string" && NOTE_BG[p.bg] && key === "note") prefs[key].bg = p.bg;
    if (typeof p.fill === "boolean" && key === "shape") prefs[key].fill = p.fill;
    if (key === "text" && SIZES[p.size]) prefs.text.size = p.size;
    if ("width" in prefs[key]) {
      // v2 stored a size key; v3 stores the width itself.
      const w = clampWidth(p.width) ?? (STROKE[key] && STROKE[key][p.size]) ?? null;
      if (w) prefs[key].width = w;
    }
  }
  return prefs;
}

function prefsFromVanilla(raw) {
  const prefs = structuredClone(DEFAULT_PREFS);
  if (Array.isArray(raw.pens)) {
    const hard = raw.pens.find((p) => p && !p.soft && COLORS[p.ink]);
    const soft = raw.pens.find((p) => p && p.soft && COLORS[p.ink]);
    if (hard) prefs.pen = { color: hard.ink, width: clampWidth(hard.w) || prefs.pen.width };
    if (soft) prefs.highlighter = { color: soft.ink, width: clampWidth(soft.w) || prefs.highlighter.width };
  }
  const ew = clampWidth(raw.eraseW);
  if (ew) prefs.eraser.width = ew;
  return prefs;
}

function cleanBoard(b, index) {
  const id = b && typeof b.id === "string" && b.id ? b.id : boardId();
  const items = Array.isArray(b && b.items)
    ? b.items.filter(validItem)
    : migrateStrokes(b && Array.isArray(b.strokes) ? b.strokes : [], id);
  return { id, name: cleanName(b && b.name, index), items, view: cleanView(b && b.view), updatedAt: time(b && b.updatedAt) };
}

function blankDoc() {
  return { v: VERSION, active: "board", prefs: structuredClone(DEFAULT_PREFS), updatedAt: 0, boards: [blankBoard(0, "board")] };
}

/** Accepts v1, v2, v3, the vanilla multi-board format or null; returns a v3 doc. */
export function normalizeBoardDoc(raw) {
  try {
    if (Array.isArray(raw)) {
      const doc = blankDoc();
      doc.boards[0].items = migrateStrokes(raw, "board");
      return doc;
    }
    if (!raw || typeof raw !== "object") return blankDoc();
    if (!Array.isArray(raw.boards) && Array.isArray(raw.items)) {
      const doc = blankDoc();
      doc.prefs = cleanPrefs(raw.prefs);
      doc.boards[0].items = raw.items.filter(validItem);
      doc.boards[0].view = cleanView(raw.view);
      return doc;
    }
    if (!Array.isArray(raw.boards)) return blankDoc();
    const seen = new Set();
    const boards = [];
    for (const b of raw.boards) {
      if (boards.length >= BOARD_LIMIT) break;
      const board = cleanBoard(b, boards.length);
      if (seen.has(board.id)) continue;
      seen.add(board.id);
      boards.push(board);
    }
    if (!boards.length) return blankDoc();
    const vanilla = raw.v !== VERSION && raw.boards.some((b) => b && Array.isArray(b.strokes));
    return {
      v: VERSION,
      active: boards.some((b) => b.id === raw.active) ? raw.active : boards[0].id,
      prefs: vanilla ? prefsFromVanilla(raw) : cleanPrefs(raw.prefs),
      updatedAt: time(raw.updatedAt),
      boards
    };
  } catch (e) {
    return blankDoc();
  }
}

/** The current doc from localStorage, normalised and migrated. Never throws. */
export function readBoardDoc() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(BOARD_KEY) || "null"); } catch (e) { raw = null; }
  return normalizeBoardDoc(raw);
}

/** Saves a doc. Local writes stamp doc.updatedAt; remote writes keep it and
    tell the open board to reload. Returns false when storage refused it. */
export function writeBoardDoc(doc, { fromRemote = false } = {}) {
  const out = normalizeBoardDoc(doc);
  if (!fromRemote) out.updatedAt = Date.now();
  let ok = true;
  try { localStorage.setItem(BOARD_KEY, JSON.stringify(out)); } catch (e) { ok = false; }
  if (fromRemote && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("board:replaced"));
  return ok;
}

/* Board.jsx's own save: the doc is already v3 and its times are set. */
export function saveDoc(doc) {
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(doc));
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- Sync merge ---------- */
function same(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeBoardList(local, remote, base) {
  const L = new Map((local || []).map((b) => [b.id, b]));
  const R = new Map((remote || []).map((b) => [b.id, b]));
  const B = new Map((base || []).map((b) => [b.id, b]));
  const out = [];
  for (const id of new Set([...L.keys(), ...R.keys(), ...B.keys()])) {
    const l = L.get(id);
    const r = R.get(id);
    const b = B.get(id);
    if (same(l, b) && same(r, b)) { if (l) out.push(l); continue; }
    if (same(l, b)) { if (r) out.push(r); continue; }
    if (same(r, b)) { if (l) out.push(l); continue; }
    if (!b && l && r) {
      // New on both sides: keep every item, the newer side's copy first.
      const newer = (r.updatedAt || 0) >= (l.updatedAt || 0) ? r : l;
      const older = newer === r ? l : r;
      const ids = new Set(newer.items.map((it) => it.id));
      const items = [...newer.items, ...older.items.filter((it) => !ids.has(it.id))];
      out.push({ ...newer, items, updatedAt: Math.max(l.updatedAt || 0, r.updatedAt || 0) });
      continue;
    }
    const pick = l && r ? ((r.updatedAt || 0) >= (l.updatedAt || 0) ? r : l) : (l || r);
    if (pick) out.push(pick);
  }
  return out.slice(0, BOARD_LIMIT);
}

/** Three-way merge per board id. Any input may be null or an older format. */
export function mergeBoardDocs(local, remote, base) {
  const L = local ? normalizeBoardDoc(local) : null;
  const R = remote ? normalizeBoardDoc(remote) : null;
  if (!R) return L || normalizeBoardDoc(null);
  if (!L) return R;
  const B = base ? normalizeBoardDoc(base) : null;
  const boards = mergeBoardList(L.boards, R.boards, B && B.boards);
  if (!boards.length) return L;
  const preferRemote = same(L, B) || (!same(R, B) && (R.updatedAt || 0) >= (L.updatedAt || 0));
  const shell = preferRemote ? R : L;
  const active = boards.some((b) => b.id === shell.active) ? shell.active : boards[0].id;
  return { ...shell, v: VERSION, boards, active, updatedAt: Math.max(L.updatedAt || 0, R.updatedAt || 0) };
}
