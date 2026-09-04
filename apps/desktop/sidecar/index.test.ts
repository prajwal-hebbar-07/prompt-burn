import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const SIDECAR = fileURLToPath(new URL("./index.ts", import.meta.url));
const RESOLVE_HOOK = fileURLToPath(new URL("./ts-resolve.mjs", import.meta.url));

/** Reads the sidecar's first stdout line, the ready announcement. */
async function readyLine(stdout: Readable): Promise<string> {
  stdout.setEncoding("utf8");
  let buffered = "";
  for await (const chunk of stdout) {
    buffered += chunk as string;
    const newline = buffered.indexOf("\n");
    if (newline >= 0) return buffered.slice(0, newline);
  }
  throw new Error("the sidecar exited before announcing itself");
}

it("opens the shared database and exits when the window closes its stdin", async () => {
  // A throwaway home: the real ~/.prompt-burn/db.sqlite is never touched.
  const home = mkdtempSync(join(tmpdir(), "prompt-burn-desktop-"));
  const child = spawn(process.execPath, ["--import", RESOLVE_HOOK, SIDECAR], {
    env: { ...process.env, HOME: home },
    stdio: ["pipe", "pipe", "inherit"],
  });

  try {
    const ready = JSON.parse(await readyLine(child.stdout)) as {
      type: string;
      database: string;
      tables: number;
    };

    expect(ready.type).toBe("ready");
    expect(ready.database).toBe(join(home, ".prompt-burn", "db.sqlite"));
    expect(existsSync(ready.database)).toBe(true);
    // schema.sql applied on create, so the connection sees real tables.
    expect(ready.tables).toBeGreaterThan(0);

    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
    child.stdin.end();
    expect(await exited).toBe(0);
  } finally {
    child.kill();
    rmSync(home, { recursive: true, force: true });
  }
});
