import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  MONTHS, clampedDay, dayByKey, dayIndex, dayMinutes, dayStats, days, fmtDur, fmtMin,
  formatHours, formatStamp, hashForDay, homeNote, level, longDate, monthCells, monthsCovered,
  mustsDone, sessionActive, taskLoggedMs, todayFocusMs, weeks
} from "./model.js";
import { startFromTask, useNow } from "./timer.js";
import { summaryDefs, Seal } from "./Summary.jsx";

/* The Plan screen: overview pane | divider | day board. Behaviour follows the
   design skill: one open day (raised card, sage ring on the calendar), scroll
   sync on the board, date clicks and arrow keys, and on phones a single
   month + single card with a Previous / Today / Next pager. */

const LAYOUT_KEY = "gsoc-study-layout";
const TILES_KEY = "gsoc-study-tiles";
const CAL_MIN = 240;
const TICKET_MIN = 340;
const SPLIT_W = 48; // handle plus --pane-gutter on each side
const PHONE = "(max-width: 719px)";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isPhone = () => window.matchMedia(PHONE).matches;

function usePhone() {
  const [phone, setPhone] = useState(isPhone);
  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const onChange = () => setPhone(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return phone;
}

function keyFromHash() {
  const match = (location.hash || "").match(/^#\/day\/(\d{4}-\d{2}-\d{2})/);
  return match && dayByKey.has(match[1]) ? match[1] : null;
}

function taskHit(task, block, q) {
  return (block.name + " " + task.text + " " + (task.how || "")).toLowerCase().includes(q);
}

function Plan({ state, update, today }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const deskRef = useRef(null);
  const phone = usePhone();
  const [active, setActive] = useState(() => keyFromHash() || clampedDay().key);
  const activeRef = useRef(active);
  activeRef.current = active;
  const pending = useRef({ key: null, timer: 0 });

  const markActive = useCallback((key) => {
    setActive(key);
    const next = hashForDay(key);
    if (location.hash !== next) history.replaceState(null, "", next);
    document.title = (key === clampedDay().key ? "Today" : "Day") + " · GSoC-ready";
  }, []);

  const openDay = useCallback((key, behavior = "smooth") => {
    if (!dayByKey.has(key)) return;
    markActive(key);
    requestAnimationFrame(() => {
      const card = document.getElementById("card-" + key);
      if (!card) return;
      // Phones page one day at a time: no travel, only bring the card's top
      // back into view if the reader had scrolled past it.
      if (isPhone()) {
        if (card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: "start" });
        return;
      }
      const smooth = behavior === "smooth" && !reducedMotion();
      // Hold the highlight on the chosen day while the page travels to it,
      // so rows passed on the way don't take it over.
      clearTimeout(pending.current.timer);
      pending.current.key = key;
      pending.current.timer = setTimeout(() => { pending.current.key = null; }, smooth ? 1200 : 150);
      card.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    });
  }, [markActive]);

  const shiftDay = useCallback((delta) => {
    const next = days[dayIndex.get(activeRef.current) + delta];
    if (next) openDay(next.key, "smooth");
  }, [openDay]);

  // Open the right day on arrival.
  useEffect(() => { openDay(activeRef.current, "auto"); }, [openDay]);

  // Links into the plan (#/day/…, #/today) and "Open day" from the stats sheet.
  useEffect(() => {
    const onHash = () => {
      if (location.hash === "#/today" || location.hash === "#/plan") openDay(clampedDay().key, "smooth");
      else { const key = keyFromHash(); if (key) openDay(key, "smooth"); }
    };
    const onOpen = (event) => openDay(event.detail, "smooth");
    window.addEventListener("hashchange", onHash);
    window.addEventListener("plan:open-day", onOpen);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("plan:open-day", onOpen);
    };
  }, [openDay]);

  // Scrolling the cards moves the highlight to the row at the reading line.
  // Inside that row the open day keeps it; otherwise the first day does.
  useEffect(() => {
    if (phone) return undefined;
    let queued = false;
    function sync() {
      queued = false;
      const cards = [...document.querySelectorAll(".day-board .day-card")];
      if (!cards.length) return;
      const line = (parseFloat(getComputedStyle(cards[0]).scrollMarginTop) || 0) + 48;
      const tops = cards.map((card) => card.getBoundingClientRect().top);
      let rowTop = -Infinity;
      for (const top of tops) if (top <= line && top > rowTop) rowTop = top;
      const target = rowTop === -Infinity ? tops[0] : rowTop;
      const keys = cards.filter((card, i) => Math.abs(tops[i] - target) < 2).map((card) => card.dataset.key);
      if (pending.current.key) {
        if (keys.includes(pending.current.key)) pending.current.key = null;
        return;
      }
      if (keys.includes(activeRef.current)) return;
      markActive(keys[0]);
    }
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(sync);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [phone, markActive]);

  // Arrow keys move between days.
  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.target.closest && event.target.closest("input, textarea, select, [contenteditable], .split, .tile-bar, dialog")) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); shiftDay(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); shiftDay(1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shiftDay]);

  // Keep the open day's calendar cell visible inside the overview pane.
  useEffect(() => {
    if (phone) return;
    const pane = deskRef.current && deskRef.current.querySelector(".cal-pane");
    const cell = pane && pane.querySelector('[data-day="' + active + '"]');
    if (!cell) return;
    const p = pane.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    if (c.top < p.top + 10) pane.scrollTop -= p.top + 10 - c.top;
    else if (c.bottom > p.bottom - 10) pane.scrollTop += c.bottom - (p.bottom - 10);
  }, [active, phone]);

  return (
    <div className={"desk" + (q ? " is-searching" : "")} ref={deskRef}>
      <Overview state={state} update={update} active={active} today={today} openDay={openDay} />
      <Split deskRef={deskRef} />
      <div className="day-pane">
        <form className="task-find" role="search" onSubmit={(event) => event.preventDefault()}>
          <input type="search" placeholder="Search tasks" aria-label="Search tasks" value={query} onChange={(event) => setQuery(event.target.value)} />
        </form>
        <div className="day-board">
          {days.map((day) => (
            <DayCard key={day.key} day={day} state={state} update={update} current={day.key === active} today={today} query={q} />
          ))}
        </div>
        {q && !days.some((day) => day.blocks.some((block) => block.tasks.some((task) => taskHit(task, block, q)))) ? <p className="quiet task-miss">No matching tasks.</p> : null}
        <Pager active={active} onStep={shiftDay} onToday={() => openDay(clampedDay().key, "smooth")} />
      </div>
    </div>
  );
}

export default memo(Plan);

/* ---------- Overview pane: header, editable tiles, months, key ---------- */

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
  for (const id of config.order) if (byId.has(id) && !seen.has(id)) { list.push(byId.get(id)); seen.add(id); }
  for (const def of defs) if (!seen.has(def.id)) list.push(def);
  return list;
}

function Overview({ state, update, active, today, openDay }) {
  const [config, setConfig] = useState(loadTiles);
  const [editing, setEditing] = useState(false);
  const defs = [
    ...summaryDefs({ state, update, openDay }),
    ...monthsCovered().map((g) => ({
      id: "month-" + g.y + "-" + g.m,
      name: MONTHS[g.m],
      half: false,
      month: g,
      build: () => <Month y={g.y} m={g.m} state={state} active={active} today={today} onOpen={openDay} />
    }))
  ];
  const list = orderedTiles(defs, config);
  const visible = list.filter((def) => !config.hidden.includes(def.id));
  const hidden = list.filter((def) => config.hidden.includes(def.id));
  const change = (fn) => setConfig((prev) => {
    const next = fn({ order: [...prev.order], hidden: [...prev.hidden], size: { ...prev.size } });
    saveTiles(next);
    return next;
  });
  // Puts tile `id` right before `targetId` (or right after), or at the start
  // or end of its group when targetId is null.
  const move = (id, targetId, before) => change((c) => {
    const all = orderedTiles(defs, c).map((def) => def.id);
    const ids = all.filter((x) => x !== id);
    let at = targetId ? ids.indexOf(targetId) : -1;
    if (targetId && at < 0) return c;
    if (!targetId) {
      const isMonth = (x) => x.startsWith("month-");
      const peers = ids.filter((x) => isMonth(x) === isMonth(id));
      at = before ? ids.indexOf(peers[0]) : ids.indexOf(peers[peers.length - 1]);
      if (at < 0) return c;
    }
    ids.splice(before ? at : at + 1, 0, id);
    c.order = ids;
    return c;
  });
  const activeMonth = (() => { const d = dayByKey.get(active); return d ? "month-" + d.y + "-" + d.m : ""; })();

  // Pointer drag: the tile floats under the pointer (fixed position) and a
  // dashed gap marks where it will land among the other tiles of its group.
  const [drag, setDrag] = useState(null);
  const startDrag = (def, event, tile) => {
    const box = tile.getBoundingClientRect();
    const grid = tile.parentElement;
    const others = [...grid.querySelectorAll(":scope > .tile")].filter((node) => node !== tile).map((node) => node.dataset.tile);
    const start = [...grid.querySelectorAll(":scope > .tile")].indexOf(tile);
    const state0 = { id: def.id, dx: event.clientX - box.left, dy: event.clientY - box.top, left: box.left, top: box.top, width: box.width, height: box.height, gap: start, others };
    setDrag(state0);
    let current = state0;
    const moveTo = (e) => {
      const pane = grid.closest(".cal-pane");
      if (pane) {
        const r = pane.getBoundingClientRect();
        if (e.clientY < r.top + 48) pane.scrollTop -= 14;
        else if (e.clientY > r.bottom - 48) pane.scrollTop += 14;
      }
      let gap = current.gap;
      const hit = document.elementsFromPoint(e.clientX, e.clientY)
        .map((node) => node.closest && node.closest(".tile"))
        .find((node) => node && node !== tile && node.parentElement === grid);
      if (hit) {
        const r = hit.getBoundingClientRect();
        const gapNode = grid.querySelector(":scope > .tile-gap");
        const g = gapNode ? gapNode.getBoundingClientRect() : r;
        const sameRow = Math.abs(g.top - r.top) < Math.min(r.height, g.height) * 0.5;
        const before = sameRow ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
        const at = current.others.indexOf(hit.dataset.tile);
        if (at >= 0) gap = before ? at : at + 1;
      }
      current = { ...current, left: e.clientX - current.dx, top: e.clientY - current.dy, gap };
      setDrag(current);
    };
    const end = () => {
      window.removeEventListener("pointermove", moveTo);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      const { others, gap } = current;
      if (others.length) {
        if (gap >= others.length) move(def.id, others[others.length - 1], false);
        else move(def.id, others[gap], true);
      }
      setDrag(null);
      requestAnimationFrame(() => tile.querySelector(".grip")?.focus());
    };
    window.addEventListener("pointermove", moveTo);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const group = (name, items) => {
    const children = [];
    const inGroup = drag && items.some((def) => def.id === drag.id);
    let k = 0;
    for (const def of items) {
      if (inGroup && def.id !== drag.id && k === drag.gap) children.push(<div key="gap" className="tile-gap" style={{ width: drag.width, height: drag.height }} />);
      if (!inGroup || def.id !== drag.id) k += 1;
      const dragging = inGroup && def.id === drag.id;
      children.push(
        <Tile
          key={def.id}
          def={def}
          editing={editing}
          half={def.half && config.size[def.id] === "half"}
          extra={def.id === activeMonth ? " has-active" : ""}
          dragging={dragging}
          dragStyle={dragging ? { left: drag.left, top: drag.top, width: drag.width } : undefined}
          onDragStart={startDrag}
          onHalf={() => change((c) => { if (c.size[def.id]) delete c.size[def.id]; else c.size[def.id] = "half"; return c; })}
          onHide={() => change((c) => { if (!c.hidden.includes(def.id)) c.hidden.push(def.id); return c; })}
          onMove={move}
        />
      );
    }
    if (inGroup && drag.gap >= drag.others.length) children.push(<div key="gap" className="tile-gap" style={{ width: drag.width, height: drag.height }} />);
    return <div className={"tiles tiles-" + name + (editing ? " is-editing" : "")} data-group={name}>{children}</div>;
  };

  return (
    <aside className="cal-pane">
      <div className="cal-head">
        <h2 className="pane-title">Overview</h2>
        <div className="cal-actions">
          <button type="button" className="btn btn-ghost mini" onClick={() => openDay(clampedDay().key, "smooth")}>Today</button>
          <button type="button" className={"btn mini " + (editing ? "btn-primary" : "btn-ghost")} aria-pressed={editing} onClick={() => setEditing((v) => !v)}>
            {editing ? "Done" : "Edit"}
          </button>
        </div>
      </div>
      {group("summary", visible.filter((def) => !def.month))}
      {group("months", visible.filter((def) => def.month))}
      {editing ? (
        <>
          <p className="quiet tile-help">Drag a tile by its handle to move it. Hidden tiles come back from here.</p>
          {hidden.length ? (
            <div className="hidden-tiles">
              <span>Hidden:</span>
              {hidden.map((def) => (
                <button key={def.id} type="button" className="text-btn" onClick={() => change((c) => { c.hidden = c.hidden.filter((id) => id !== def.id); return c; })}>
                  Show {def.name}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              try { localStorage.removeItem(TILES_KEY); } catch (e) { /* ignore */ }
              setConfig(loadTiles());
            }}
          >
            Reset layout
          </button>
        </>
      ) : null}
      <p className="legend cal-legend">
        <span><i className="swatch" style={{ background: "var(--level-0)" }} />Not started</span>
        <span><i className="swatch" style={{ background: "var(--level-4)" }} />All done</span>
        <span><i className="swatch is-today" />Today</span>
        <span><i className="px-flag" />Hackathon</span>
        <span>★ Key tasks done</span>
      </p>
    </aside>
  );
}

function Tile({ def, editing, half, extra, dragging, dragStyle, onDragStart, onHalf, onHide, onMove }) {
  const ref = useRef(null);

  function down(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    onDragStart(def, event, ref.current);
  }

  // Arrow keys move the tile to its nearest neighbour in that direction
  // (rows for left/right, columns for up/down); Home and End jump to the ends.
  function key(event) {
    const k = event.key;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(k)) return;
    event.preventDefault();
    const tile = ref.current;
    const refocus = () => requestAnimationFrame(() => tile.querySelector(".grip")?.focus());
    if (k === "Home" || k === "End") { onMove(def.id, null, k === "Home"); refocus(); return; }
    const mine = tile.getBoundingClientRect();
    const cx = mine.left + mine.width / 2;
    const cy = mine.top + mine.height / 2;
    const siblings = [...tile.parentElement.querySelectorAll(":scope > .tile")];
    let best = null;
    let score = Infinity;
    for (const other of siblings) {
      if (other === tile) continue;
      const r = other.getBoundingClientRect();
      const dx = r.left + r.width / 2 - cx;
      const dy = r.top + r.height / 2 - cy;
      const row = Math.abs(dy) < Math.max(mine.height, r.height) * 0.45;
      const ok = k === "ArrowLeft" ? row && dx < -4 : k === "ArrowRight" ? row && dx > 4 : k === "ArrowUp" ? dy < -4 : dy > 4;
      if (!ok) continue;
      const dist = k === "ArrowUp" || k === "ArrowDown" ? dy * dy + dx * dx * 0.15 : dx * dx + dy * dy;
      if (dist < score) { best = other; score = dist; }
    }
    if (!best) {
      const index = siblings.indexOf(tile);
      if ((k === "ArrowLeft" || k === "ArrowUp") && index > 0) best = siblings[index - 1];
      if ((k === "ArrowRight" || k === "ArrowDown") && index < siblings.length - 1) best = siblings[index + 1];
    }
    if (!best) return;
    onMove(def.id, best.dataset.tile, k === "ArrowLeft" || k === "ArrowUp");
    refocus();
  }

  return (
    <section
      ref={ref}
      className={"tile" + (def.month ? " cal-tile" : "") + (half ? " half" : "") + (dragging ? " is-dragging" : "") + extra}
      style={dragStyle}
      data-tile={def.id}
      aria-label={def.name}
    >
      {editing ? (
        <div className="tile-bar">
          <button type="button" className="grip" aria-label={"Move " + def.name} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End" onPointerDown={down} onKeyDown={key}>
            <i aria-hidden="true" />
          </button>
          <span className="tile-name">{def.name}</span>
          {def.half ? <button type="button" className="btn btn-ghost mini" aria-pressed={half} onClick={onHalf}>{half ? "Half" : "Full"}</button> : null}
          <button type="button" className="btn btn-ghost mini" aria-label={"Hide " + def.name} onClick={onHide}>Hide</button>
        </div>
      ) : null}
      {def.build()}
    </section>
  );
}

function dayAria(state, day, stats, today) {
  const bits = [longDate(day), stats.done + " of " + stats.total + " tasks done"];
  if (day.key === today) bits.push("today");
  if (day.type === "hack" && day.name) bits.push(day.name);
  if (mustsDone(state, day)) bits.push("important tasks done");
  return bits.join(", ");
}

function Month({ y, m, state, active, today, onOpen }) {
  return (
    <section className="month" aria-label={MONTHS[m] + " " + y}>
      <h3>{MONTHS[m]}</h3>
      <div className="dows" aria-hidden="true">{["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="cal">
        {monthCells(y, m).map((day, i) => {
          if (!day) return <span key={"b" + i} className="cell blank" aria-hidden="true" />;
          if (day.outside) {
            return (
              <span key={day.key} className={"cell outside" + (day.key === today ? " is-today" : "")} aria-label={MONTHS[m] + " " + day.d + ", outside the plan"}>
                {day.d}
              </span>
            );
          }
          const stats = dayStats(state, day);
          const selected = day.key === active;
          const cls = ["cell", day.type === "hack" && "hack", day.key === today && "is-today", day.key > today && "is-future", selected && "is-selected"].filter(Boolean).join(" ");
          return (
            <button
              key={day.key}
              type="button"
              className={cls}
              data-day={day.key}
              data-level={String(level(stats.done, stats.total))}
              aria-label={dayAria(state, day, stats, today)}
              aria-current={selected ? "date" : undefined}
              onClick={() => onOpen(day.key, "smooth")}
            >
              {day.d}
              {day.type === "hack" ? <span className="hackdot" aria-hidden="true" /> : null}
              {mustsDone(state, day) ? <span className="star" aria-hidden="true">★</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- Divider ---------- */

function savedCalWidth() {
  const n = Number(localStorage.getItem(LAYOUT_KEY));
  return Number.isFinite(n) && n >= CAL_MIN ? n : null;
}

function Split({ deskRef }) {
  const handleRef = useRef(null);
  useEffect(() => {
    const handle = handleRef.current;
    const desk = deskRef.current;
    if (!handle || !desk) return undefined;
    const limits = () => ({ min: CAL_MIN, max: Math.max(CAL_MIN, desk.getBoundingClientRect().width - SPLIT_W - TICKET_MIN) });
    function setWidth(px) {
      const box = limits();
      const next = Math.round(Math.min(box.max, Math.max(box.min, px)));
      desk.style.setProperty("--cal", next + "px");
      handle.setAttribute("aria-valuenow", String(next));
      handle.setAttribute("aria-valuemax", String(Math.round(box.max)));
      return next;
    }
    // Each side keeps its floor; a saved width shrinks to fit a smaller desk.
    function fit() {
      const saved = savedCalWidth();
      if (!saved) { desk.style.removeProperty("--cal"); return; }
      const width = desk.getBoundingClientRect().width;
      desk.style.setProperty("--cal", Math.round(width < 100 ? saved : Math.min(saved, limits().max)) + "px");
    }
    function down(event) {
      if (event.button !== 0 || isPhone()) return;
      event.preventDefault();
      const startX = event.clientX;
      const startW = desk.querySelector(".cal-pane").getBoundingClientRect().width;
      try { handle.setPointerCapture(event.pointerId); } catch (e) { /* plain pointer events */ }
      document.body.classList.add("is-resizing");
      const move = (e) => setWidth(startW + (e.clientX - startX));
      const end = (e) => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        document.body.classList.remove("is-resizing");
        try { localStorage.setItem(LAYOUT_KEY, String(setWidth(startW + (e.clientX - startX)))); } catch (err) { /* keep this visit */ }
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    }
    function key(event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const current = desk.querySelector(".cal-pane").getBoundingClientRect().width;
      const next = setWidth(current + (event.key === "ArrowRight" ? 28 : -28));
      try { localStorage.setItem(LAYOUT_KEY, String(next)); } catch (err) { /* keep this visit */ }
    }
    function reset() {
      desk.style.removeProperty("--cal");
      try { localStorage.removeItem(LAYOUT_KEY); } catch (err) { /* ignore */ }
      handle.removeAttribute("aria-valuenow");
    }
    handle.addEventListener("pointerdown", down);
    handle.addEventListener("keydown", key);
    handle.addEventListener("dblclick", reset);
    const observer = new ResizeObserver(fit);
    observer.observe(desk);
    fit();
    const saved = savedCalWidth();
    if (saved) handle.setAttribute("aria-valuenow", String(saved));
    return () => {
      observer.disconnect();
      handle.removeEventListener("pointerdown", down);
      handle.removeEventListener("keydown", key);
      handle.removeEventListener("dblclick", reset);
    };
  }, [deskRef]);
  return (
    <div
      ref={handleRef}
      className="split"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Drag to resize the calendar. Double-click to reset."
      aria-valuemin={CAL_MIN}
    />
  );
}

/* ---------- Day board ---------- */

function Pager({ active, onStep, onToday }) {
  const i = dayIndex.get(active);
  return (
    <nav className="day-pager" aria-label="Change day">
      <button type="button" className="pager-btn" data-step="-1" aria-label="Previous day" disabled={i <= 0} onClick={() => onStep(-1)}>‹ Previous</button>
      <button type="button" className="pager-btn" data-step="0" aria-label="Go to today" disabled={active === clampedDay().key} onClick={onToday}>Today</button>
      <button type="button" className="pager-btn" data-step="1" aria-label="Next day" disabled={i >= days.length - 1} onClick={() => onStep(1)}>Next ›</button>
    </nav>
  );
}

function DayCard({ day, state, update, current, today, query }) {
  const index = dayIndex.get(day.key);
  const stats = dayStats(state, day);
  const note = homeNote(day);
  const pct = stats.total ? (stats.done / stats.total) * 100 : 0;
  const planned = day.type === "hack" ? "DSA and GSoC are paused today." : fmtMin(dayMinutes(day)) + " planned.";
  const isHome = day.key === clampedDay().key;

  const setNote = (value) => update((draft) => {
    if (value.trim()) { draft.dayNotes[day.key] = value; draft.dayNoteAt[day.key] = Date.now(); }
    else { delete draft.dayNotes[day.key]; delete draft.dayNoteAt[day.key]; }
    return draft;
  });

  const blocks = query
    ? day.blocks.map((block) => ({ ...block, tasks: block.tasks.filter((task) => taskHit(task, block, query)) })).filter((block) => block.tasks.length)
    : day.blocks;
  if (query && !blocks.length) return null;

  return (
    <article className={"day-card" + (current ? " is-current" : "")} id={"card-" + day.key} data-key={day.key}>
      <header className="card-head">
        <h2>{longDate(day)}</h2>
        <p className="meta">Day {index + 1} of {days.length} · Week {day.week + 1}, {weeks[day.week].title} · {planned}</p>
      </header>
      {note ? <p className="home-note">{note}</p> : null}
      <div className="progress-row">
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={stats.total} aria-valuenow={stats.done} aria-label={stats.done + " of " + stats.total + " tasks done"}>
          <div className="bar-fill" style={{ width: pct + "%" }} />
        </div>
        <p className="bar-label">{stats.done} of {stats.total} tasks</p>
      </div>
      {isHome ? <TodayFocus state={state} /> : null}
      <div className="blocks">
        {blocks.map((block, blockIndex) => {
          const minutes = block.tasks.reduce((sum, task) => sum + (task.min || 0), 0);
          return (
            <section className="block" key={blockIndex}>
              <div className="block-head">
                <h3>{block.hack ? <i className="px-flag" aria-hidden="true" /> : null}{block.name}</h3>
                <span className="block-time">{minutes ? fmtMin(minutes) : "All day"}</span>
              </div>
              {block.tasks.map((task) => <Task key={task.id} task={task} state={state} update={update} />)}
            </section>
          );
        })}
      </div>
      <section className="day-note" hidden={!!query}>
        <label htmlFor={"day-note-" + day.key}>Note for this day</label>
        <textarea
          id={"day-note-" + day.key}
          maxLength={4000}
          placeholder="What you learned, or what got stuck."
          value={state.dayNotes[day.key] || ""}
          onChange={(event) => setNote(event.target.value)}
        />
        {state.dayNoteAt[day.key] ? <p className="note-when">{formatStamp(state.dayNoteAt[day.key])}</p> : null}
      </section>
    </article>
  );
}

function TodayFocus({ state }) {
  useNow(1000, state.timer.running);
  const ms = todayFocusMs(state);
  return <p className="today-focus" hidden={ms < 1000}>{ms >= 1000 ? formatHours(ms) + " focused today." : ""}</p>;
}

function Logged({ state, taskId }) {
  useNow(1000, state.timer.running && state.timer.taskId === taskId);
  const ms = taskLoggedMs(state, taskId);
  return <span className="logged" hidden={ms < 1000}>{ms >= 1000 ? fmtDur(ms) + " logged" : ""}</span>;
}

function Task({ task, state, update }) {
  const [open, setOpen] = useState(false);
  const done = !!state.done[task.id];
  const busy = sessionActive(state);
  const mine = busy && state.timer.taskId === task.id;

  const toggle = (checked) => update((draft) => {
    if (checked) { draft.done[task.id] = true; draft.doneAt[task.id] = Date.now(); }
    else { delete draft.done[task.id]; delete draft.doneAt[task.id]; }
    return draft;
  });

  function focus() {
    if (!mine) update((draft) => startFromTask(draft, task.id));
    if (!busy || mine) location.hash = "#/focus";
  }

  return (
    <article className={"task" + (done ? " is-done" : "")}>
      <div className="task-top">
        <input className="tick" type="checkbox" id={task.id} checked={done} onChange={(event) => toggle(event.target.checked)} />
        <div>
          <label className="task-label" htmlFor={task.id}>
            <span className="task-text">{task.text}</span>
            {task.must ? <Seal /> : null}
          </label>
          <div className="subline">
            {task.min ? <span className="mins">{fmtMin(task.min)}</span> : null}
            <Logged state={state} taskId={task.id} />
            <button type="button" className="btn-line" aria-expanded={open} aria-controls={"more-" + task.id} onClick={() => setOpen((v) => !v)}>
              {open ? "Hide" : "Details"}
            </button>
          </div>
        </div>
      </div>
      <div className="task-more" id={"more-" + task.id} hidden={!open}>
        {task.how ? <p>{task.how}</p> : null}
        {task.res && task.res.length ? (
          <ul>{task.res.map((link, i) => <li key={i}><a href={link.u} target="_blank" rel="noopener">{link.l}</a></li>)}</ul>
        ) : null}
        <button type="button" className="btn btn-primary" onClick={focus}>
          {mine ? "Open timer" : busy ? "Timer is running" : "Start focus"}
        </button>
      </div>
    </article>
  );
}
