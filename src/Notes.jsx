import { useEffect, useRef, useState } from "react";
import { COLOR_LABEL, NOTE_COLORS, noteStamp, uid } from "./model.js";
import { toast } from "./toast.jsx";

/* Sticky notes. Each keeps when it was written and when it was last edited. */
export default function Notes({ state, update }) {
  const focusId = useRef(null);
  const [query, setQuery] = useState("");
  const [tint, setTint] = useState("");

  useEffect(() => {
    if (!focusId.current) return;
    const area = document.getElementById("note-" + focusId.current);
    focusId.current = null;
    if (area) area.focus();
  });

  function add() {
    const now = Date.now();
    const id = uid();
    focusId.current = id;
    setQuery("");
    setTint("");
    update((draft) => {
      draft.stickies.unshift({ id, text: "", color: "cream", createdAt: now, updatedAt: now });
      return draft;
    });
  }

  function edit(id, fields) {
    update((draft) => {
      const note = draft.stickies.find((item) => item.id === id);
      if (note) {
        Object.assign(note, fields);
        const now = Date.now();
        if (!note.createdAt) note.createdAt = now;
        note.updatedAt = now;
      }
      return draft;
    });
  }

  // Delete at once and offer Undo, rather than asking first.
  function remove(id) {
    const index = state.stickies.findIndex((item) => item.id === id);
    if (index < 0) return;
    const note = state.stickies[index];
    update((draft) => { draft.stickies = draft.stickies.filter((item) => item.id !== id); return draft; });
    toast("Note deleted", () => update((draft) => {
      if (!draft.stickies.some((item) => item.id === note.id)) draft.stickies.splice(Math.min(index, draft.stickies.length), 0, note);
      return draft;
    }));
  }

  const q = query.trim().toLowerCase();
  const shown = state.stickies.filter((note) => (!tint || note.color === tint) && (!q || note.text.toLowerCase().includes(q)));

  return (
    <>
      <div className="notes-head">
        <div>
          <h2>Notes</h2>
          <p className="quiet">{state.stickies.length} {state.stickies.length === 1 ? "note" : "notes"}</p>
        </div>
        <div className="notes-tools">
          <input type="search" className="notes-search" placeholder="Search notes" aria-label="Search notes" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="colors notes-filter" role="group" aria-label="Filter by colour">
            {NOTE_COLORS.map((color) => (
              <button key={color} type="button" className={"sw-" + color} aria-label={"Only " + COLOR_LABEL[color]} aria-pressed={tint === color} onClick={() => setTint((v) => (v === color ? "" : color))} />
            ))}
          </div>
          <button type="button" className="btn btn-primary" onClick={add}>New note</button>
        </div>
      </div>
      <div className="board">
        {shown.length ? shown.map((note) => (
          <article className={"note c-" + note.color} key={note.id}>
            <textarea
              id={"note-" + note.id}
              aria-label="Note text"
              maxLength={1000}
              placeholder="A thought, a blocker, an idea."
              value={note.text}
              onChange={(event) => edit(note.id, { text: event.target.value })}
            />
            <p className="note-when">{noteStamp(note)}</p>
            <div className="note-tools">
              <div className="colors">
                {NOTE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={"sw-" + color}
                    aria-label={COLOR_LABEL[color]}
                    aria-pressed={note.color === color}
                    onClick={() => edit(note.id, { color })}
                  />
                ))}
              </div>
              <button type="button" className="btn-line" onClick={() => remove(note.id)}>Delete</button>
            </div>
          </article>
        )) : (
          <p className="quiet notes-empty">
            {state.stickies.length ? "No notes match." : "Nothing here yet. Add a note for a thought, a blocker, or an idea."}
          </p>
        )}
      </div>
    </>
  );
}
