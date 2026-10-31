import { MONTHS_SHORT, WEEKDAYS, cappedElapsed, formatMs, fmtDur, hashForDay, pad, sessionActive, taskLoggedMs, taskView } from "./model.js";
import { MAX_REMINDERS, addReminder, removeReminder, setReminderLabel, setReminderTime } from "./reminders.js";
import {
  displayMs, pauseTimer, phaseLabel, resumeTimer, setBreakMin, setFocusMin, setMode,
  skipBreak, startFocus, stopTimer, unlinkTask, unlockAudio, useNow
} from "./timer.js";

function shortWhen(day) {
  return WEEKDAYS[day.weekday].slice(0, 3) + ", " + MONTHS_SHORT[day.m] + " " + day.d;
}

function reminderHelp() {
  const bits = ["These ring only while this page is open."];
  if (!("Notification" in window)) bits.push("This browser can't send notifications, so a reminder will show on this page instead.");
  else if (Notification.permission === "denied") bits.push("Browser notifications are blocked, so a reminder will show on this page instead.");
  return bits.join(" ");
}

function parseTime(value) {
  const [hh, mm] = String(value || "").split(":").map(Number);
  return Number.isInteger(hh) && Number.isInteger(mm) ? [hh, mm] : null;
}

function LengthControl({ label, value, min, max, step, locked, onChange }) {
  return (
    <div>
      <p className="quiet">{label}</p>
      <div className="stepper">
        <button type="button" aria-label={"Shorter " + label.toLowerCase()} disabled={locked || value <= min} onClick={() => onChange(value - step)}>−</button>
        <b>{value} min</b>
        <button type="button" aria-label={"Longer " + label.toLowerCase()} disabled={locked || value >= max} onClick={() => onChange(value + step)}>+</button>
      </div>
    </div>
  );
}

function TimerActions({ timer, run }) {
  const pause = <button type="button" className="btn btn-ghost" onClick={() => run(pauseTimer)}>Pause</button>;
  const resume = <button type="button" className="btn btn-primary" onClick={() => run(resumeTimer)}>Resume</button>;
  if (timer.phase === "break" && (timer.running || timer.sessionId)) {
    return <>{timer.running ? pause : resume}<button type="button" className="btn btn-ghost" onClick={() => run(skipBreak)}>Skip break</button></>;
  }
  const end = <button type="button" className="btn btn-ghost" onClick={() => run(stopTimer)}>End and save</button>;
  if (timer.running) return <>{pause}{end}</>;
  if (timer.elapsedMs > 0 && timer.sessionId) return <>{resume}{end}</>;
  return <button type="button" className="btn btn-primary" onClick={() => run(startFocus)}>Start</button>;
}

function Reminders({ state, update }) {
  async function onAdd(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const time = parseTime(data.get("time"));
    if (!time || state.reminders.length >= MAX_REMINDERS) return;
    unlockAudio();
    if (state.reminders.length === 0 && "Notification" in window && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch (e) { /* in-app reminder still works */ }
    }
    update((draft) => addReminder(draft, time[0], time[1], String(data.get("label") || "")));
    form.reset();
  }

  return (
    <section className="reminders">
      <h3>Reminders</h3>
      <p className="quiet">{reminderHelp()}</p>
      {state.reminders.length ? (
        <ul className="rem-list">
          {state.reminders.map((rem) => (
            <li className="rem-row" key={rem.id}>
              <input
                type="time"
                aria-label="Reminder time"
                defaultValue={pad(rem.hour) + ":" + pad(rem.minute)}
                onChange={(e) => {
                  const time = parseTime(e.target.value);
                  if (time) update((draft) => setReminderTime(draft, rem.id, time[0], time[1]));
                }}
              />
              <input
                type="text"
                aria-label="Reminder label"
                maxLength={80}
                defaultValue={rem.label}
                onChange={(e) => { const v = e.target.value; update((draft) => setReminderLabel(draft, rem.id, v, false)); }}
                onBlur={(e) => {
                  const v = e.target.value.trim() || "Reminder";
                  e.target.value = v;
                  update((draft) => setReminderLabel(draft, rem.id, v, true));
                }}
              />
              <button type="button" className="btn-line" onClick={() => update((draft) => removeReminder(draft, rem.id))}>Remove</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="quiet">Add a time, like when you sit down to study.</p>
      )}
      {state.reminders.length >= MAX_REMINDERS ? (
        <p className="quiet">Five is the limit, so they stay gentle.</p>
      ) : (
        <form className="add-rem" onSubmit={onAdd}>
          <label className="field"><span>Time</span><input type="time" name="time" defaultValue="17:30" required /></label>
          <label className="field"><span>Label</span><input type="text" name="label" maxLength={80} placeholder="Start studying" /></label>
          <button type="submit" className="btn btn-ghost">Add reminder</button>
        </form>
      )}
    </section>
  );
}

/* A ring that fills as the session runs: pomodoro by its length, the
   stopwatch once around per minute. */
function TimerRing({ state, children }) {
  const timer = state.timer;
  const ms = cappedElapsed(state);
  const total = timer.mode === "stopwatch" ? 60000 : timer.durationMs || state.focusMin * 60000;
  const p = timer.mode === "stopwatch" ? (ms % 60000) / 60000 : Math.min(1, ms / total);
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <div className={"timer-ring" + (timer.phase === "break" ? " is-break" : "") + (timer.running ? " is-running" : "")}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="ring-track" cx="50" cy="50" r={r} />
        <circle className="ring-fill" cx="50" cy="50" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - p)} />
      </svg>
      <div className="ring-face">{children}</div>
    </div>
  );
}

export default function Focus({ state, update }) {
  const timer = state.timer;
  useNow(250, timer.running);
  const active = sessionActive(state);
  const info = timer.taskId ? taskView(state, timer.taskId) : null;
  const run = (recipe) => update((draft) => recipe(draft));
  const logged = info ? taskLoggedMs(state, info.task.id) : 0;

  return (
    <>
      <div className="focus-stage">
        <h2>Focus</h2>
        <div className="modes">
          <button type="button" aria-pressed={timer.mode === "pomodoro"} disabled={active} onClick={() => update((d) => setMode(d, "pomodoro"))}>Focus</button>
          <button type="button" aria-pressed={timer.mode === "stopwatch"} disabled={active} onClick={() => update((d) => setMode(d, "stopwatch"))}>Stopwatch</button>
        </div>
        <TimerRing state={state}>
          <p className="phase" aria-live="polite">{phaseLabel(state)}</p>
          <p className="time-left" role="timer">{formatMs(displayMs(state))}</p>
        </TimerRing>
        {timer.phase === "break" && <p className="quiet">This break isn't added to your hours.</p>}
        {!active && timer.mode === "pomodoro" && (
          <>
            <LengthControl label="Focus length" value={state.focusMin} min={5} max={90} step={5} locked={active} onChange={(n) => update((d) => setFocusMin(d, n))} />
            <LengthControl label="Break length" value={state.breakMin} min={1} max={15} step={1} locked={active} onChange={(n) => update((d) => setBreakMin(d, n))} />
          </>
        )}
        <div className="timer-actions"><TimerActions timer={timer} run={run} /></div>
        {info ? (
          <div className="link-card">
            <p className="quiet"><a href={hashForDay(info.day.key)}>{shortWhen(info.day)}</a></p>
            <p>{info.task.text}</p>
            {logged >= 1000 && <p className="quiet">{fmtDur(logged)} logged</p>}
            {!active && <button type="button" className="btn-line" onClick={() => run(unlinkTask)}>Unlink</button>}
          </div>
        ) : (
          <p className="quiet link-card">On its own. This still counts toward your week.</p>
        )}
      </div>
      <Reminders state={state} update={update} />
    </>
  );
}
