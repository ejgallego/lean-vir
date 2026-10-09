/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../../scripts/repository-paths.mjs";

// The aggregate import test prepares these artifacts first. Keep a separate
// resolved-path context, without modifying or moving the owner's build outputs.
const compiled = path.join(repositoryRoot, ".lake/build/lib/lean");
mkdirSync(path.join(repositoryRoot, "build"), { recursive: true });
const output = mkdtempSync(
  path.join(repositoryRoot, "build/import-cache-resolved-"),
);
const artifacts = path.join(output, "artifacts");
mkdirSync(artifacts);
const importArts = {};
for (const entry of readdirSync(compiled, { recursive: true })) {
  if (!entry.endsWith(".olean")) continue;
  const stem = entry.slice(0, -".olean".length);
  const groups = [
    [".olean", ".olean.server", ".olean.private"],
    [".ir.sig", ".ir"],
  ];
  const ordinal = Object.keys(importArts).length;
  importArts[stem.split(path.sep).join(".")] = groups.map((suffixes) =>
    suffixes.flatMap((suffix) => {
      const source = path.join(compiled, stem + suffix);
      if (!existsSync(source)) return [];
      const destination = path.join(artifacts, `${ordinal}${suffix}`);
      copyFileSync(source, destination);
      return [destination];
    }),
  );
}
for (const name of [
  "ModuleSetFixture.InputSelection",
  "fixtures.HostInterop",
]) {
  assert.ok(importArts[name]?.[1].length, `missing prepared IR: ${name}`);
}
const setupPath = path.join(output, "resolved.setup.json");
writeFileSync(
  setupPath,
  JSON.stringify(
    {
      name: "ImportCache",
      isModule: true,
      importArts,
      dynlibs: [],
      plugins: [],
      options: {},
    },
    null,
    2,
  ) + "\n",
);
console.log(`resolved import cache evidence: ${output}`);
for (const mode of ["module", "host"]) {
  const result = spawnSync(
    "lake",
    [
      "env",
      "lean",
      "--run",
      "tests/packages/ImportCache.lean",
      mode,
      setupPath,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 5 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  writeFileSync(path.join(output, `${mode}.log`), log);
  assert.ifError(result.error);
  assert.equal(result.status, 0, log);
  process.stdout.write(log);
}
