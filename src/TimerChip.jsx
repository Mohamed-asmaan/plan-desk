import { formatMs } from "./model.js";
import { displayMs, useNow } from "./timer.js";

/** Sidebar chip: time left (or elapsed), hidden with no session. Opens Focus. */
export default function TimerChip({ state }) {
  const timer = state.timer;
  useNow(250, timer.running);
  const visible = timer.running || timer.elapsedMs > 0;
  let text = visible ? formatMs(displayMs(state)) : "Timer";
  if (visible && timer.phase === "break") text += " break";
  else if (visible && !timer.running) text += " paused";
  return (
    <button
      type="button"
      className="timer-chip"
      hidden={!visible}
      aria-label={"Open timer, " + text}
      onClick={() => { if (location.hash !== "#/focus") location.hash = "#/focus"; }}
    >
      {text}
    </button>
  );
}
