import { useEffect, useState } from "react";

/* One quiet status message at a time, bottom centre. Call toast("…") from
   anywhere, or toast("…", undo) to offer an Undo button instead of asking
   for confirmation first. <Toaster /> is mounted once in App. */
const listeners = new Set();

export function toast(message, undo) {
  for (const fn of listeners) fn({ message, undo: typeof undo === "function" ? undo : null });
}

export function Toaster() {
  const [item, setItem] = useState(null);
  useEffect(() => {
    let timer = 0;
    const show = (next) => {
      setItem(next);
      clearTimeout(timer);
      timer = setTimeout(() => setItem(null), next.undo ? 6000 : 3200);
    };
    listeners.add(show);
    return () => { listeners.delete(show); clearTimeout(timer); };
  }, []);
  return (
    <div className="toast" role="status" hidden={!item}>
      {item ? item.message : null}
      {item && item.undo ? (
        <button type="button" className="toast-undo" onClick={() => { const undo = item.undo; setItem(null); undo(); }}>Undo</button>
      ) : null}
    </div>
  );
}
