import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { useShell } from "./lib/store";
import "./theme/index.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("renderer: #root element not found");
}

// Dev-only handle for the CDP screenshot/verification driver: at phone widths
// there is no Rail to click, so navigation has to be driveable from script.
if (import.meta.env.DEV) {
  (window as unknown as { __mentorosShell?: typeof useShell }).__mentorosShell = useShell;
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
