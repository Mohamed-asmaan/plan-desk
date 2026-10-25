import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Offline use and install-to-home-screen on the published site.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js").catch(() => { /* runs fine without it */ });
}
