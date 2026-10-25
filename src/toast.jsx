import { useEffect, useState } from "react";

/* One quiet status message at a time, bottom centre. Call toast("…") from
   anywhere; <Toaster /> is mounted once in App. */
const listeners = new Set();

export function toast(message) {
  for (const fn of listeners) fn(message);
}

export function Toaster() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    let timer = 0;
    const show = (text) => {
      setMessage(text);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(""), 3200);
    };
    listeners.add(show);
    return () => { listeners.delete(show); clearTimeout(timer); };
  }, []);
  return <div className="toast" role="status" hidden={!message}>{message}</div>;
}
