/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), "vir-downstream-bundle-"));
const producer = path.join(temporary, "producer");
const consumer = path.join(temporary, "consumer");
const output = "build/generated/infoview/vir-infoview-widget.js";

// Copy only bundle inputs. This tests the actual Lake/npm/esbuild path without
// modifying the active checkout's sources, traces, or generated bundle.
try {
  mkdirSync(producer);
  mkdirSync(consumer);
  for (const file of [
    "lakefile.lean",
    "lean-toolchain",
    "package.json",
    "package-lock.json",
    "scripts/build-infoview-widget.mjs",
    "web/app/vir-infoview-widget.js",
    "web/src",
  ]) {
    const destination = path.join(producer, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(repo, file), destination, { recursive: true });
  }
  symlinkSync(
    path.join(repo, "node_modules"),
    path.join(producer, "node_modules"),
    "dir",
  );
  cpSync(
    path.join(repo, "lean-toolchain"),
    path.join(consumer, "lean-toolchain"),
  );
  writeFileSync(
    path.join(consumer, "lakefile.lean"),
    [
      "import Lake",
      "open Lake DSL",
      "package bundle_consumer",
      'require lean_vir from "../producer"',
      "",
    ].join("\n"),
  );
  // A wrong npm cwd must fail instead of accidentally finding a parent script.
  const consumerPackage = JSON.stringify({
    private: true,
    scripts: { "build:infoview": 'node -e "process.exit(91)"' },
  });
  writeFileSync(path.join(consumer, "package.json"), consumerPackage);

  function build() {
    const result = spawnSync(
      "lake",
      ["-v", "build", "@lean_vir/infoviewBundle"],
      {
        cwd: consumer,
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    assert.ifError(result.error);
    assert.equal(result.status, 0, log);
    assert.ok(existsSync(path.join(producer, output)), log);
    assert.ok(
      !existsSync(path.join(consumer, "build")),
      "bundle leaked into consumer build/",
    );
    assert.ok(
      !existsSync(path.join(consumer, "node_modules")),
      "npm modified consumer",
    );
    assert.ok(
      !existsSync(path.join(consumer, "package-lock.json")),
      "npm modified consumer",
    );
    assert.equal(
      readFileSync(path.join(consumer, "package.json"), "utf8"),
      consumerPackage,
    );
    return log;
  }

  build();
  const before = statSync(path.join(producer, output), {
    bigint: true,
  }).mtimeNs;
  assert.doesNotMatch(
    build(),
    /Built .*infoviewBundle/,
    "unchanged bundle was rebuilt",
  );
  assert.equal(
    statSync(path.join(producer, output), { bigint: true }).mtimeNs,
    before,
  );

  for (const [file, suffix, marker] of [
    [
      "web/app/vir-infoview-widget.js",
      '\nglobalThis.__virEntryTrace = "entry-trace";\n',
      "entry-trace",
    ],
    [
      "web/src/runtime/interface-effects.js",
      '\nglobalThis.__virSourceTrace = "source-trace";\n',
      "source-trace",
    ],
    [
      "scripts/build-infoview-widget.mjs",
      '\nconsole.log("script-trace");\n',
      null,
    ],
    ["package.json", "\n", null],
    ["package-lock.json", "\n", null],
  ]) {
    appendFileSync(path.join(producer, file), suffix);
    assert.match(
      build(),
      /Built .*infoviewBundle/,
      `${file} did not invalidate the bundle`,
    );
    if (marker !== null) {
      assert.ok(
        readFileSync(path.join(producer, output), "utf8").includes(marker),
        file,
      );
    }
  }
  console.log("VIR downstream infoview bundle smoke ok");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
