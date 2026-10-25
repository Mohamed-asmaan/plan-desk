/* Runs a snippet off the page thread so a long loop can be stopped.
   Python's interpreter is fetched on the first Python run and kept after that. */

const PY_INDEX = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const LIMIT_MS = 12000;

const SOURCE = `
self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type === "js") {
    const logs = [];
    const console = { log: (...args) => logs.push(args.map((v) => typeof v === "string" ? v : JSON.stringify(v)).join(" ")) };
    try {
      const result = Function("console", msg.code)(console);
      if (result !== undefined) logs.push(typeof result === "string" ? result : JSON.stringify(result));
      self.postMessage({ id: msg.id, ok: true, text: logs.join("\\n") });
    } catch (err) {
      self.postMessage({ id: msg.id, ok: false, text: (logs.length ? logs.join("\\n") + "\\n" : "") + (err && err.stack ? err.stack : String(err)) });
    }
    return;
  }
  if (msg.type !== "py") return;
  try {
    if (!self.py) {
      self.postMessage({ id: msg.id, status: "loading" });
      importScripts(${JSON.stringify(PY_INDEX + "pyodide.js")});
      self.py = await loadPyodide({ indexURL: ${JSON.stringify(PY_INDEX)} });
    }
    let out = "";
    self.py.setStdout({ batched: (s) => { out += s + "\\n"; } });
    self.py.setStderr({ batched: (s) => { out += s + "\\n"; } });
    const result = await self.py.runPythonAsync(msg.code);
    const shown = result === undefined || result === null ? "" : String(result);
    if (shown && shown !== "None" && shown !== "undefined") out += shown + "\\n";
    self.postMessage({ id: msg.id, ok: true, text: out.replace(/\\n$/, "") });
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, text: err && err.message ? err.message : String(err) });
  }
};
`;

let worker = null;
let seq = 0;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(URL.createObjectURL(new Blob([SOURCE], { type: "text/javascript" })));
  return worker;
}

export function runSnippet(lang, code, onStatus) {
  const id = ++seq;
  const current = getWorker();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      current.removeEventListener("message", onMessage);
      resolve(value);
    };
    let timer = null;
    const arm = (ms, text) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        current.terminate();
        worker = null;
        finish({ ok: false, text });
      }, ms);
    };
    arm(LIMIT_MS, "Stopped. It ran longer than 12 seconds.");
    function onMessage(event) {
      const data = event.data || {};
      if (data.id !== id) return;
      if (data.status === "loading") {
        arm(60000, "Python didn't finish loading. Try again.");
        if (onStatus) onStatus("Loading Python. The first run takes a moment.");
        return;
      }
      finish({ ok: !!data.ok, text: data.text || "" });
    }
    current.addEventListener("message", onMessage);
    current.postMessage({ id, type: lang === "javascript" ? "js" : "py", code });
  });
}
