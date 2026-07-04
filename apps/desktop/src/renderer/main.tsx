import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./theme/index.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("renderer: #root element not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
