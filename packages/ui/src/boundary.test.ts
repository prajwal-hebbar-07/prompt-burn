// @vitest-environment node
/**
 * The boundary this package lives on: props and callbacks only. If ui ever
 * grows an fs/network/collector/db import, or a runtime dependency beyond
 * core types and React, this file fails before a host ships it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL(".", import.meta.url));

/** Modules ui must never import, directly or through an alias. */
const BANNED_IMPORT =
  /@prompt-burn\/(collectors|db|desktop)|node:(fs|net|http|https|sqlite|child_process)|@tauri-apps/;

const files = readdirSync(src, { recursive: true })
  .map((entry) => join(src, String(entry)))
  .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
  // Test files may import the banned modules to police them.
  .filter((file) => !file.endsWith(".test.tsx") && !file.endsWith(".test.ts"));

describe("the props-only boundary", () => {
  it("imports no fs, no network, no collectors, no db, no sidecar", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (/^\s*(import|export)\b.*from/.test(line) && BANNED_IMPORT.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares only core and react as runtime dependencies", () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(["@prompt-burn/core", "react"]);
  });

  it("ships the tailwind entry hosts import", () => {
    expect(readFileSync(join(src, "index.css"), "utf8")).toContain("@import \"tailwindcss\"");
  });
});