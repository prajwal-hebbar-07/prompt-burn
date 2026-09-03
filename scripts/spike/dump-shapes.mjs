// Re-runs the commit-2 data-shape spike on this machine. No deps: node:sqlite + fetch.
//
//   node scripts/spike/dump-shapes.mjs            # prints shapes to stdout
//   node scripts/spike/dump-shapes.mjs out/       # also writes raw JSON there (gitignored)
//
// Prints token counts and field names only. The Cursor access token is never printed.
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const outDir = process.argv[2];

// --- OMP: newest session file with a usage-bearing assistant message -----------
const sessionsRoot = join(homedir(), ".omp/agent/sessions");
const files = [];
for (const e of await readdir(sessionsRoot, { recursive: true, withFileTypes: true })) {
  if (e.isFile() && e.name.endsWith(".jsonl")) files.push(join(e.parentPath, e.name));
}
let ompLine, ompHeader;
for (const f of files.sort().reverse()) {
  for (const raw of (await readFile(f, "utf8")).split("\n")) {
    if (!raw) continue;
    const o = JSON.parse(raw);
    if (o.type === "session") ompHeader ??= o;
    if (o.message?.usage?.cacheRead > 0) ompLine ??= o;
  }
  if (ompLine && ompHeader) break;
}
console.log("omp session header:", ompHeader);
console.log("omp usage:", ompLine?.message?.usage, "model:", ompLine?.message?.model);

// --- Cursor: key-only auth read, then cycle aggregates ------------------------
const vscdb = join(homedir(), "Library/Application Support/Cursor/User/globalStorage/state.vscdb");
const db = new DatabaseSync(`file:${vscdb}?mode=ro&immutable=1`, { readOnly: true });
const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get("cursorAuth/accessToken");
db.close();
if (!row) throw new Error("no cursorAuth/accessToken in state.vscdb — sign in to Cursor first");
const jwt = String(row.value);
const sub = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).sub;

const call = async (path, body = {}) => {
  const res = await fetch(`https://cursor.com${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://cursor.com", // required: cursor.com rejects state-changing calls without it
      Cookie: `WorkosCursorSessionToken=${encodeURIComponent(sub)}%3A%3A${jwt}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};

const summary = await call("/api/usage-summary");
const cycle = await call("/api/dashboard/get-aggregated-usage-events"); // no dates = current cycle
console.log("cursor cycle:", summary.billingCycleStart, "->", summary.billingCycleEnd, summary.membershipType);
console.log("cursor aggregations:", cycle.aggregations);

if (outDir) {
  await mkdir(outDir, { recursive: true });
  const dump = { ompHeader, ompLine, summary, cycle };
  for (const [name, value] of Object.entries(dump)) {
    await writeFile(join(outDir, `${name}.json`), JSON.stringify(value, null, 2));
  }
  console.log(`wrote raw (UNREDACTED) dumps to ${outDir} — redact before committing`);
}
