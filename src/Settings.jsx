import { useEffect, useRef, useState } from "react";
import { normalize } from "./model.js";
import { connectSync, disconnectSync, syncNow, useSyncStatus } from "./sync.js";
import { toast } from "./toast.jsx";
import { Icon } from "./icons.jsx";

/* Sidebar Settings: device sync and backup. A <details> menu that closes on
   an outside click or Escape. */
export default function Settings({ state, onRestore }) {
  const ref = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const close = (event) => {
      const menu = ref.current;
      if (!menu || !menu.open) return;
      if (event.type === "keydown" ? event.key === "Escape" : !event.composedPath().includes(menu)) menu.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  function download() {
    ref.current.open = false;
    const blob = new Blob([JSON.stringify(Object.assign({ exportedAt: new Date().toISOString() }, state), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gsoc-study-backup.json";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function restore(file) {
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) { toast("That file couldn't be read. Choose a backup you downloaded from this app."); return; }
    if (!data || typeof data !== "object" || (data.version == null && !data.done && !data.logs && !data.stickies && !data.dayNotes && !data.reminders)) {
      toast("That file isn't a study backup.");
      return;
    }
    if (!window.confirm("Replace all progress on this device with the backup?")) return;
    const next = normalize(data);
    onRestore(next);
    if (next.reminders.length && "Notification" in window && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch (e) { /* page reminder still works */ }
    }
    toast("Backup restored.");
  }

  return (
    <details className="rail-settings" ref={ref}>
      <summary>
        <Icon name="settings" />
        <span>Settings</span>
      </summary>
      <div className="settings-menu">
        <SyncPanel />
        <button type="button" onClick={download}>Download a backup</button>
        <button type="button" onClick={() => { ref.current.open = false; fileRef.current.click(); }}>Restore a backup</button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const chosen = event.target.files && event.target.files[0];
          event.target.value = "";
          if (chosen) restore(chosen);
        }}
      />
    </details>
  );
}

function SyncPanel() {
  const status = useSyncStatus();
  const [token, setToken] = useState("");

  async function connect() {
    const value = token.trim();
    if (!value) return;
    const ok = await connectSync(value);
    setToken("");
    toast(ok ? "Sync is on." : "GitHub didn't accept that token.");
  }

  if (!status.connected) {
    return (
      <div className="sync-panel">
        <p className="sync-title">Sync devices</p>
        <p>
          Uses a private GitHub Gist.{" "}
          <a href="https://github.com/settings/tokens/new?scopes=gist&description=Plan%20desk%20sync" target="_blank" rel="noopener">Make a token</a>
          {" "}with the gist scope, then paste it on each device.
        </p>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="GitHub token"
          aria-label="GitHub token with gist scope"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") connect(); }}
        />
        <button type="button" className="sync-action" onClick={connect}>Connect</button>
      </div>
    );
  }
  return (
    <div className="sync-panel">
      <p className="sync-title">Sync devices</p>
      <p className={status.error ? "sync-error" : ""}>{status.text}</p>
      <button type="button" className="sync-action" disabled={status.syncing} onClick={() => syncNow()}>Sync now</button>
      <button
        type="button"
        className="sync-action"
        onClick={() => { if (window.confirm("Stop syncing on this device? Progress stays here and in the Gist.")) disconnectSync(); }}
      >
        Disconnect
      </button>
    </div>
  );
}
