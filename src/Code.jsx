import { useEffect, useState } from "react";
import { blankSnippet, readCodeDoc, writeCodeDoc } from "./code/doc.js";
import { runSnippet } from "./code/run.js";
import { scheduleSync } from "./sync.js";
import { toast } from "./toast.jsx";

function persist(doc) {
  const ok = writeCodeDoc(doc);
  if (ok) scheduleSync();
  else toast("Couldn't save this snippet.");
  return ok;
}

export default function Code() {
  const [doc, setDoc] = useState(readCodeDoc);
  const [output, setOutput] = useState({ text: "", ok: true });
  const [running, setRunning] = useState(false);
  const active = doc.items.find((item) => item.id === doc.active) || null;

  useEffect(() => {
    const onReplace = () => setDoc(readCodeDoc());
    window.addEventListener("code:replaced", onReplace);
    return () => window.removeEventListener("code:replaced", onReplace);
  }, []);

  function commit(next) {
    setDoc(next);
    persist(next);
  }

  function patch(recipe) {
    if (!active) return;
    const now = Date.now();
    const items = doc.items.map((item) => item.id === active.id ? { ...recipe(item), updatedAt: now } : item);
    commit({ ...doc, items, updatedAt: now });
  }

  function add() {
    const item = blankSnippet(doc.items.length);
    item.updatedAt = Date.now();
    const items = [item, ...doc.items].slice(0, 40);
    commit({ ...doc, active: item.id, items, updatedAt: item.updatedAt });
    setOutput({ text: "", ok: true });
  }

  function remove(id) {
    const gone = doc.items.find((item) => item.id === id);
    if (!gone) return;
    const items = doc.items.filter((item) => item.id !== id);
    const next = { ...doc, items, active: doc.active === id ? (items[0] ? items[0].id : "") : doc.active, updatedAt: Date.now() };
    commit(next);
    toast("Snippet deleted.", () => {
      const back = readCodeDoc();
      const restored = { ...back, items: [gone, ...back.items.filter((item) => item.id !== gone.id)].slice(0, 40), active: gone.id, updatedAt: Date.now() };
      commit(restored);
    });
  }

  async function run() {
    if (!active || running) return;
    if (!active.code.trim()) { setOutput({ text: "Nothing to run.", ok: false }); return; }
    setRunning(true);
    setOutput({ text: active.lang === "python" ? "Running…" : "", ok: true });
    const result = await runSnippet(active.lang, active.code, (text) => setOutput({ text, ok: true }));
    setOutput({ text: result.text || "No output.", ok: result.ok });
    setRunning(false);
  }

  function onEditorKey(event) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); run(); return; }
    if (event.key !== "Tab") return;
    event.preventDefault();
    const el = event.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = active.code.slice(0, start) + "  " + active.code.slice(end);
    patch(() => ({ ...active, code: next }));
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
  }

  return (
    <div className="code-desk">
      <div className="code-list" role="tablist" aria-label="Snippets">
        {doc.items.map((item) => (
          <button key={item.id} type="button" role="tab" className="code-chip" aria-selected={item.id === doc.active} onClick={() => { const next = { ...doc, active: item.id }; setDoc(next); persist(next); setOutput({ text: "", ok: true }); }}>
            {item.name}
          </button>
        ))}
        <button type="button" className="code-chip" onClick={add}>New</button>
      </div>
      {active ? (
        <div className="code-work">
          <div className="code-bar">
            <input className="code-name" aria-label="Snippet name" value={active.name} maxLength={40} onChange={(event) => patch(() => ({ ...active, name: event.target.value }))} />
            <div className="modes" role="group" aria-label="Language">
              <button type="button" aria-pressed={active.lang === "python"} onClick={() => patch(() => ({ ...active, lang: "python" }))}>Python</button>
              <button type="button" aria-pressed={active.lang === "javascript"} onClick={() => patch(() => ({ ...active, lang: "javascript" }))}>JavaScript</button>
            </div>
            <button type="button" className="btn btn-primary" disabled={running} onClick={run}>{running ? "Running" : "Run"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => remove(active.id)}>Delete</button>
          </div>
          <textarea
            className="code-editor"
            spellCheck={false}
            aria-label="Code"
            value={active.code}
            onChange={(event) => patch(() => ({ ...active, code: event.target.value }))}
            onKeyDown={onEditorKey}
            placeholder={active.lang === "python" ? "print('hello')" : "console.log('hello')"}
          />
          <textarea
            className="code-note"
            aria-label="Note"
            maxLength={2000}
            value={active.note}
            onChange={(event) => patch(() => ({ ...active, note: event.target.value }))}
            placeholder="What you're trying, or an example to check"
          />
          <pre className={"code-out" + (output.ok ? "" : " is-error")} aria-live="polite">{output.text}</pre>
        </div>
      ) : (
        <div className="code-work">
          <p className="quiet">Name a snippet, write it, and run it.</p>
          <button type="button" className="btn btn-primary" onClick={add}>New snippet</button>
        </div>
      )}
    </div>
  );
}
