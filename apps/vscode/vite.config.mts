import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The webview bundle. The extension host writes the page's HTML itself (it has
 * to inject webview URIs and a CSP nonce), so there is no `index.html` here and
 * the asset names are fixed rather than hashed — the host references them by
 * name from `dist/`.
 */
export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: "main.tsx",
      output: {
        entryFileNames: "webview.js",
        assetFileNames: "webview.[ext]",
      },
    },
  },
});
