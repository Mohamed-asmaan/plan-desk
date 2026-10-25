import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./board.css";
import { Icon } from "./board/icons.jsx";
import { COLORS, NOTE_BG, SIZES, STROKE, TEXT_SIZE, NOTE_SIZE, BOARD_LIMIT, WIDTH_MIN, WIDTH_MAX, readBoardDoc, saveDoc, blankBoard, uid, colorHex, clampWidth } from "./board/doc.js";
import { BOARD_KEY } from "./model.js";
import { scheduleSync } from "./sync.js";
import { toast } from "./toast.jsx";
import * as G from "./board/geometry.js";
import { drawItem, drawItems, drawGrid, drawSelection, selectionBox } from "./board/render.js";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
const MOD = IS_MAC ? "⌘" : "Ctrl";
const MOD_ARIA = IS_MAC ? "Meta" : "Control";

const TOOLS = [
  { id: "select", label: "Select", key: "V" },
  { id: "hand", label: "Hand", key: "H" },
  null,
  { id: "pen", label: "Pen", key: "P" },
  { id: "highlighter", label: "Highlighter", key: "M" },
  { id: "eraser", label: "Eraser", key: "E" },
  null,
  { id: "rect", label: "Rectangle", key: "R" },
  { id: "ellipse", label: "Ellipse", key: "O" },
  { id: "arrow", label: "Arrow", key: "A" },
  { id: "line", label: "Line", key: "L" },
  null,
  { id: "text", label: "Text", key: "T" },
  { id: "note", label: "Sticky note", key: "N" }
];
const TOOL_LIST = TOOLS.filter(Boolean);
const TOOL_BY_KEY = Object.fromEntries(TOOL_LIST.map((t) => [t.key.toLowerCase(), t.id]));
const PREF_KEY = { pen: "pen", highlighter: "highlighter", rect: "shape", ellipse: "shape", arrow: "shape", line: "shape", text: "text", note: "note", eraser: "eraser" };
const strokeKind = (it) => (it.type === "pen" || it.type === "highlighter" ? it.type : "shape");
const hasStroke = (it) => it.type !== "text" && it.type !== "note";
const quickFor = (kind, w) => Object.keys(STROKE[kind]).find((k) => STROKE[kind][k] === w) || null;
const fmtWidth = (w) => (Number.isInteger(w) ? String(w) : w.toFixed(1));
const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const NUDGE_MERGE_MS = 700;

const SHORTCUTS = [
  ["Tools", [
    ...TOOL_LIST.map((t) => [t.label, [t.key]])
  ]],
  ["Edit", [
    ["Undo", [MOD, "Z"]],
    ["Redo", [MOD, "Shift", "Z"], [MOD, "Y"]],
    ["Duplicate", [MOD, "D"]],
    ["Select all", [MOD, "A"]],
    ["Delete", ["Delete"], ["Backspace"]],
    ["Nudge", ["Arrows"]],
    ["Nudge 10px", ["Shift", "Arrows"]],
    ["Edit text or note", ["Enter"], ["Double-click"]],
    ["Add to selection", ["Shift", "Click"]],
    ["Keep proportions, snap angles", ["Shift", "Drag"]],
    ["Deselect, back to Select", ["Esc"]]
  ]],
  ["Boards", [
    ["Switch board", ["←"], ["→"]],
    ["Rename board", ["F2"], ["Double-click"]],
    ["Delete board", ["Delete"]]
  ]],
  ["View", [
    ["Pan", ["Space", "Drag"], ["Scroll"]],
    ["Zoom", [MOD, "Scroll"], ["Pinch"]],
    ["Zoom in", [MOD, "+"]],
    ["Zoom out", [MOD, "−"]],
    ["Zoom to 100%", [MOD, "0"]],
    ["Zoom to fit", ["Shift", "1"]],
    ["Keyboard shortcuts", ["?"]]
  ]]
];

const r1 = (n) => Math.round(n * 10) / 10;
const sizeFromFs = (fs) => Object.entries(TEXT_SIZE).reduce((best, [k, v]) => (Math.abs(v - fs) < Math.abs(TEXT_SIZE[best] - fs) ? k : best), "m");

function useMedia(query) {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

function Tip({ label, keys, side }) {
  return (
    <span className="wb-tip" data-side={side} aria-hidden="true">
      {label}
      {keys && <span className="wb-keys">{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>}
    </span>
  );
}

function IconButton({ icon, label, keys, ariaKeys, side, className = "", btnRef, disabled, ...rest }) {
  return (
    <button
      type="button"
      ref={btnRef}
      className={"wb-btn " + className}
      aria-label={label}
      aria-keyshortcuts={ariaKeys}
      aria-disabled={disabled || undefined}
      {...rest}
    >
      <Icon name={icon} />
      <Tip label={label} keys={keys} side={side} />
    </button>
  );
}

export default function Board() {
  const meta = useRef(null);
  const needsWrite = useRef(false);
  if (!meta.current) {
    try {
      const raw = JSON.parse(localStorage.getItem(BOARD_KEY) || "null");
      needsWrite.current = !!raw && raw.v !== 3;
    } catch (e) { needsWrite.current = false; }
    meta.current = readBoardDoc();
  }
  const activeBoard = () => meta.current.boards.find((b) => b.id === meta.current.active) || meta.current.boards[0];
  const histories = useRef(new Map());
  const doc = useRef(null);
  if (!doc.current) doc.current = { items: activeBoard().items, past: [], future: [] };
  const dirty = useRef({ items: false, doc: false });

  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const editorRef = useRef(null);
  const toolBtns = useRef([]);
  const menuBtnRef = useRef(null);
  const menuRef = useRef(null);

  const viewRef = useRef(activeBoard().view || { x: 0, y: 0, z: 1 });
  const needFit = useRef(!activeBoard().view && activeBoard().items.length > 0);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const colorsRef = useRef({ sage: "#3d6b52", white: "#ffffff", dot: "rgba(44,40,36,0.18)", paper: "#f7f4ee", muted: "#5e574e" });
  const drag = useRef(null);
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const spaceRef = useRef(false);
  const overRef = useRef(false);
  const hoverPt = useRef(null);
  const hoverCursor = useRef("default");
  const paintReq = useRef(0);
  const saveTimer = useRef(0);
  const lastTap = useRef(null);
  const lastNudge = useRef(null);
  const editRef = useRef(null);

  const [tool, setToolState] = useState("select");
  const toolRef = useRef("select");
  const [sel, setSel] = useState([]);
  const selRef = useRef([]);
  const [prefs, setPrefs] = useState(meta.current.prefs);
  const prefsRef = useRef(meta.current.prefs);
  const [zoom, setZoom] = useState(viewRef.current.z);
  const [, setVersion] = useState(0);
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [rove, setRove] = useState(0);
  const phone = useMedia("(max-width: 719px)");
  const dialogRef = useRef({ help: false, menu: false });
  dialogRef.current = { help: helpOpen, menu: menuOpen };

  const bump = () => setVersion((v) => v + 1);

  /* ---------- Storage ---------- */
  function flushSave() {
    clearTimeout(saveTimer.current);
    saveTimer.current = 0;
    const v = viewRef.current;
    const m = meta.current;
    const board = activeBoard();
    board.items = doc.current.items;
    board.view = { x: r1(v.x), y: r1(v.y), z: Math.round(v.z * 1000) / 1000 };
    m.prefs = prefsRef.current;
    const d = dirty.current;
    if (d.items || d.doc) {
      const now = Date.now();
      if (d.items) board.updatedAt = now;
      m.updatedAt = now;
    }
    saveDoc({ ...m, v: 3 });
    if (d.items || d.doc) scheduleSync();
    dirty.current = { items: false, doc: false };
  }
  function scheduleSave() {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 300);
  }

  const eraseR = () => Math.max(2, (prefsRef.current.eraser?.width || 20) / 2);

  /* ---------- Painting ---------- */
  function selectedItems() {
    const ids = new Set(selRef.current);
    return ids.size ? doc.current.items.filter((it) => ids.has(it.id)) : [];
  }
  function requestPaint() {
    if (!paintReq.current) paintReq.current = requestAnimationFrame(paint);
  }
  function paint() {
    paintReq.current = 0;
    const canvas = canvasRef.current;
    const { w, h, dpr } = sizeRef.current;
    if (!canvas || !w) return;
    const ctx = canvas.getContext("2d");
    const v = viewRef.current;
    const col = colorsRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawGrid(ctx, v, w, h, col.dot);
    ctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y);
    drawItems(ctx, doc.current.items, v, w, h, editRef.current?.id);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const d = drag.current;
    const selected = selectedItems();
    if (selected.length && !(d && (d.kind === "draw" || d.kind === "shape"))) {
      const handles = selected.length === 1 && !editRef.current && toolRef.current === "select" && !(d && d.kind === "move" && d.moved);
      drawSelection(ctx, selected, v, col, handles);
    }
    if (d && d.kind === "marquee") {
      const r = G.normRect(d.start[0], d.start[1], d.cur[0], d.cur[1]);
      const x = Math.round(r.x * v.z + v.x) + 0.5;
      const y = Math.round(r.y * v.z + v.y) + 0.5;
      ctx.fillStyle = col.sage;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(x, y, Math.round(r.w * v.z), Math.round(r.h * v.z));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col.sage;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, Math.round(r.w * v.z), Math.round(r.h * v.z));
    }
    if (toolRef.current === "eraser" && hoverPt.current && !spaceRef.current) {
      const [x, y] = hoverPt.current;
      ctx.beginPath();
      ctx.arc(x, y, eraseR(), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fill();
      ctx.strokeStyle = col.muted;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    positionEditor();
  }

  function positionEditor() {
    const ed = editRef.current;
    const el = editorRef.current;
    if (!ed || !el) return;
    const it = doc.current.items.find((i) => i.id === ed.id);
    if (!it) return;
    const v = viewRef.current;
    const s = el.style;
    if (it.type === "text") {
      const t = G.textBox(it);
      s.left = it.x * v.z + v.x + "px";
      s.top = it.y * v.z + v.y + "px";
      s.width = (it.w != null ? it.w : t.w + it.fs * 0.75) * v.z + "px";
      s.height = t.h * v.z + "px";
      s.fontSize = it.fs * v.z + "px";
      s.color = colorHex(it.color);
    } else {
      const m = G.noteMetrics(it);
      s.left = (it.x + m.pad) * v.z + v.x + "px";
      s.top = (it.y + m.pad) * v.z + v.y + "px";
      s.width = m.inner * v.z + "px";
      s.height = (it.h - m.pad * 2) * v.z + "px";
      s.fontSize = m.fs * v.z + "px";
      s.color = colorHex("ink");
    }
  }

  /* ---------- Document changes ---------- */
  function setSelection(ids) {
    selRef.current = ids;
    setSel(ids);
    requestPaint();
  }
  function apply(next, before) {
    const d = doc.current;
    if (before) {
      d.past.push(before);
      if (d.past.length > 100) d.past.shift();
      d.future = [];
    }
    d.items = next;
    dirty.current.items = true;
    const ids = new Set(next.map((i) => i.id));
    if (selRef.current.some((id) => !ids.has(id))) setSelection(selRef.current.filter((id) => ids.has(id)));
    scheduleSave();
    requestPaint();
    bump();
  }
  function undo() {
    commitEdit();
    const d = doc.current;
    if (!d.past.length) return;
    d.future.push(d.items);
    lastNudge.current = null;
    apply(d.past.pop());
  }
  function redo() {
    commitEdit();
    const d = doc.current;
    if (!d.future.length) return;
    d.past.push(d.items);
    lastNudge.current = null;
    apply(d.future.pop());
  }
  function deleteSelection() {
    if (!selRef.current.length) return;
    const ids = new Set(selRef.current);
    const items = doc.current.items;
    setSelection([]);
    apply(items.filter((i) => !ids.has(i.id)), items);
  }
  function duplicate() {
    const sels = selectedItems();
    if (!sels.length) return;
    const offset = 16 / Math.max(viewRef.current.z, 0.5);
    const clones = sels.map((it) => ({ ...G.translate(it, offset, offset), id: uid() }));
    const items = doc.current.items;
    apply([...items, ...clones], items);
    setSelection(clones.map((c) => c.id));
  }
  function selectAll() {
    commitEdit();
    if (toolRef.current !== "select") setTool("select");
    setSelection(doc.current.items.map((i) => i.id));
  }
  function nudge(dx, dy) {
    const ids = new Set(selRef.current);
    if (!ids.size) return;
    const z = viewRef.current.z;
    const items = doc.current.items;
    const next = items.map((it) => (ids.has(it.id) ? G.translate(it, dx / z, dy / z) : it));
    applyMerged(next, "nudge");
  }
  /* Repeated small edits (nudges, slider drags) share one undo step. */
  function applyMerged(next, kind) {
    const items = doc.current.items;
    const now = performance.now();
    const last = lastNudge.current;
    const merge = last && last.kind === kind && last.items === items && now - last.t < NUDGE_MERGE_MS;
    apply(next, merge ? undefined : items);
    lastNudge.current = { kind, t: now, items: next };
  }
  function clearBoard() {
    setMenuOpen(false);
    commitEdit();
    const items = doc.current.items;
    if (!items.length) return;
    const id = meta.current.active;
    setSelection([]);
    apply([], items);
    toast("Board cleared.", () => {
      if (!meta.current.boards.some((b) => b.id === id)) return;
      switchBoard(id);
      apply(items, doc.current.items);
    });
  }

  /* ---------- Boards ---------- */
  function loadActive() {
    const b = activeBoard();
    const h = histories.current.get(b.id) || { past: [], future: [] };
    doc.current = { items: b.items, past: h.past, future: h.future };
    drag.current = null;
    lastNudge.current = null;
    selRef.current = [];
    setSel([]);
    if (b.view) setView(b.view, true);
    else if (b.items.length) zoomToFit(true);
    else setView({ x: 0, y: 0, z: 1 }, true);
    requestPaint();
    bump();
  }
  function switchBoard(id) {
    const m = meta.current;
    if (!m.boards.some((b) => b.id === id) || id === m.active) return;
    commitEdit();
    if (drag.current) abortDrag();
    flushSave();
    histories.current.set(m.active, { past: doc.current.past, future: doc.current.future });
    m.active = id;
    loadActive();
    flushSave();
  }
  function addBoard() {
    const m = meta.current;
    setMenuOpen(false);
    if (m.boards.length >= BOARD_LIMIT) { toast("You can keep up to " + BOARD_LIMIT + " boards."); return; }
    let n = m.boards.length + 1;
    while (m.boards.some((b) => b.name === "Board " + n)) n++;
    const b = blankBoard(n - 1);
    b.name = "Board " + n;
    b.updatedAt = Date.now();
    m.boards.push(b);
    dirty.current.doc = true;
    switchBoard(b.id);
  }
  function renameBoard(id, name) {
    setRenaming(null);
    const b = meta.current.boards.find((x) => x.id === id);
    const next = (name || "").trim().slice(0, 40);
    if (!b || !next || next === b.name) return;
    b.name = next;
    b.updatedAt = Date.now();
    dirty.current.doc = true;
    flushSave();
    bump();
  }
  function deleteBoard(id) {
    const m = meta.current;
    setMenuOpen(false);
    if (m.boards.length <= 1) return;
    commitEdit();
    flushSave();
    const index = m.boards.findIndex((b) => b.id === id);
    if (index < 0) return;
    const gone = m.boards[index];
    const hist = id === m.active ? { past: doc.current.past, future: doc.current.future } : histories.current.get(id);
    m.boards.splice(index, 1);
    histories.current.delete(id);
    dirty.current.doc = true;
    if (id === m.active) {
      m.active = m.boards[Math.min(index, m.boards.length - 1)].id;
      loadActive();
    }
    flushSave();
    bump();
    toast("Board deleted.", () => {
      const mm = meta.current;
      if (mm.boards.some((b) => b.id === gone.id) || mm.boards.length >= BOARD_LIMIT) return;
      mm.boards.splice(Math.min(index, mm.boards.length), 0, { ...gone, updatedAt: Date.now() });
      if (hist) histories.current.set(gone.id, hist);
      dirty.current.doc = true;
      switchBoard(gone.id);
      flushSave();
      bump();
    });
  }
  /* Sync wrote a merged doc: start over from storage, with no history. */
  function reloadFromStorage() {
    clearTimeout(saveTimer.current);
    saveTimer.current = 0;
    dirty.current = { items: false, doc: false };
    editRef.current = null;
    setEditing(null);
    setRenaming(null);
    histories.current = new Map();
    meta.current = readBoardDoc();
    prefsRef.current = meta.current.prefs;
    setPrefs(meta.current.prefs);
    loadActive();
  }

  /* ---------- Tools and properties ---------- */
  function setTool(id) {
    commitEdit();
    toolRef.current = id;
    setToolState(id);
    if (id !== "select" && id !== "hand") setSelection([]);
    const i = TOOL_LIST.findIndex((t) => t.id === id);
    if (i >= 0) setRove(i);
    updateCursor();
    requestPaint();
  }
  function applicable(it, key) {
    if (key === "bg") return it.type === "note";
    if (key === "fill") return it.type === "rect" || it.type === "ellipse";
    if (key === "width") return hasStroke(it);
    return it.type !== "note";
  }
  function setProp(key, value) {
    const ids = new Set(selRef.current);
    if (toolRef.current === "select" && ids.size) {
      const items = doc.current.items;
      let changed = false;
      const next = items.map((it) => {
        if (!ids.has(it.id) || !applicable(it, key)) return it;
        changed = true;
        if (key === "size" && it.type === "text") return { ...it, fs: TEXT_SIZE[value] };
        if (key === "size") { const { size, ...rest } = it; return { ...rest, sw: STROKE[strokeKind(it)][value] }; }
        if (key === "width") { const { size, ...rest } = it; return { ...rest, sw: clampWidth(value) }; }
        return { ...it, [key]: value };
      });
      if (changed) {
        if (key === "width") applyMerged(next, "width");
        else apply(next, items);
      }
      return;
    }
    const pk = PREF_KEY[toolRef.current];
    if (!pk) return;
    let patch = { [key]: value };
    if (key === "size" && pk !== "text") patch = { width: STROKE[pk][value] };
    if (key === "width") patch = { width: clampWidth(value) };
    const nextPrefs = { ...prefsRef.current, [pk]: { ...prefsRef.current[pk], ...patch } };
    prefsRef.current = nextPrefs;
    setPrefs(nextPrefs);
    scheduleSave();
  }

  /* ---------- View ---------- */
  function setView(v) {
    viewRef.current = v;
    setZoom(v.z);
    requestPaint();
    scheduleSave();
  }
  function zoomAt(sx, sy, z) {
    const v = viewRef.current;
    z = G.clampZoom(z);
    const wx = (sx - v.x) / v.z;
    const wy = (sy - v.y) / v.z;
    setView({ x: sx - wx * z, y: sy - wy * z, z });
  }
  function zoomStep(dir) {
    const z = viewRef.current.z;
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 1e-3) ?? G.ZOOM_MAX : [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-3) ?? G.ZOOM_MIN;
    const { w, h } = sizeRef.current;
    zoomAt(w / 2, h / 2, next);
  }
  function zoomReset() {
    const { w, h } = sizeRef.current;
    zoomAt(w / 2, h / 2, 1);
  }
  function zoomToFit() {
    const { w, h } = sizeRef.current;
    if (!w || !h) return;
    const items = doc.current.items;
    if (!items.length) {
      setView({ x: 0, y: 0, z: 1 });
      return;
    }
    const b = G.union(items, G.paintBounds);
    // Keep the content clear of the floating chrome.
    const stage = stageRef.current.getBoundingClientRect();
    const bar = rootRef.current.querySelector(".wb-toolbar")?.getBoundingClientRect();
    const gap = w < 720 ? 16 : 24;
    const inset = { l: gap, r: gap, t: 64, b: 64 };
    if (bar && bar.width) {
      if (bar.height > bar.width) inset.l = Math.max(inset.l, bar.right - stage.left + gap);
      else inset.b = Math.max(inset.b, stage.bottom - bar.top + 56);
    }
    const aw = Math.max(40, w - inset.l - inset.r);
    const ah = Math.max(40, h - inset.t - inset.b);
    const z = G.clampZoom(Math.min(aw / Math.max(b.w, 1), ah / Math.max(b.h, 1), 2));
    setView({ x: inset.l + aw / 2 - (b.x + b.w / 2) * z, y: inset.t + ah / 2 - (b.y + b.h / 2) * z, z });
  }

  /* ---------- Export ---------- */
  function exportPng() {
    setMenuOpen(false);
    commitEdit();
    const items = doc.current.items;
    if (!items.length) return;
    const b = G.union(items, G.paintBounds);
    const pad = 32;
    const W = b.w + pad * 2;
    const H = b.h + pad * 2;
    const scale = Math.min(2, 8192 / W, 8192 / H, Math.sqrt(32e6 / (W * H)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(W * scale));
    canvas.height = Math.max(1, Math.ceil(H * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = colorsRef.current.paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, (pad - b.x) * scale, (pad - b.y) * scale);
    for (const it of items) drawItem(ctx, it, false);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "whiteboard.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, "image/png");
  }

  /* ---------- Text editing ---------- */
  function startEdit(id, isNew, before) {
    const it = doc.current.items.find((i) => i.id === id);
    if (!it) return;
    editRef.current = { id, isNew, before: before || doc.current.items, orig: it.text || "" };
    toolRef.current = "select";
    setToolState("select");
    setRove(0);
    selRef.current = [id];
    setSel([id]);
    setEditText(it.text || "");
    setEditing(id);
    updateCursor();
    requestPaint();
  }
  function onEditChange(value) {
    const ed = editRef.current;
    if (!ed) return;
    setEditText(value);
    doc.current.items = doc.current.items.map((i) => (i.id === ed.id ? { ...i, text: value } : i));
    requestPaint();
  }
  function commitEdit() {
    const ed = editRef.current;
    if (!ed) return;
    editRef.current = null;
    setEditing(null);
    const items = doc.current.items;
    const it = items.find((i) => i.id === ed.id);
    if (!it) { requestPaint(); return; }
    const text = (it.text || "").replace(/\s+$/, "");
    let next = items.map((i) => (i.id === ed.id ? { ...i, text } : i));
    if (it.type === "text" && !text.trim()) {
      next = next.filter((i) => i.id !== ed.id);
      selRef.current = selRef.current.filter((id) => id !== ed.id);
      setSel(selRef.current);
      if (ed.isNew) { doc.current.items = next; requestPaint(); bump(); }
      else apply(next, ed.before);
      return;
    }
    if (ed.isNew || text !== ed.orig) apply(next, ed.before);
    else { doc.current.items = next; requestPaint(); }
  }

  /* ---------- Pointer input ---------- */
  function local(e) {
    const r = canvasRef.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  function toWorld(sp) {
    const v = viewRef.current;
    return [(sp[0] - v.x) / v.z, (sp[1] - v.y) / v.z];
  }
  function updateCursor() {
    const c = canvasRef.current;
    if (!c) return;
    const t = toolRef.current;
    const d = drag.current;
    let cur;
    if (d && d.kind === "pan") cur = "grabbing";
    else if (spaceRef.current || t === "hand") cur = "grab";
    else if (t === "select") cur = d && d.kind === "move" ? "move" : d && d.kind === "resize" ? G.HANDLE_CURSOR[d.handle] : hoverCursor.current;
    else if (t === "text") cur = "text";
    else if (t === "eraser") cur = "none";
    else cur = "crosshair";
    if (c.style.cursor !== cur) c.style.cursor = cur;
  }
  function handleAt(sp, it, touch) {
    const r = touch ? 16 : 8;
    const v = viewRef.current;
    if (G.isLine(it)) {
      const ends = [it.points[0], it.points[it.points.length - 1]];
      for (let i = 0; i < 2; i++) {
        const x = ends[i][0] * v.z + v.x;
        const y = ends[i][1] * v.z + v.y;
        if (Math.abs(sp[0] - x) <= r && Math.abs(sp[1] - y) <= r) return i ? "p1" : "p0";
      }
      return null;
    }
    const hp = G.handlePoints(selectionBox([it], v));
    for (const key of G.HANDLES) {
      if (Math.abs(sp[0] - hp[key][0]) <= r && Math.abs(sp[1] - hp[key][1]) <= r) return key;
    }
    return null;
  }
  function hoverUpdate(sp) {
    if (toolRef.current !== "select") return;
    let cur = "default";
    const sels = selectedItems();
    const h = sels.length === 1 ? handleAt(sp, sels[0], false) : null;
    if (h) cur = G.HANDLE_CURSOR[h];
    else {
      const w = toWorld(sp);
      const it = G.topHit(doc.current.items, w[0], w[1], 4 / viewRef.current.z);
      if (it) cur = "move";
    }
    hoverCursor.current = cur;
    updateCursor();
  }

  function abortDrag() {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.before) doc.current.items = d.before;
    if (d.kind === "marquee") setSelection(d.base);
    requestPaint();
    updateCursor();
  }

  function onPointerDown(e) {
    const sp = local(e);
    pointers.current.set(e.pointerId, sp);
    if (e.pointerType === "touch" && pointers.current.size === 2) {
      abortDrag();
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v0: { ...viewRef.current } };
      return;
    }
    if (pinch.current || pointers.current.size > 1) return;
    if (editRef.current) {
      commitEdit();
      rootRef.current?.focus({ preventScroll: true });
      return;
    }
    if (dialogRef.current.menu) setMenuOpen(false);
    rootRef.current?.focus({ preventScroll: true });
    try { canvasRef.current.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }

    const t = toolRef.current;
    if (e.button === 1 || (e.button === 0 && (spaceRef.current || t === "hand"))) {
      e.preventDefault();
      drag.current = { kind: "pan", sx: sp[0], sy: sp[1], v: { ...viewRef.current } };
      updateCursor();
      return;
    }
    if (e.button !== 0) return;
    const w = toWorld(sp);
    const z = viewRef.current.z;
    const items = doc.current.items;
    const tol = (e.pointerType === "touch" ? 10 : 4) / z;

    if (t === "select") { selectDown(e, sp, w, tol); return; }
    if (t === "pen" || t === "highlighter") {
      const pr = prefsRef.current[t];
      const pt = e.pointerType === "pen" ? [r1(w[0]), r1(w[1]), Math.round((e.pressure || 0.5) * 100) / 100] : [r1(w[0]), r1(w[1])];
      const item = { id: uid(), type: t, color: pr.color, sw: pr.width, points: [pt] };
      drag.current = { kind: "draw", before: items, item, pen: e.pointerType === "pen" };
      doc.current.items = [...items, item];
      requestPaint();
      return;
    }
    if (t === "eraser") {
      drag.current = { kind: "erase", before: items, last: w };
      eraseAlong(w, w);
      return;
    }
    if (t === "rect" || t === "ellipse" || t === "arrow" || t === "line") {
      const pr = prefsRef.current.shape;
      const base = { id: uid(), type: t, color: pr.color, sw: pr.width };
      const item = G.isLine(base)
        ? { ...base, points: [[r1(w[0]), r1(w[1])], [r1(w[0]), r1(w[1])]] }
        : { ...base, fill: !!pr.fill, x: r1(w[0]), y: r1(w[1]), w: 0, h: 0 };
      drag.current = { kind: "shape", before: items, item, start: w, sp };
      doc.current.items = [...items, item];
      requestPaint();
      return;
    }
    if (t === "text") {
      const hit = G.topHit(items, w[0], w[1], tol);
      if (hit && hit.type === "text") { startEdit(hit.id, false); return; }
      const pr = prefsRef.current.text;
      const fs = TEXT_SIZE[pr.size] || TEXT_SIZE.m;
      const item = { id: uid(), type: "text", x: r1(w[0]), y: r1(w[1] - (fs * G.LINE_HEIGHT) / 2), w: null, fs, color: pr.color, text: "" };
      doc.current.items = [...items, item];
      startEdit(item.id, true, items);
      return;
    }
    if (t === "note") {
      const item = { id: uid(), type: "note", x: r1(w[0] - NOTE_SIZE / 2), y: r1(w[1] - NOTE_SIZE / 2), w: NOTE_SIZE, h: NOTE_SIZE, bg: prefsRef.current.note.bg, text: "" };
      doc.current.items = [...items, item];
      startEdit(item.id, true, items);
    }
  }

  function selectDown(e, sp, w, tol) {
    const items = doc.current.items;
    const sels = selectedItems();
    if (sels.length === 1) {
      const h = handleAt(sp, sels[0], e.pointerType === "touch");
      if (h) {
        const it = sels[0];
        if (h === "p0" || h === "p1") {
          drag.current = { kind: "endpoint", before: items, id: it.id, idx: h === "p0" ? 0 : it.points.length - 1, handle: h };
        } else {
          const b0 = G.bounds(it);
          const edge = G.handlePoints(b0)[h];
          drag.current = { kind: "resize", before: items, id: it.id, orig: it, b0, handle: h, off: [edge[0] - w[0], edge[1] - w[1]] };
        }
        updateCursor();
        return;
      }
    }
    const it = G.topHit(items, w[0], w[1], tol);
    const now = performance.now();
    const lt = lastTap.current;
    if (it && (it.type === "text" || it.type === "note") && lt && lt.id === it.id && now - lt.t < 450 && Math.hypot(sp[0] - lt.x, sp[1] - lt.y) < 10) {
      lastTap.current = null;
      startEdit(it.id, false);
      return;
    }
    lastTap.current = it ? { id: it.id, t: now, x: sp[0], y: sp[1] } : null;
    if (it) {
      let ids = selRef.current;
      let toggleOff = null;
      if (e.shiftKey) {
        if (ids.includes(it.id)) toggleOff = it.id;
        else ids = [...ids, it.id];
      } else if (!ids.includes(it.id)) ids = [it.id];
      setSelection(ids);
      drag.current = { kind: "move", before: items, start: w, sp, ids: new Set(ids), moved: false, toggleOff };
      return;
    }
    if (sels.length > 1 && !e.shiftKey) {
      const b = selectionBox(sels, viewRef.current);
      if (sp[0] >= b.x && sp[0] <= b.x + b.w && sp[1] >= b.y && sp[1] <= b.y + b.h) {
        drag.current = { kind: "move", before: items, start: w, sp, ids: new Set(selRef.current), moved: false, toggleOff: null };
        return;
      }
    }
    const base = e.shiftKey ? selRef.current : [];
    if (!e.shiftKey) setSelection([]);
    drag.current = { kind: "marquee", start: w, cur: w, base };
  }

  function eraseAlong(a, b) {
    const z = viewRef.current.z;
    const tol = eraseR() / z;
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(dist / (tol / 2)));
    const items = doc.current.items;
    const gone = new Set();
    for (let s = 0; s <= steps; s++) {
      const x = a[0] + ((b[0] - a[0]) * s) / steps;
      const y = a[1] + ((b[1] - a[1]) * s) / steps;
      for (const it of items) if (!gone.has(it.id) && G.hitItem(it, x, y, tol, true)) gone.add(it.id);
    }
    if (gone.size) {
      doc.current.items = items.filter((i) => !gone.has(i.id));
      requestPaint();
    }
  }

  function onPointerMove(e) {
    const sp = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, sp);
    if (pinch.current) {
      if (pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const p = pinch.current;
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const z = G.clampZoom((p.v0.z * d) / p.d0);
        const wx = (p.m0[0] - p.v0.x) / p.v0.z;
        const wy = (p.m0[1] - p.v0.y) / p.v0.z;
        setView({ x: m[0] - wx * z, y: m[1] - wy * z, z });
      }
      return;
    }
    hoverPt.current = e.pointerType === "touch" ? null : sp;
    const d = drag.current;
    if (!d) {
      if (toolRef.current === "eraser") requestPaint();
      if (e.pointerType !== "touch") hoverUpdate(sp);
      return;
    }
    const w = toWorld(sp);
    const z = viewRef.current.z;
    if (d.kind === "pan") {
      setView({ x: d.v.x + sp[0] - d.sx, y: d.v.y + sp[1] - d.sy, z: d.v.z });
    } else if (d.kind === "draw") {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const list = evs.length ? evs : [e];
      const r = canvasRef.current.getBoundingClientRect();
      const pts = d.item.points;
      for (const ev of list) {
        const p = toWorld([ev.clientX - r.left, ev.clientY - r.top]);
        const last = pts[pts.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1 / z) continue;
        pts.push(d.pen ? [r1(p[0]), r1(p[1]), Math.round((ev.pressure || 0.5) * 100) / 100] : [r1(p[0]), r1(p[1])]);
      }
      G.forget(d.item);
      requestPaint();
    } else if (d.kind === "erase") {
      eraseAlong(d.last, w);
      d.last = w;
      requestPaint();
    } else if (d.kind === "shape") {
      const items = doc.current.items;
      const [x0, y0] = d.start;
      let [x1, y1] = w;
      let item;
      if (G.isLine(d.item)) {
        if (e.shiftKey) [x1, y1] = G.snapAngle(x0, y0, x1, y1);
        item = { ...d.item, points: [[r1(x0), r1(y0)], [r1(x1), r1(y1)]] };
      } else {
        if (e.shiftKey) {
          const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
          x1 = x0 + Math.sign(x1 - x0 || 1) * s;
          y1 = y0 + Math.sign(y1 - y0 || 1) * s;
        }
        const r = e.altKey ? G.normRect(2 * x0 - x1, 2 * y0 - y1, x1, y1) : G.normRect(x0, y0, x1, y1);
        item = { ...d.item, x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) };
      }
      d.item = item;
      items[items.length - 1] = item;
      requestPaint();
    } else if (d.kind === "move") {
      if (!d.moved && Math.hypot(sp[0] - d.sp[0], sp[1] - d.sp[1]) < 3) return;
      d.moved = true;
      let dx = w[0] - d.start[0];
      let dy = w[1] - d.start[1];
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      doc.current.items = d.before.map((it) => (d.ids.has(it.id) ? G.translate(it, dx, dy) : it));
      updateCursor();
      requestPaint();
    } else if (d.kind === "resize") {
      const next = G.resizeItem(d.orig, d.b0, d.handle, w[0] + d.off[0], w[1] + d.off[1], e.shiftKey);
      doc.current.items = d.before.map((it) => (it.id === d.id ? next : it));
      requestPaint();
    } else if (d.kind === "endpoint") {
      doc.current.items = d.before.map((it) => {
        if (it.id !== d.id) return it;
        const pts = it.points.map((p) => p.slice());
        const other = pts[d.idx === 0 ? pts.length - 1 : 0];
        let [x, y] = w;
        if (e.shiftKey) [x, y] = G.snapAngle(other[0], other[1], x, y);
        pts[d.idx] = [r1(x), r1(y)];
        return { ...it, points: pts };
      });
      requestPaint();
    } else if (d.kind === "marquee") {
      d.cur = w;
      const r = G.normRect(d.start[0], d.start[1], w[0], w[1]);
      const ids = new Set(d.base);
      for (const it of doc.current.items) if (G.intersects(G.bounds(it), r)) ids.add(it.id);
      selRef.current = [...ids];
      requestPaint();
    }
  }

  function onPointerUp(e) {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      return;
    }
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const z = viewRef.current.z;
    if (d.kind === "draw") {
      apply(doc.current.items, d.before);
    } else if (d.kind === "erase") {
      if (doc.current.items !== d.before) apply(doc.current.items, d.before);
    } else if (d.kind === "shape") {
      const items = doc.current.items;
      let item = d.item;
      if (G.isLine(item)) {
        const [a, b] = item.points;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) * z < 4) {
          doc.current.items = d.before;
          requestPaint();
          return;
        }
      } else if (item.w * z < 4 && item.h * z < 4) {
        const w = item.type === "ellipse" ? 120 : 160;
        const h = item.type === "ellipse" ? 120 : 100;
        item = { ...item, x: r1(d.start[0] - w / 2), y: r1(d.start[1] - h / 2), w, h };
        items[items.length - 1] = item;
      }
      apply(items, d.before);
    } else if (d.kind === "move") {
      if (d.moved) apply(doc.current.items, d.before);
      else if (d.toggleOff) setSelection(selRef.current.filter((id) => id !== d.toggleOff));
    } else if (d.kind === "resize" || d.kind === "endpoint") {
      if (doc.current.items !== d.before) apply(doc.current.items, d.before);
    } else if (d.kind === "marquee") {
      setSelection(selRef.current);
    }
    updateCursor();
    requestPaint();
  }

  function onPointerLeave() {
    hoverPt.current = null;
    if (toolRef.current === "eraser") requestPaint();
  }

  /* ---------- Keyboard ---------- */
  function onKeyDown(e) {
    const t = e.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if (typing || e.isComposing) return;
    const dlg = dialogRef.current;
    if (dlg.help) {
      if (e.key === "Escape" || e.key === "?") { e.preventDefault(); setHelpOpen(false); }
      return;
    }
    if (dlg.menu) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const onButton = t && (t.tagName === "BUTTON" || t.tagName === "A");
    if (t && t.closest && t.closest("[role=tablist]") && !mod) return;
    const zoomOwned = overRef.current || rootRef.current?.contains(document.activeElement);

    if (mod) {
      if (e.altKey) return;
      if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((key === "z" && e.shiftKey) || (key === "y" && !e.shiftKey)) { e.preventDefault(); redo(); }
      else if (key === "d" && !e.shiftKey) { e.preventDefault(); duplicate(); }
      else if (key === "a" && !e.shiftKey) { e.preventDefault(); selectAll(); }
      else if ((key === "=" || key === "+" || e.code === "NumpadAdd") && zoomOwned) { e.preventDefault(); zoomStep(1); }
      else if ((key === "-" || key === "_" || e.code === "NumpadSubtract") && zoomOwned) { e.preventDefault(); zoomStep(-1); }
      else if ((key === "0" || e.code === "Numpad0") && zoomOwned && !e.shiftKey) { e.preventDefault(); zoomReset(); }
      return;
    }
    if (e.altKey) return;
    if (key === " ") {
      if (onButton) return;
      e.preventDefault();
      if (!e.repeat) { spaceRef.current = true; updateCursor(); requestPaint(); }
      return;
    }
    if (key === "?") { e.preventDefault(); setHelpOpen(true); return; }
    if (e.code === "Digit1" && e.shiftKey) { e.preventDefault(); zoomToFit(); return; }
    if (key === "Escape") {
      if (drag.current) abortDrag();
      else if (selRef.current.length) setSelection([]);
      if (toolRef.current !== "select") setTool("select");
      return;
    }
    if (key === "Delete" || key === "Backspace") {
      if (selRef.current.length) { e.preventDefault(); deleteSelection(); }
      return;
    }
    if (key === "Enter" && !onButton) {
      const sels = selectedItems();
      if (sels.length === 1 && (sels[0].type === "text" || sels[0].type === "note")) { e.preventDefault(); startEdit(sels[0].id, false); }
      return;
    }
    if (key.startsWith("Arrow")) {
      if (t && t.closest && t.closest("[role=toolbar], [role=menu], [role=group]")) return;
      if (!selRef.current.length) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      nudge(key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0, key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0);
      return;
    }
    if (!e.shiftKey && TOOL_BY_KEY[key]) {
      e.preventDefault();
      setTool(TOOL_BY_KEY[key]);
    }
  }
  function onKeyUp(e) {
    if (e.key === " " && spaceRef.current) {
      spaceRef.current = false;
      updateCursor();
      requestPaint();
    }
  }

  function onWheel(e) {
    if (e.target.closest && e.target.closest(".wb-dialog") && !e.ctrlKey) return;
    e.preventDefault();
    const r = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
    if (e.ctrlKey || e.metaKey) {
      const dy = Math.max(-25, Math.min(25, e.deltaY * unit));
      zoomAt(sx, sy, viewRef.current.z * Math.exp(-dy * 0.01));
    } else {
      const v = viewRef.current;
      let dx = e.deltaX * unit;
      let dy = e.deltaY * unit;
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      setView({ x: v.x - dx, y: v.y - dy, z: v.z });
    }
  }

  /* Latest handlers for listeners attached once. */
  const live = useRef(null);
  live.current = { onKeyDown, onKeyUp, onWheel, paint, zoomToFit, flushSave, commitEdit, zoomAt, reloadFromStorage };

  /* ---------- Effects ---------- */
  useEffect(() => {
    const root = rootRef.current;
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    colorsRef.current = {
      sage: v("--sage", "#3d6b52"),
      white: v("--surface-raised", "#ffffff"),
      dot: "rgba(44, 40, 36, 0.2)",
      paper: v("--paper", "#f7f4ee"),
      muted: v("--muted", "#5e574e")
    };
    G.setFont(v("--font-sans", ""));
    if (needsWrite.current) { needsWrite.current = false; live.current.flushSave(); }

    const stage = stageRef.current;
    const canvas = canvasRef.current;
    function resize() {
      const rect = stage.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      if (needFit.current) { needFit.current = false; live.current.zoomToFit(); }
      live.current.paint();
    }
    function place() {
      const top = root.getBoundingClientRect().top + window.scrollY;
      root.style.setProperty("--wb-top", Math.max(0, Math.round(top)) + "px");
    }
    const ro = new ResizeObserver(() => { place(); resize(); });
    ro.observe(stage);
    place();
    resize();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => live.current.paint());

    const kd = (e) => live.current.onKeyDown(e);
    const ku = (e) => live.current.onKeyUp(e);
    const wh = (e) => live.current.onWheel(e);
    const blur = () => { if (spaceRef.current) { spaceRef.current = false; } };
    const enter = () => { overRef.current = true; };
    const leave = () => { overRef.current = false; };
    let gz = 1;
    const gs = (e) => { e.preventDefault(); gz = 1; };
    const gc = (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      live.current.zoomAt(e.clientX - r.left, e.clientY - r.top, viewRef.current.z * (e.scale / gz));
      gz = e.scale;
    };
    const hide = () => live.current.flushSave();
    const replaced = () => live.current.reloadFromStorage();
    window.addEventListener("board:replaced", replaced);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    window.addEventListener("pagehide", hide);
    root.addEventListener("wheel", wh, { passive: false });
    root.addEventListener("pointerenter", enter);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("gesturestart", gs);
    root.addEventListener("gesturechange", gc);
    return () => {
      ro.disconnect();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("board:replaced", replaced);
      root.removeEventListener("wheel", wh);
      root.removeEventListener("pointerenter", enter);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("gesturestart", gs);
      root.removeEventListener("gesturechange", gc);
      cancelAnimationFrame(paintReq.current);
      paintReq.current = 0;
      live.current.commitEdit();
      if (saveTimer.current) live.current.flushSave();
    };
  }, []);

  useLayoutEffect(() => {
    if (!editing) return;
    positionEditor();
    const el = editorRef.current;
    if (el) {
      el.focus({ preventScroll: true });
      const n = el.value.length;
      el.setSelectionRange(n, n);
    }
  }, [editing]);

  useEffect(() => {
    if (!menuOpen) return;
    const first = menuRef.current?.querySelector("[role=menuitem]:not([aria-disabled])");
    first?.focus();
    const away = (e) => {
      if (menuRef.current?.contains(e.target) || menuBtnRef.current?.contains(e.target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [menuOpen]);

  /* ---------- Render ---------- */
  const items = doc.current.items;
  const selSet = new Set(sel);
  const selItems = tool === "select" && sel.length ? items.filter((it) => selSet.has(it.id)) : [];
  let ctl = null;
  if (selItems.length) {
    const c = selItems.find((it) => it.type !== "note");
    const f = selItems.find((it) => it.type === "rect" || it.type === "ellipse");
    const n = selItems.find((it) => it.type === "note");
    const w = selItems.find(hasStroke);
    ctl = {
      color: c ? c.color : undefined,
      size: c ? (c.type === "text" ? sizeFromFs(c.fs) : quickFor(strokeKind(c), G.strokeWidth(c))) : undefined,
      width: w ? G.strokeWidth(w) : undefined,
      fill: f ? !!f.fill : undefined,
      bg: n ? n.bg : undefined,
      selection: true
    };
  } else if (PREF_KEY[tool]) {
    const pk = PREF_KEY[tool];
    const p = prefs[pk];
    ctl = {
      color: p.color,
      size: pk === "text" ? p.size : p.width !== undefined ? quickFor(pk, p.width) : undefined,
      width: p.width,
      fill: pk === "shape" && (tool === "rect" || tool === "ellipse") ? !!p.fill : undefined,
      bg: p.bg
    };
  }
  const canUndo = doc.current.past.length > 0;
  const canRedo = doc.current.future.length > 0;
  const count = items.length;
  const boards = meta.current.boards;
  const active = activeBoard();
  const label = "Whiteboard " + active.name + ", " + (count ? count + (count === 1 ? " item" : " items") : "empty") + (sel.length ? ", " + sel.length + " selected" : "");
  const tipSide = phone ? "top" : "right";
  const editItem = editing ? items.find((i) => i.id === editing) : null;

  function onTabsKey(e) {
    if (e.target.tagName === "INPUT") return;
    const i = boards.findIndex((b) => b.id === active.id);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % boards.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + boards.length) % boards.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = boards.length - 1;
    else if (e.key === "F2") { e.preventDefault(); setRenaming(active.id); return; }
    else if (e.key === "Delete" && boards.length > 1) { e.preventDefault(); deleteBoard(active.id); return; }
    else return;
    e.preventDefault();
    const id = boards[next].id;
    switchBoard(id);
    requestAnimationFrame(() => document.getElementById("wb-tab-" + id)?.focus());
  }
  function onToolbarKey(e) {
    const n = TOOL_LIST.length + 2;
    let i = rove;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") i = (rove + 1) % n;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") i = (rove - 1 + n) % n;
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = n - 1;
    else return;
    e.preventDefault();
    setRove(i);
    toolBtns.current[i]?.focus();
  }
  function onMenuKey(e) {
    const list = [...menuRef.current.querySelectorAll("[role=menuitem]:not([aria-disabled])")];
    const i = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      setMenuOpen(false);
      if (e.key === "Escape") menuBtnRef.current?.focus();
    }
  }

  return (
    <section className={"wb" + (phone ? " is-phone" : "")} ref={rootRef} tabIndex={-1} aria-label="Whiteboard">
      <div className="wb-tabs">
        <div className="wb-tablist" role="tablist" aria-label="Boards" onKeyDown={onTabsKey}>
          {boards.map((b) =>
            renaming === b.id ? (
              <input
                key={b.id}
                className="wb-tab-input"
                defaultValue={b.name}
                maxLength={40}
                aria-label="Board name"
                autoFocus
                onFocus={(e) => e.target.select()}
                onBlur={(e) => renameBoard(b.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); e.target.blur(); }
                  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setRenaming(null); }
                }}
              />
            ) : (
              <button
                key={b.id}
                type="button"
                role="tab"
                id={"wb-tab-" + b.id}
                className="wb-tab"
                aria-selected={b.id === active.id}
                aria-controls="wb-panel"
                tabIndex={b.id === active.id ? 0 : -1}
                title={b.name}
                onClick={() => switchBoard(b.id)}
                onDoubleClick={() => setRenaming(b.id)}
              >
                {b.name}
              </button>
            )
          )}
        </div>
        <IconButton
          icon="plus"
          label={boards.length >= BOARD_LIMIT ? "Up to " + BOARD_LIMIT + " boards" : "New board"}
          side="bottom"
          className="wb-tab-add"
          disabled={boards.length >= BOARD_LIMIT}
          onClick={() => boards.length < BOARD_LIMIT && addBoard()}
        />
        <div className="wb-menu-wrap">
          <IconButton
            btnRef={menuBtnRef}
            icon="more"
            label="Board menu"
            side="bottom-end"
            className="wb-menu-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls="wb-menu"
            onClick={() => { commitEdit(); setMenuOpen((o) => !o); }}
          />
          {menuOpen && (
          <div className="wb-menu" id="wb-menu" role="menu" aria-label="Board" ref={menuRef} onKeyDown={onMenuKey}>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setRenaming(active.id); }}>
              <Icon name="text" /><span>Rename board</span><kbd>F2</kbd>
            </button>
            <button type="button" role="menuitem" aria-disabled={boards.length >= BOARD_LIMIT || undefined} onClick={() => boards.length < BOARD_LIMIT && addBoard()}>
              <Icon name="plus" /><span>New board</span>
            </button>
            <span className="wb-menu-sep" role="separator" />
            <button type="button" role="menuitem" aria-disabled={!count || undefined} onClick={() => count && exportPng()}>
              <Icon name="download" /><span>Export as PNG</span>
            </button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); zoomToFit(); }}>
              <Icon name="fit" /><span>Zoom to fit</span><kbd>Shift 1</kbd>
            </button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setHelpOpen(true); }}>
              <Icon name="keyboard" /><span>Keyboard shortcuts</span><kbd>?</kbd>
            </button>
            <span className="wb-menu-sep" role="separator" />
            <button type="button" role="menuitem" className="is-danger" aria-disabled={!count || undefined} onClick={() => count && clearBoard()}>
              <Icon name="clear" /><span>Clear board</span>
            </button>
            <button type="button" role="menuitem" className="is-danger" aria-disabled={boards.length <= 1 || undefined} onClick={() => boards.length > 1 && deleteBoard(active.id)}>
              <Icon name="trash" /><span>Delete board</span>
            </button>
          </div>
          )}
        </div>
      </div>
      <div className="wb-body" id="wb-panel" role="tabpanel" aria-labelledby={"wb-tab-" + active.id}>
      <div className="wb-stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          className="wb-canvas"
          role="img"
          aria-label={label}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          onMouseDown={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
        />
        {editItem && (
          <textarea
            ref={editorRef}
            className={"wb-editor" + (editItem.type === "note" ? " is-note" : editItem.w != null ? " is-wrapped" : "")}
            value={editText}
            aria-label={editItem.type === "note" ? "Sticky note text" : "Text"}
            spellCheck
            rows={1}
            onChange={(e) => onEditChange(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
                e.preventDefault();
                e.stopPropagation();
                commitEdit();
                rootRef.current?.focus({ preventScroll: true });
              }
            }}
          />
        )}
      </div>

      <div
        className="wb-toolbar wb-float"
        role="toolbar"
        aria-label="Tools"
        aria-orientation={phone ? "horizontal" : "vertical"}
        onKeyDown={onToolbarKey}
      >
        {(() => {
          let i = -1;
          return TOOLS.map((t, k) => {
            if (!t) return <span key={"s" + k} className="wb-sep" role="separator" />;
            i += 1;
            const idx = i;
            return (
              <IconButton
                key={t.id}
                btnRef={(el) => { toolBtns.current[idx] = el; }}
                icon={t.id}
                label={t.label}
                keys={[t.key]}
                ariaKeys={t.key}
                side={tipSide}
                aria-pressed={tool === t.id}
                tabIndex={rove === idx ? 0 : -1}
                onFocus={() => setRove(idx)}
                onClick={() => setTool(t.id)}
              />
            );
          });
        })()}
        <span className="wb-sep" role="separator" />
        <IconButton
          btnRef={(el) => { toolBtns.current[TOOL_LIST.length] = el; }}
          icon="undo"
          label="Undo"
          keys={[MOD, "Z"]}
          ariaKeys={MOD_ARIA + "+Z"}
          side={tipSide}
          disabled={!canUndo}
          tabIndex={rove === TOOL_LIST.length ? 0 : -1}
          onFocus={() => setRove(TOOL_LIST.length)}
          onClick={() => canUndo && undo()}
        />
        <IconButton
          btnRef={(el) => { toolBtns.current[TOOL_LIST.length + 1] = el; }}
          icon="redo"
          label="Redo"
          keys={[MOD, "Shift", "Z"]}
          ariaKeys={MOD_ARIA + "+Shift+Z " + MOD_ARIA + "+Y"}
          side={tipSide}
          disabled={!canRedo}
          tabIndex={rove === TOOL_LIST.length + 1 ? 0 : -1}
          onFocus={() => setRove(TOOL_LIST.length + 1)}
          onClick={() => canRedo && redo()}
        />
      </div>

      {ctl && (
        <div className="wb-props wb-float" role="group" aria-label={ctl.selection ? "Selection style" : "Tool style"}>
          {ctl.color !== undefined && (
            <div className="wb-group" role="radiogroup" aria-label="Colour">
              {Object.entries(COLORS).map(([name, c]) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={ctl.color === name}
                  aria-label={c.label}
                  className="wb-swatch"
                  style={{ "--swatch": c.hex }}
                  onClick={() => setProp("color", name)}
                >
                  <span className="wb-tip" data-side="bottom" aria-hidden="true">{c.label}</span>
                </button>
              ))}
            </div>
          )}
          {ctl.bg !== undefined && (
            <div className="wb-group" role="radiogroup" aria-label="Note colour">
              {Object.entries(NOTE_BG).map(([name, c]) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={ctl.bg === name}
                  aria-label={c.label}
                  className="wb-swatch is-note"
                  style={{ "--swatch": c.hex }}
                  onClick={() => setProp("bg", name)}
                >
                  <span className="wb-tip" data-side="bottom" aria-hidden="true">{c.label}</span>
                </button>
              ))}
            </div>
          )}
          {ctl.size !== undefined && (
            <>
              <span className="wb-sep" role="separator" />
              <div className="wb-group" role="radiogroup" aria-label={ctl.selection ? "Size" : tool === "text" ? "Text size" : tool === "eraser" ? "Eraser size" : "Stroke width"}>
                {Object.entries(SIZES).map(([k, name]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={ctl.size === k}
                    aria-label={name}
                    className="wb-btn wb-size"
                    onClick={() => setProp("size", k)}
                  >
                    <span className="wb-size-mark" data-size={k} aria-hidden="true" />
                    <span className="wb-tip" data-side="bottom" aria-hidden="true">{name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {ctl.width !== undefined && (
            <label className="wb-width">
              <input
                type="range"
                min={WIDTH_MIN}
                max={WIDTH_MAX}
                step={0.5}
                value={ctl.width}
                aria-label={tool === "eraser" ? "Eraser width" : "Stroke width"}
                aria-valuetext={fmtWidth(ctl.width) + " pixels"}
                onChange={(e) => setProp("width", Number(e.target.value))}
              />
              <output aria-hidden="true">{fmtWidth(ctl.width)}</output>
            </label>
          )}
          {ctl.fill !== undefined && (
            <>
              <span className="wb-sep" role="separator" />
              <div className="wb-group" role="radiogroup" aria-label="Fill">
                <IconButton icon="fillNone" label="No fill" side="bottom" role="radio" aria-checked={!ctl.fill} onClick={() => setProp("fill", false)} />
                <IconButton icon="fillTint" label="Light fill" side="bottom" role="radio" aria-checked={ctl.fill} onClick={() => setProp("fill", true)} />
              </div>
            </>
          )}
          {ctl.selection && (
            <>
              <span className="wb-sep" role="separator" />
              <IconButton icon="duplicate" label="Duplicate" keys={[MOD, "D"]} ariaKeys={MOD_ARIA + "+D"} side="bottom" onClick={duplicate} />
              <IconButton icon="trash" label="Delete" keys={["Del"]} ariaKeys="Delete" side="bottom" className="is-danger" onClick={deleteSelection} />
            </>
          )}
        </div>
      )}

      <div className="wb-zoom wb-float" role="group" aria-label="Zoom">
        <IconButton icon="minus" label="Zoom out" keys={[MOD, "−"]} ariaKeys={MOD_ARIA + "+-"} side="top" disabled={zoom <= G.ZOOM_MIN + 1e-3} onClick={() => zoomStep(-1)} />
        <button type="button" className="wb-btn wb-zoom-pct" aria-label={"Zoom " + Math.round(zoom * 100) + "%, reset to 100%"} aria-keyshortcuts={MOD_ARIA + "+0"} onClick={zoomReset}>
          {Math.round(zoom * 100)}%
          <Tip label="Reset to 100%" keys={[MOD, "0"]} side="top" />
        </button>
        <IconButton icon="plus" label="Zoom in" keys={[MOD, "+"]} ariaKeys={MOD_ARIA + "+="} side="top" disabled={zoom >= G.ZOOM_MAX - 1e-3} onClick={() => zoomStep(1)} />
        <span className="wb-sep" role="separator" />
        <IconButton icon="fit" label="Zoom to fit" keys={["Shift", "1"]} ariaKeys="Shift+1" side="top-end" onClick={zoomToFit} />
      </div>

      </div>

      {helpOpen && <HelpDialog onClose={() => { setHelpOpen(false); rootRef.current?.focus({ preventScroll: true }); }} />}
    </section>
  );
}

function useDialogFocus(ref, onClose) {
  useEffect(() => {
    const el = ref.current;
    const prev = document.activeElement;
    el?.querySelector("[data-autofocus]")?.focus();
    function key(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
      if (e.key === "Tab") {
        const f = [...el.querySelectorAll("button, [href], [tabindex]:not([tabindex='-1'])")];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    el?.addEventListener("keydown", key);
    return () => {
      el?.removeEventListener("keydown", key);
      if (prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, []);
}

function HelpDialog({ onClose }) {
  const ref = useRef(null);
  useDialogFocus(ref, onClose);
  return (
    <div className="wb-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wb-dialog wb-help" role="dialog" aria-modal="true" aria-labelledby="wb-help-title" ref={ref}>
        <header>
          <h2 id="wb-help-title">Keyboard shortcuts</h2>
          <button type="button" className="wb-btn" aria-label="Close" data-autofocus onClick={onClose}><Icon name="close" /></button>
        </header>
        <div className="wb-help-body">
          {SHORTCUTS.map(([group, rows]) => (
            <section key={group}>
              <h3 className="wb-label">{group}</h3>
              <dl>
                {rows.map(([name, ...combos]) => (
                  <div key={name} className="wb-help-row">
                    <dt>{name}</dt>
                    <dd>
                      {combos.map((combo, i) => (
                        <span key={i} className="wb-combo">
                          {i > 0 && <span className="wb-or">or</span>}
                          {combo.map((k) => <kbd key={k}>{k}</kbd>)}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
