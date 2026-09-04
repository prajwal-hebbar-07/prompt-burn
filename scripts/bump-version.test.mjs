import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  nextVersion,
  readVersions,
  setTomlVersion,
  surfaces,
  writeVersions,
} from "./bump-version.mjs";

test("bump kinds zero the lower segments", () => {
  assert.equal(nextVersion("1.2.3", "major"), "2.0.0");
  assert.equal(nextVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(nextVersion("1.2.3", "patch"), "1.2.4");
});

test("explicit X.Y.Z passes through", () => {
  assert.equal(nextVersion("0.0.0", "1.4.9"), "1.4.9");
  assert.throws(() => nextVersion("0.0.0", "2.0.0-rc"), /major\|minor\|patch/);
  assert.throws(() => nextVersion("nightly", "patch"), /not X\.Y\.Z/);
});

test("Cargo.toml rewrite leaves dependency versions alone", () => {
  const cargo = [
    "[package]",
    'name = "prompt-burn-desktop"',
    'version = "0.0.0"',
    'edition = "2021"',
    "",
    "[build-dependencies]",
    'tauri-build = { version = "2", features = [] }',
    "",
    "[dependencies]",
    'tauri = { version = "2", features = [] }',
    "",
  ].join("\n");

  const bumped = setTomlVersion(cargo, "1.2.3");

  assert.match(bumped, /\[package\][\s\S]*version = "1\.2\.3"/);
  assert.match(bumped, /tauri = \{ version = "2"/);
  assert.match(bumped, /tauri-build = \{ version = "2"/);
});

test("every surface moves together", () => {
  const root = mkdtempSync(path.join(tmpdir(), "prompt-burn-bump-"));
  for (const file of surfaces) {
    mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    writeFileSync(
      path.join(root, file),
      file.endsWith(".toml")
        ? '[package]\nname = "x"\nversion = "0.0.0"\n\n[dependencies]\ntauri = { version = "2" }\n'
        : '{\n  "name": "x",\n  "version": "0.0.0"\n}\n',
    );
  }

  assert.equal(writeVersions("9.9.9", root), surfaces.length);
  assert.deepEqual(
    readVersions(root).map((entry) => entry.version),
    surfaces.map(() => "9.9.9"),
  );
  assert.match(
    readFileSync(path.join(root, "apps/desktop/src-tauri/Cargo.toml"), "utf8"),
    /tauri = \{ version = "2" \}/,
  );
});
