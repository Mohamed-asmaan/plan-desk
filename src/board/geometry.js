import { STROKE, NOTE_SIZE } from "./doc.js";

/* Pure geometry for board items, all in world units. */

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export const LINE_HEIGHT = 1.3;
let FONT = "\"IBM Plex Sans KR\", \"Segoe UI\", sans-serif";
export function setFont(family) { if (family) FONT = family; }
export function font(size, weight = 400) { return weight + " " + size + "px " + FONT; }

export function isPath(it) { return it.type === "pen" || it.type === "highlighter"; }
export function isLine(it) { return it.type === "line" || it.type === "arrow"; }
export function isBox(it) { return it.type === "rect" || it.type === "ellipse" || it.type === "note"; }

export function strokeWidth(it) {
  if (it.type === "pen") return STROKE.pen[it.size] || STROKE.pen.m;
  if (it.type === "highlighter") return STROKE.highlighter[it.size] || STROKE.highlighter.m;
  return STROKE.shape[it.size] || STROKE.shape.m;
}

/* ---------- Text layout ---------- */
let measureCtx = null;
function mctx() {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  return measureCtx;
}
const layoutCache = new Map();

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of text.split("\n")) {
    if (maxW == null) { out.push(para); continue; }
    const words = para.split(/(\s+)/);
    let line = "";
    for (const word of words) {
      const test = line + word;
      if (line && ctx.measureText(test).width > maxW && word.trim()) {
        out.push(line.replace(/\s+$/, ""));
        line = word;
        // A single word longer than the box breaks by character.
        while (ctx.measureText(line).width > maxW && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxW) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

export function layoutText(text, size, maxW, weight = 400) {
  const key = size + "|" + maxW + "|" + weight + "|" + text;
  const hitCache = layoutCache.get(key);
  if (hitCache) return hitCache;
  const ctx = mctx();
  ctx.font = font(size, weight);
  const lines = wrap(ctx, text || "", maxW);
  let w = 0;
  for (const line of lines) w = Math.max(w, ctx.measureText(line).width);
  const lh = size * LINE_HEIGHT;
  const out = { lines, w: maxW != null ? maxW : Math.max(w, size * 0.6), h: Math.max(1, lines.length) * lh, lh };
  if (layoutCache.size > 400) layoutCache.clear();
  layoutCache.set(key, out);
  return out;
}

export function textBox(it) { return layoutText(it.text, it.fs, it.w ?? null); }

export function noteMetrics(it) {
  const side = Math.min(it.w, it.h);
  const pad = Math.round(side * 0.08);
  const fs = Math.max(8, side * 0.08);
  return { pad, fs, inner: Math.max(1, it.w - pad * 2) };
}

/* ---------- Bounds ---------- */
const boundsCache = new WeakMap();
export function forget(it) { boundsCache.delete(it); }

export function bounds(it) {
  const cached = boundsCache.get(it);
  if (cached) return cached;
  let b;
  if (it.points) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of it.points) {
      if (p[0] < x0) x0 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[0] > x1) x1 = p[0];
      if (p[1] > y1) y1 = p[1];
    }
    b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  } else if (it.type === "text") {
    const t = textBox(it);
    b = { x: it.x, y: it.y, w: t.w, h: t.h };
  } else {
    b = { x: it.x, y: it.y, w: it.w, h: it.h };
  }
  boundsCache.set(it, b);
  return b;
}

/* Bounds including stroke thickness, for culling and export. */
export function paintBounds(it) {
  const b = bounds(it);
  const pad = it.type === "note" ? 12 : it.type === "text" ? 2 : strokeWidth(it) / 2 + (it.type === "arrow" ? strokeWidth(it) * 4 + 8 : 1);
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

export function union(list, fn = bounds) {
  if (!list.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of list) {
    const b = fn(it);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function intersects(a, b) {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}
export function normRect(x0, y0, x1, y1) {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/* ---------- Hit testing ---------- */
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}

function nearPolyline(points, x, y, r) {
  if (points.length === 1) return Math.hypot(points[0][0] - x, points[0][1] - y) <= r;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (segDist(x, y, a[0], a[1], b[0], b[1]) <= r) return true;
  }
  return false;
}

/* outline: true tests only the drawn stroke of hollow shapes (the eraser);
   false lets a click anywhere inside a shape pick it (selection). */
export function hitItem(it, x, y, tol, outline = false) {
  const b = bounds(it);
  const half = it.type === "text" || it.type === "note" ? 0 : strokeWidth(it) / 2;
  if (x < b.x - tol - half || x > b.x + b.w + tol + half || y < b.y - tol - half || y > b.y + b.h + tol + half) return false;
  if (it.points) return nearPolyline(it.points, x, y, tol + half);
  if (it.type === "text" || it.type === "note") return true;
  if (it.type === "rect") {
    if (!outline || it.fill) return true;
    const inner = x > b.x + tol + half && x < b.x + b.w - tol - half && y > b.y + tol + half && y < b.y + b.h - tol - half;
    return !inner;
  }
  if (it.type === "ellipse") {
    const rx = b.w / 2;
    const ry = b.h / 2;
    const cx = b.x + rx;
    const cy = b.y + ry;
    const nx = (x - cx) / Math.max(rx + tol + half, 0.5);
    const ny = (y - cy) / Math.max(ry + tol + half, 0.5);
    const outside = nx * nx + ny * ny > 1;
    if (outside) return false;
    if (!outline || it.fill) return true;
    const ix = (x - cx) / Math.max(rx - tol - half, 0.5);
    const iy = (y - cy) / Math.max(ry - tol - half, 0.5);
    return ix * ix + iy * iy >= 1 || rx - tol - half <= 0 || ry - tol - half <= 0;
  }
  return false;
}

export function topHit(items, x, y, tol, outline = false) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (hitItem(items[i], x, y, tol, outline)) return items[i];
  }
  return null;
}

/* ---------- Transforms (return new items) ---------- */
const r1 = (n) => Math.round(n * 10) / 10;

export function translate(it, dx, dy) {
  if (it.points) return { ...it, points: it.points.map((p) => (p.length > 2 ? [r1(p[0] + dx), r1(p[1] + dy), p[2]] : [r1(p[0] + dx), r1(p[1] + dy)])) };
  return { ...it, x: r1(it.x + dx), y: r1(it.y + dy) };
}

export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export function handlePoints(b) {
  const { x, y, w, h } = b;
  return {
    nw: [x, y], n: [x + w / 2, y], ne: [x + w, y], e: [x + w, y + h / 2],
    se: [x + w, y + h], s: [x + w / 2, y + h], sw: [x, y + h], w: [x, y + h / 2]
  };
}
export const HANDLE_CURSOR = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", p0: "move", p1: "move"
};

/* Resize one item from its original bounds b0 by dragging handle h to (px, py). */
export function resizeItem(orig, b0, h, px, py, keepAspect) {
  let l = b0.x, t = b0.y, r = b0.x + b0.w, btm = b0.y + b0.h;
  if (h.includes("w")) l = px;
  if (h.includes("e")) r = px;
  if (h.includes("n")) t = py;
  if (h.includes("s")) btm = py;
  const MIN = 4;
  if (r - l < MIN) { if (h.includes("w")) l = r - MIN; else r = l + MIN; }
  if (btm - t < MIN) { if (h.includes("n")) t = btm - MIN; else btm = t + MIN; }
  let w = r - l;
  let hh = btm - t;
  const corner = h.length === 2;
  const square = orig.type === "note";
  if ((keepAspect || square || (orig.type === "text" && corner)) && corner && b0.w > 0 && b0.h > 0) {
    const s = Math.max(w / b0.w, hh / b0.h);
    w = b0.w * s;
    hh = b0.h * s;
    if (h.includes("w")) l = r - w;
    if (h.includes("n")) t = btm - hh;
  }
  if (square && !corner) {
    const s = h === "e" || h === "w" ? w : hh;
    w = hh = s;
    if (h === "n") t = btm - s;
    if (h === "w") l = r - s;
  }

  if (orig.points) {
    const sx = b0.w ? w / b0.w : 1;
    const sy = b0.h ? hh / b0.h : 1;
    return {
      ...orig,
      points: orig.points.map((p) => {
        const q = [r1(l + (p[0] - b0.x) * sx), r1(t + (p[1] - b0.y) * sy)];
        if (p.length > 2) q.push(p[2]);
        return q;
      })
    };
  }
  if (orig.type === "text") {
    if (!corner && (h === "e" || h === "w")) {
      const nw = Math.max(orig.fs, w);
      return { ...orig, w: r1(nw), x: r1(h === "w" ? r - nw : l) };
    }
    const scale = b0.h ? hh / b0.h : 1;
    const fs = Math.max(6, Math.min(400, Math.round(orig.fs * scale * 10) / 10));
    const next = { ...orig, fs, w: orig.w != null ? r1(orig.w * scale) : null };
    const nb = textBox(next);
    next.x = r1(h.includes("w") ? r - nb.w : h.includes("e") || corner ? l : b0.x + (b0.w - nb.w) / 2);
    next.y = r1(h.includes("n") ? btm - nb.h : t);
    return next;
  }
  return { ...orig, x: r1(l), y: r1(t), w: r1(w), h: r1(hh) };
}

export function snapAngle(x0, y0, x1, y1) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const step = Math.PI / 12;
  const s = Math.round(a / step) * step;
  const d = Math.hypot(x1 - x0, y1 - y0);
  return [x0 + Math.cos(s) * d, y0 + Math.sin(s) * d];
}

export const DEFAULT_NOTE = NOTE_SIZE;
