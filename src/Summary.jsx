import { useState } from "react";
import {
  MONTHS, catchUpDays, countdown, days, formatHours, hackGroups, overall,
  pctText, rangeLabel, sessionActive, shortWhen, streakCount, todayKey, weekFocusMs
} from "./model.js";
import { useNow } from "./timer.js";

/* The summary tiles: Progress, Streak and focus, Key dates and (when there
   is something to catch up on) Catch-up. The overview pane lays them out as
   editable tiles; the phone stats sheet shows the same components. */

export function summaryDefs({ state, update, openDay }) {
  const defs = [
    { id: "progress", name: "Progress", half: true, build: () => <ProgressTile state={state} /> },
    { id: "stats", name: "Streak and hours", half: true, build: () => <StreakTile state={state} /> },
    { id: "key", name: "Key dates", half: true, build: () => <KeyDatesTile /> }
  ];
  if (catchUpDays(state).length) {
    defs.push({ id: "catch", name: "Catch-up", half: false, build: () => <CatchUp state={state} update={update} openDay={openDay} /> });
  }
  return defs;
}

function ProgressTile({ state }) {
  const o = overall(state);
  const pct = o.total ? (o.done / o.total) * 100 : 0;
  return (
    <>
      <h3 className="tile-label">Progress</h3>
      <div className="stats">
        <div><b>{pctText(o.done, o.total)}</b><span>{o.done} of {o.total} tasks</span></div>
      </div>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={o.total} aria-valuenow={o.done} aria-label={o.done + " of " + o.total + " tasks done"}>
        <div className="bar-fill" style={{ width: pct + "%" }} />
      </div>
    </>
  );
}

function StreakTile({ state }) {
  useNow(1000, sessionActive(state) && state.timer.running);
  return (
    <>
      <h3 className="tile-label">Streak and focus</h3>
      <div className="stats">
        <div><b>{streakCount(state)}</b><span>day streak</span></div>
        <div><b>{formatHours(weekFocusMs(state))}</b><span>focused this week</span></div>
      </div>
    </>
  );
}

function KeyDatesTile() {
  return (
    <>
      <h3 className="tile-label">Key dates</h3>
      <ul className="hack-list">
        {hackGroups().map((group) => (
          <li key={group.label}>
            <i className="px-flag" aria-hidden="true" />
            <span className="key-name">{group.label}</span>
            <span className="key-when">{rangeLabel(group.days)} · {countdown(group.days)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Seal() {
  return (
    <span className="seal">
      <span className="seal-mark" aria-hidden="true">★</span>
      <span className="sr">Important</span>
    </span>
  );
}

function CatchUp({ state, update, openDay }) {
  const [open, setOpen] = useState(() => new Set());
  const rows = catchUpDays(state);
  const toggleTask = (task, checked) => update((draft) => {
    if (checked) { draft.done[task.id] = true; draft.doneAt[task.id] = Date.now(); }
    else { delete draft.done[task.id]; delete draft.doneAt[task.id]; }
    return draft;
  });
  let body;
  if (todayKey() < days[0].key) {
    body = <p className="quiet">The plan starts on {MONTHS[days[0].m]} {days[0].d}. Unfinished tasks will gather here.</p>;
  } else if (!rows.length) {
    body = <p className="quiet">Nothing left over. You're up to date.</p>;
  } else {
    const total = rows.reduce((sum, row) => sum + row.left.length, 0);
    body = (
      <>
        <p className="quiet">{total === 1 ? "1 task left on a past day." : total + " tasks left on past days."}</p>
        <div>
          {rows.map((row) => {
            const isOpen = open.has(row.day.key);
            return (
              <div className="catch-day" key={row.day.key}>
                <button
                  type="button"
                  className="catch-toggle"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(row.day.key)) next.delete(row.day.key);
                    else next.add(row.day.key);
                    return next;
                  })}
                >
                  {shortWhen(row.day)} · {row.left.length} left
                </button>
                <div hidden={!isOpen}>
                  {row.left.map((task) => (
                    <div className="catch-task" key={task.id}>
                      <input className="tick" type="checkbox" id={"catch-" + task.id} checked={!!state.done[task.id]} onChange={(event) => toggleTask(task, event.target.checked)} />
                      <label htmlFor={"catch-" + task.id}>
                        <span>{task.text}</span>
                        {task.must ? <Seal /> : null}
                      </label>
                    </div>
                  ))}
                  <button type="button" className="btn-line open-day" onClick={() => openDay(row.day.key)}>Open day</button>
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }
  return (
    <section className="catch" id="catch-up">
      <h3>Catch-up</h3>
      {body}
    </section>
  );
}

/** The summary tiles as a plain stack, for the phone stats sheet. */
export function SummaryStack(props) {
  return (
    <div className="tiles tiles-summary">
      {summaryDefs(props).map((def) => (
        <section className="tile" key={def.id} aria-label={def.name}>{def.build()}</section>
      ))}
    </div>
  );
}
