import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The webview bundle. Tauri serves `dist/` in a packaged app and the dev server
 * on 1420 under `tauri dev`; nothing else consumes this build.
 */
export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: { port: 1420, strictPort: true },
  clearScreen: false,
});