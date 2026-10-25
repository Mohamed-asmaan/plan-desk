import { useEffect, useRef } from "react";
import { COLOR_LABEL, NOTE_COLORS, noteStamp, uid } from "./model.js";

/* Sticky notes. Each keeps when it was written and when it was last edited. */
export default function Notes({ state, update }) {
  const focusId = useRef(null);

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

  function remove(id) {
    if (!window.confirm("Delete this note?")) return;
    update((draft) => { draft.stickies = draft.stickies.filter((item) => item.id !== id); return draft; });
  }

  return (
    <>
      <h2>Notes</h2>
      <div className="board">
        {state.stickies.length ? state.stickies.map((note) => (
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
        )) : <p className="quiet">Nothing here yet. Add a note for a thought, a blocker, or an idea.</p>}
      </div>
      <button type="button" className="dashed" onClick={add}>Add a note</button>
    </>
  );
}
