#!/usr/bin/env node
/**
 * One version source: the `version` field in the root `package.json`.
 *
 * Everything shippable is rewritten from it — the VS Code extension manifest,
 * the desktop manifest, `tauri.conf.json`, and the desktop crate. Workspace
 * packages under `packages/` stay at 0.0.0 on purpose: they are private and
 * consumed as `workspace:*`, so their versions are never read by anything.
 *
 *   node scripts/bump-version.mjs <major|minor|patch|X.Y.Z>
 *   node scripts/bump-version.mjs --check
 *
 * Rewrites files only. Tagging and publishing belong to the release workflow.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Every file that carries the shipped version, relative to the repo root. */
export const surfaces = [
  "package.json",
  "apps/vscode/package.json",
  "apps/desktop/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/desktop/src-tauri/Cargo.toml",
];

const SEMVER = /^\d+\.\d+\.\d+$/;

export function nextVersion(current, kind) {
  if (!SEMVER.test(current)) {
    throw new Error(`current version is not X.Y.Z: ${current}`);
  }
  const [major, minor, patch] = current.split(".").map(Number);
  switch (kind) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      if (SEMVER.test(kind)) return kind;
      throw new Error(`expected major|minor|patch|X.Y.Z, got: ${kind}`);
  }
}

/** First top-level `"version": "…"` — rewritten in place so formatting survives. */
const JSON_VERSION = /^(\s*"version"\s*:\s*")([^"]*)(")/m;

export function getJsonVersion(text) {
  const found = JSON_VERSION.exec(text);
  if (!found) throw new Error("no version field");
  return found[2];
}

export function setJsonVersion(text, version) {
  getJsonVersion(text);
  return text.replace(JSON_VERSION, `$1${version}$3`);
}

/**
 * Bounds of the `[package]` table. Everything outside it is off limits: a
 * global replace would rewrite `tauri = { version = "2" }` and pin the
 * framework to the app's version.
 */
function packageSection(text) {
  const start = text.search(/^\[package\]$/m);
  if (start < 0) throw new Error("no [package] section");
  const after = text.indexOf("\n", start) + 1;
  const nextHeader = text.slice(after).search(/^\[/m);
  return [after, nextHeader < 0 ? text.length : after + nextHeader];
}

const TOML_VERSION = /^version\s*=\s*"([^"]*)"/m;

export function getTomlVersion(text) {
  const [start, end] = packageSection(text);
  const found = TOML_VERSION.exec(text.slice(start, end));
  if (!found) throw new Error("no version key under [package]");
  return found[1];
}

export function setTomlVersion(text, version) {
  const [start, end] = packageSection(text);
  const section = text.slice(start, end);
  getTomlVersion(text);
  return (
    text.slice(0, start) +
    section.replace(TOML_VERSION, `version = "${version}"`) +
    text.slice(end)
  );
}

const isToml = (file) => file.endsWith(".toml");

export function readVersions(root = repoRoot) {
  return surfaces.map((file) => {
    const text = readFileSync(path.join(root, file), "utf8");
    return {
      file,
      version: isToml(file) ? getTomlVersion(text) : getJsonVersion(text),
    };
  });
}

export function writeVersions(version, root = repoRoot) {
  for (const file of surfaces) {
    const full = path.join(root, file);
    const text = readFileSync(full, "utf8");
    const set = isToml(file) ? setTomlVersion : setJsonVersion;
    writeFileSync(full, set(text, version));
  }
  return surfaces.length;
}

function main(argv) {
  const arg = argv[0];
  if (!arg) {
    console.error("usage: bump-version.mjs <major|minor|patch|X.Y.Z> | --check");
    return 2;
  }

  const versions = readVersions();
  const [root, ...rest] = versions;

  if (arg === "--check") {
    const drift = rest.filter((entry) => entry.version !== root.version);
    for (const entry of drift) {
      console.error(`${entry.file}: ${entry.version} (root is ${root.version})`);
    }
    if (drift.length > 0) return 1;
    console.log(`${root.version} across ${versions.length} files`);
    return 0;
  }

  const next = nextVersion(root.version, arg);
  const count = writeVersions(next);
  console.log(`${root.version} -> ${next} (${count} files)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(String(error.message ?? error));
    process.exitCode = 1;
  }
}
