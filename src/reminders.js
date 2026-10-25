import { useEffect, useRef } from "react";
import { todayKey, uid } from "./model.js";
import { notify, playChime } from "./timer.js";

/** Reminders due this minute that haven't fired today. */
function dueReminders(state) {
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  const key = todayKey();
  return state.reminders.filter((rem) => rem.hour * 60 + rem.minute === minute && state.reminderFired[rem.id] !== key);
}

/** Mount once in App. Rings each reminder once a day at its time, while the page is open. */
export function useReminders(state, update) {
  const ref = useRef(state);
  ref.current = state;
  const updateRef = useRef(update);
  updateRef.current = update;

  const rung = useRef(new Set());
  const check = useRef(() => {
    const key = todayKey();
    // `rung` stops a second check before the re-render from ringing twice.
    const due = dueReminders(ref.current).filter((rem) => !rung.current.has(rem.id + key + rem.hour + ":" + rem.minute));
    if (!due.length) return;
    for (const rem of due) rung.current.add(rem.id + key + rem.hour + ":" + rem.minute);
    updateRef.current((draft) => {
      for (const rem of due) if (draft.reminders.some((r) => r.id === rem.id)) draft.reminderFired[rem.id] = key;
      return draft;
    });
    for (const rem of due) {
      playChime("reminder");
      notify("Reminder", rem.label);
    }
  }).current;

  // Check on the minute, like the vanilla clock tick.
  useEffect(() => {
    let last = -1;
    const id = setInterval(() => {
      const now = new Date();
      const minute = now.getHours() * 60 + now.getMinutes();
      if (minute === last) return;
      last = minute;
      check();
    }, 1000);
    return () => clearInterval(id);
  }, [check]);

  // And right away when a reminder is added or its time changes.
  const times = state.reminders.map((rem) => rem.id + "@" + rem.hour + ":" + rem.minute).join(",");
  useEffect(() => { check(); }, [times, check]);
}

/* ---------- Recipes for the Focus page ---------- */

export const MAX_REMINDERS = 5;

export function addReminder(draft, hour, minute, label) {
  if (draft.reminders.length >= MAX_REMINDERS) return draft;
  draft.reminders.push({ id: uid(), hour, minute, label: String(label || "").trim().slice(0, 80) || "Start studying" });
  return draft;
}

export function removeReminder(draft, id) {
  draft.reminders = draft.reminders.filter((rem) => rem.id !== id);
  delete draft.reminderFired[id];
  return draft;
}

export function setReminderTime(draft, id, hour, minute) {
  const rem = draft.reminders.find((r) => r.id === id);
  if (!rem || !Number.isInteger(hour) || !Number.isInteger(minute)) return draft;
  rem.hour = hour;
  rem.minute = minute;
  delete draft.reminderFired[id];
  return draft;
}

export function setReminderLabel(draft, id, label, final) {
  const rem = draft.reminders.find((r) => r.id === id);
  if (!rem) return draft;
  rem.label = (final ? label.trim() : label.slice(0, 80)) || "Reminder";
  return draft;
}
