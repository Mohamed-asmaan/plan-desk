import { colorHex, noteHex } from "./doc.js";
import { bounds, font, handlePoints, intersects, isLine, noteMetrics, paintBounds, strokeWidth, textBox, layoutText, HANDLES } from "./geometry.js";

/* Canvas 2D painting. Items draw in world units; the caller sets the
   world transform. Overlays draw in CSS pixels. */

function tint(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
}

/* Quadratic curves through the midpoints of the raw samples. With
   pressure, each piece gets its own width. */
function drawPath(ctx, pts, width, pressure) {
  if (pts.length === 1 || (pts.length === 2 && pts[0][0] === pts[1][0] && pts[0][1] === pts[1][1])) {
    const p = pts[0];
    const r = (pressure ? width * (0.35 + 1.3 * (p[2] ?? 0.5)) : width) / 2;
    ctx.beginPath();
    ctx.arc(p[0], p[1], Math.max(r, 0.5), 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    return;
  }
  if (!pressure) {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
    return;
  }
  let sx = pts[0][0];
  let sy = pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const next = pts[i + 1];
    const ex = next ? (p[0] + next[0]) / 2 : p[0];
    const ey = next ? (p[1] + next[1]) / 2 : p[1];
    ctx.lineWidth = width * (0.35 + 1.3 * (p[2] ?? 0.5));
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(p[0], p[1], ex, ey);
    ctx.stroke();
    sx = ex;
    sy = ey;
  }
}

function drawArrowHead(ctx, a, b, width) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const len = Math.max(10, width * 4);
  const spread = 0.48;
  ctx.beginPath();
  ctx.moveTo(b[0] - Math.cos(ang - spread) * len, b[1] - Math.sin(ang - spread) * len);
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(b[0] - Math.cos(ang + spread) * len, b[1] - Math.sin(ang + spread) * len);
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export function drawItem(ctx, it, hideText) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const color = colorHex(it.color);
  if (it.type === "pen") {
    ctx.strokeStyle = color;
    drawPath(ctx, it.points, strokeWidth(it), it.points.some((p) => p.length > 2));
  } else if (it.type === "highlighter") {
    ctx.globalAlpha = 0.38;
    ctx.globalCompositeOperation = "multiply";
    ctx.strokeStyle = color;
    drawPath(ctx, it.points, strokeWidth(it), false);
  } else if (isLine(it)) {
    const w = strokeWidth(it);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    const [a, b] = [it.points[0], it.points[it.points.length - 1]];
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    if (it.type === "arrow" && (a[0] !== b[0] || a[1] !== b[1])) drawArrowHead(ctx, a, b, w);
  } else if (it.type === "rect" || it.type === "ellipse") {
    const w = strokeWidth(it);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    if (it.type === "rect") {
      roundRect(ctx, it.x, it.y, it.w, it.h, Math.min(6, it.w / 4, it.h / 4));
    } else {
      ctx.ellipse(it.x + it.w / 2, it.y + it.h / 2, Math.max(it.w / 2, 0.1), Math.max(it.h / 2, 0.1), 0, 0, Math.PI * 2);
    }
    if (it.fill) {
      ctx.fillStyle = tint(color, 0.14);
      ctx.fill();
    }
    ctx.stroke();
  } else if (it.type === "text") {
    if (!hideText) {
      const t = textBox(it);
      ctx.fillStyle = color;
      ctx.font = font(it.fs);
      ctx.textBaseline = "middle";
      t.lines.forEach((line, i) => ctx.fillText(line, it.x, it.y + t.lh * (i + 0.5)));
    }
  } else if (it.type === "note") {
    ctx.shadowColor = "rgba(44, 40, 36, 0.14)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = noteHex(it.bg);
    roundRect(ctx, it.x, it.y, it.w, it.h, 3);
    ctx.fill();
    ctx.shadowColor = "transparent";
    if (!hideText && it.text) {
      const m = noteMetrics(it);
      const t = layoutText(it.text, m.fs, m.inner);
      ctx.save();
      ctx.beginPath();
      ctx.rect(it.x, it.y, it.w, it.h);
      ctx.clip();
      ctx.fillStyle = colorHex("ink");
      ctx.font = font(m.fs);
      ctx.textBaseline = "middle";
      t.lines.forEach((line, i) => ctx.fillText(line, it.x + m.pad, it.y + m.pad + t.lh * (i + 0.5)));
      ctx.restore();
    }
  }
  ctx.restore();
}

export function drawItems(ctx, items, view, cw, ch, hideId) {
  const vis = { x: -view.x / view.z, y: -view.y / view.z, w: cw / view.z, h: ch / view.z };
  for (const it of items) {
    if (!intersects(paintBounds(it), vis)) continue;
    drawItem(ctx, it, it.id === hideId);
  }
}

/* Dot grid in screen space. The spacing doubles as you zoom out so the
   dots never crowd closer than about 14px. */
export function drawGrid(ctx, view, cw, ch, color) {
  let step = 24;
  while (step * view.z < 14) step *= 2;
  const s = step * view.z;
  const ox = ((view.x % s) + s) % s;
  const oy = ((view.y % s) + s) % s;
  const r = Math.min(1.25, Math.max(0.8, view.z));
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let x = ox; x < cw; x += s) {
    for (let y = oy; y < ch; y += s) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

/* Selection chrome in CSS pixels. */
export function drawSelection(ctx, items, view, colors, showHandles) {
  if (!items.length) return;
  const toS = (x, y) => [x * view.z + view.x, y * view.z + view.y];
  ctx.save();
  ctx.strokeStyle = colors.sage;
  ctx.lineWidth = 1;
  if (items.length > 1) {
    ctx.globalAlpha = 0.55;
    for (const it of items) {
      const b = bounds(it);
      const [x, y] = toS(b.x, b.y);
      ctx.strokeRect(Math.round(x) - 2.5, Math.round(y) - 2.5, Math.round(b.w * view.z) + 5, Math.round(b.h * view.z) + 5);
    }
    ctx.globalAlpha = 1;
  }
  if (items.length === 1 && isLine(items[0])) {
    const pts = items[0].points;
    const ends = [pts[0], pts[pts.length - 1]];
    for (const p of ends) {
      const [x, y] = toS(p[0], p[1]);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = colors.white;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  const b = selectionBox(items, view);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  if (showHandles) {
    const hp = handlePoints(b);
    for (const key of HANDLES) {
      const [x, y] = hp[key];
      ctx.fillStyle = colors.white;
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.strokeRect(x - 4, y - 4, 8, 8);
    }
  }
  ctx.restore();
}

/* Screen-space selection box: a 4px gap around the union of the items. */
export function selectionBox(items, view) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of items) {
    const b = bounds(it);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  const gap = items.length === 1 && (items[0].type === "note" || items[0].type === "text") ? 4 : 6;
  const x = Math.round(x0 * view.z + view.x) - gap + 0.5;
  const y = Math.round(y0 * view.z + view.y) - gap + 0.5;
  return { x, y, w: Math.round((x1 - x0) * view.z) + gap * 2, h: Math.round((y1 - y0) * view.z) + gap * 2 };
}
