/**
 * Mounts the dashboard. No StrictMode: its double-invoked effects would fetch
 * twice every time the window opens, and fetch-on-open is meant to be once.
 */

import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

createRoot(root).render(<App />);