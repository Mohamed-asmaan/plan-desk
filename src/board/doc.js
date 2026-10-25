import { BOARD_KEY } from "../model.js";

/* Board document: palette, sizes, storage and the v1 -> v2 migration.
   Stored shape: { v: 2, items: [...], view: { x, y, z }, prefs: {...} } */

export const VERSION = 2;

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
export const STROKE = {
  pen: { s: 2, m: 4, l: 8 },
  highlighter: { s: 12, m: 20, l: 32 },
  shape: { s: 2, m: 3, l: 6 }
};
export const TEXT_SIZE = { s: 16, m: 24, l: 36 };
export const NOTE_SIZE = 200;

export const DEFAULT_PREFS = {
  pen: { color: "ink", size: "m" },
  highlighter: { color: "gold", size: "m" },
  shape: { color: "ink", size: "m", fill: false },
  text: { color: "ink", size: "m" },
  note: { bg: "cream" }
};

let counter = 0;
export function uid() {
  counter = (counter + 1) % 1e6;
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + counter.toString(36);
}

export function colorHex(name) { return (COLORS[name] || COLORS.ink).hex; }
export function noteHex(name) { return (NOTE_BG[name] || NOTE_BG.cream).hex; }

/* ---------- v1 migration ----------
   v1 was an array of strokes with points normalised to the canvas box.
   They map into a 1200x800 world frame. Erase strokes cut the strokes
   drawn before them, the way they looked on screen. */
const FRAME_W = 1200;
const FRAME_H = 800;
const OLD_ERASE_R = 12;

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

export function migrateV1(strokes) {
  let runs = [];
  for (const stroke of strokes) {
    if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length) continue;
    const pts = stroke.points
      .filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]))
      .map((p) => [Math.round(p[0] * FRAME_W * 10) / 10, Math.round(p[1] * FRAME_H * 10) / 10]);
    if (!pts.length) continue;
    if (stroke.erase) {
      const next = [];
      for (const run of runs) {
        let piece = [];
        for (const pt of run.points) {
          if (nearPath(pt, pts, OLD_ERASE_R)) {
            if (piece.length > 1) next.push({ ...run, points: piece });
            piece = [];
          } else piece.push(pt);
        }
        if (piece.length > 1 || (piece.length === 1 && run.points.length === 1)) next.push({ ...run, points: piece });
      }
      runs = next;
    } else {
      runs.push({ color: COLORS[stroke.ink] ? stroke.ink : "ink", points: pts });
    }
  }
  return runs.map((run) => ({ id: uid(), type: "pen", color: run.color, size: "s", points: run.points }));
}

const TYPES = new Set(["pen", "highlighter", "rect", "ellipse", "arrow", "line", "text", "note"]);
function validItem(it) {
  if (!it || typeof it !== "object" || !TYPES.has(it.type) || typeof it.id !== "string") return false;
  if (it.points) return Array.isArray(it.points) && it.points.length > 0;
  return isFinite(it.x) && isFinite(it.y);
}

export function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(BOARD_KEY) || "null"); } catch (e) { raw = null; }
  const prefs = structuredClone(DEFAULT_PREFS);
  if (Array.isArray(raw)) return { items: migrateV1(raw), view: null, prefs, migrated: true };
  if (raw && typeof raw === "object" && Array.isArray(raw.items)) {
    const view = raw.view && isFinite(raw.view.x) && isFinite(raw.view.y) && raw.view.z > 0 ? raw.view : null;
    if (raw.prefs && typeof raw.prefs === "object") {
      for (const key of Object.keys(prefs)) {
        if (raw.prefs[key] && typeof raw.prefs[key] === "object") prefs[key] = { ...prefs[key], ...raw.prefs[key] };
      }
    }
    return { items: raw.items.filter(validItem), view, prefs, migrated: false };
  }
  return { items: [], view: null, prefs, migrated: false };
}

export function save(items, view, prefs) {
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify({ v: VERSION, items, view, prefs }));
    return true;
  } catch (e) {
    return false;
  }
}
