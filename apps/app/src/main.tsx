import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@spectron/frontend/styles.css";
import "./integrations.css";
import { App } from "./app";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
