import { useCallback, useEffect, useRef, useState } from "react";
import {
  KEY, clampedDay, dayByKey, dayIndex, days, hashForDay, loadState, normalize, overall,
  pctText, saveState, shortWhen, todayKey
} from "./model.js";
import { useTimerEngine } from "./timer.js";
import { useReminders } from "./reminders.js";
import { attachSync, scheduleSync } from "./sync.js";
import { Toaster } from "./toast.jsx";
import { BrandMark, Icon } from "./icons.jsx";
import { SummaryStack } from "./Summary.jsx";
import TimerChip from "./TimerChip.jsx";
import Plant from "./Plant.jsx";
import Settings from "./Settings.jsx";
import Plan from "./Plan.jsx";
import Focus from "./Focus.jsx";
import Notes from "./Notes.jsx";
import Board from "./Board.jsx";
import Code from "./Code.jsx";

const RAIL_KEY = "gsoc-study-rail";
const TITLES = { plan: "Today", focus: "Focus", notes: "Notes", board: "Board", code: "Code", missing: "Day" };
const NAV = [
  { id: "plan", href: "#/today", label: "Plan" },
  { id: "focus", href: "#/focus", label: "Focus" },
  { id: "notes", href: "#/notes", label: "Notes" },
  { id: "board", href: "#/board", label: "Board" },
  { id: "code", href: "#/code", label: "Code" }
];

function readRoute() {
  const parts = (location.hash || "").replace(/^#/, "").split("/").filter(Boolean);
  if (parts[0] === "focus" || parts[0] === "notes" || parts[0] === "board" || parts[0] === "code") return parts[0];
  if (parts[0] === "day") return parts[1] && dayByKey.has(parts[1]) ? "plan" : "missing";
  return "plan";
}

/** Re-renders when the calendar day changes (midnight), not every second. */
function useToday() {
  const [today, setToday] = useState(todayKey);
  useEffect(() => {
    const id = setInterval(() => setToday((prev) => (prev === todayKey() ? prev : todayKey())), 15000);
    return () => clearInterval(id);
  }, []);
  return today;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000 - (Date.now() % 1000) + 30);
    return () => clearInterval(id);
  }, [now]);
  return (
    <div className="rail-when">
      <time dateTime={now.toISOString()}>{now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time>
      <span className="rail-date">{now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
    </div>
  );
}

function dayChip(today) {
  const first = days[0];
  const last = days[days.length - 1];
  if (today < first.key) return "Starts " + shortWhen(first);
  if (today > last.key) return "Plan finished";
  const day = clampedDay();
  return "Day " + (dayIndex.get(day.key) + 1) + " of " + days.length + " · Week " + (day.week + 1);
}

/** Opens a day on the Plan screen from anywhere (stats sheet, links). */
export function openDayAnywhere(key) {
  if (readRoute() !== "plan") location.hash = hashForDay(key);
  else window.dispatchEvent(new CustomEvent("plan:open-day", { detail: key }));
}

export default function App() {
  const [state, setState] = useState(loadState);
  const [route, setRoute] = useState(readRoute);
  const [railClosed, setRailClosed] = useState(() => { try { return localStorage.getItem(RAIL_KEY) === "closed"; } catch (e) { return false; } });
  const [saveError, setSaveError] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const today = useToday();
  const stateRef = useRef(state);
  stateRef.current = state;
  const quietSave = useRef(false);
  const sheetRef = useRef(null);

  // Every change goes through update(recipe): the recipe gets a copy, edits
  // it and returns it.
  const update = useCallback((recipe) => setState((prev) => recipe(structuredClone(prev))), []);

  // Save each change and queue a sync, unless it came from sync or another tab.
  useEffect(() => {
    try { saveState(state); setSaveError(false); }
    catch (e) { setSaveError(true); }
    if (quietSave.current) quietSave.current = false;
    else scheduleSync();
  }, [state]);

  useTimerEngine(state, update);
  useReminders(state, update);

  useEffect(() => attachSync({
    getState: () => stateRef.current,
    applyState: (merged) => {
      quietSave.current = true;
      setState((prev) => normalize({ ...prev, ...merged, timer: prev.timer, reminderFired: prev.reminderFired }));
    }
  }), []);

  // Another tab saved, or the page comes back after a while: re-read.
  useEffect(() => {
    const fromStorage = (event) => {
      if (event.key !== KEY || !event.newValue) return;
      try { quietSave.current = true; setState(normalize(JSON.parse(event.newValue))); } catch (e) { /* keep ours */ }
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      try {
        const raw = localStorage.getItem(KEY);
        if (raw && raw !== JSON.stringify(stateRef.current)) { quietSave.current = true; setState(normalize(JSON.parse(raw))); }
      } catch (e) { /* keep ours */ }
    };
    window.addEventListener("storage", fromStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", fromStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (route !== "plan") { document.title = TITLES[route] + " · GSoC-ready"; window.scrollTo(0, 0); }
  }, [route]);

  useEffect(() => {
    if (!location.hash || location.hash === "#") history.replaceState(null, "", "#/today");
  }, []);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (statsOpen && !sheet.open) sheet.showModal();
    if (!statsOpen && sheet.open) sheet.close();
  }, [statsOpen]);

  const toggleRail = () => {
    setRailClosed((closed) => {
      try { localStorage.setItem(RAIL_KEY, closed ? "open" : "closed"); } catch (e) { /* this visit only */ }
      return !closed;
    });
  };

  const restore = useCallback((next) => setState(next), []);
  const openFromSheet = useCallback((key) => { setStatsOpen(false); openDayAnywhere(key); }, []);
  const o = overall(state);
  const nav = route === "missing" ? "" : route;

  return (
    <div className={"app" + (railClosed ? " is-rail-closed" : "")}>
      <a className="skip" href="#main">Skip to content</a>
      <header className="rail">
        <div className="rail-top">
          <div className="rail-title">
            <div className="brand">
              <BrandMark />
              <span className="brand-name"><span>Google</span>Summer of Code</span>
            </div>
            <h1><span className="eyebrow">Two months to</span>GSoC-ready</h1>
            <p className="rail-day">{dayChip(today)}</p>
          </div>
          <button type="button" className="rail-toggle" aria-expanded={!railClosed} aria-controls="section-nav" onClick={toggleRail}>
            <span className="chev" aria-hidden="true" />
            <span className="sr">{railClosed ? "Open sidebar" : "Close sidebar"}</span>
          </button>
        </div>
        <nav id="section-nav" className="tabs" aria-label="Sections">
          {NAV.map((item) => (
            <a key={item.id} href={item.href} data-nav={item.id} aria-current={nav === item.id ? "page" : undefined}>
              <Icon name={item.id} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <Settings state={state} onRestore={restore} />
        <div className="rail-meta">
          <button type="button" className="stats-open" aria-haspopup="dialog" onClick={() => setStatsOpen(true)}>
            <Icon name="stats" />
            <span>{pctText(o.done, o.total)}</span>
            <span className="sr">Progress</span>
          </button>
          <Plant state={state} />
          <TimerChip state={state} />
          <Clock />
        </div>
      </header>
      <div className="workspace">
        <main id="main" tabIndex={-1} className={route === "plan" ? "desk-page" : route + "-page"}>
          {route === "plan" && <Plan state={state} update={update} today={today} />}
          {route === "focus" && <Focus state={state} update={update} />}
          {route === "notes" && <Notes state={state} update={update} />}
          {route === "board" && <Board />}
          {route === "code" && <Code />}
          {route === "missing" && (
            <>
              <h2>That day isn't in the plan</h2>
              <p className="quiet">The plan runs from November 1 to December 31.</p>
              <p><a href="#/today">Back to today</a></p>
            </>
          )}
        </main>
        <p className="save-status">{saveError ? "Couldn't save. Free a little space, then try that again." : "Saved on this device"}</p>
      </div>
      <dialog
        ref={sheetRef}
        className="sheet"
        aria-labelledby="stats-sheet-title"
        onClose={() => setStatsOpen(false)}
        onClick={(event) => { if (event.target === event.currentTarget) setStatsOpen(false); }}
      >
        <div className="sheet-head">
          <h2 id="stats-sheet-title">Progress</h2>
          <button type="button" className="btn btn-ghost mini" onClick={() => setStatsOpen(false)}>Done</button>
        </div>
        <div className="sheet-body">
          {statsOpen ? <SummaryStack state={state} update={update} openDay={openFromSheet} /> : null}
        </div>
      </dialog>
      <Toaster />
    </div>
  );
}
