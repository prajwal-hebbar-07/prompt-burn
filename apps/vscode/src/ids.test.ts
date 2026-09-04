/**
 * The manifest and the extension host have to agree, and nothing at build time
 * checks that: a stale `package.json` id fails only when a human runs the
 * command in a real editor. These assertions are that check.
 *
 * The `vscode` module only exists inside the extension host, so `extension.ts`
 * itself is not importable here — what it registers is verified by hand in a
 * running editor (Extension Development Host, `Prompt Burn: Open Dashboard`).
 */

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { COMMAND_OPEN, DASHBOARD_PATH, TAB_TITLE, VIEW_TYPE } from "./ids.js";

interface Manifest {
  main: string;
  contributes: {
    commands: { command: string; title: string; category?: string }[];
    customEditors: {
      viewType: string;
      displayName: string;
      selector: { filenamePattern: string }[];
    }[];
  };
}

// Vitest runs from this package's root (`pnpm --filter … test`).
const manifest = JSON.parse(readFileSync("package.json", "utf8")) as Manifest;

it("contributes the command the extension registers", () => {
  expect(manifest.contributes.commands.map((c) => c.command)).toEqual([COMMAND_OPEN]);
});

it("contributes the custom editor view type the extension registers", () => {
  expect(manifest.contributes.customEditors.map((e) => e.viewType)).toEqual([VIEW_TYPE]);
});

it("labels the tab Prompt Burn", () => {
  // The tab takes its name from the last path segment of the opened URI, and
  // the selector has to match that same name for the view type to bind.
  expect(DASHBOARD_PATH.split("/").at(-1)).toBe(TAB_TITLE);
  const patterns = manifest.contributes.customEditors[0]?.selector.map((s) => s.filenamePattern);
  expect(patterns).toEqual([`**/${TAB_TITLE}`]);
});

it("points main at the compiled entrypoint", () => {
  expect(manifest.main).toBe("./out/extension.js");
});
