/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  repositoryPath,
  repositoryRoot,
} from "../../scripts/repository-paths.mjs";
import { readIrPackageInfo } from "../../web/src/runtime/ir-package.js";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";

const scratch = await mkdtemp(join(tmpdir(), "vir-module-cli-"));

function run(script, args) {
  // Deliberately invoke outside the repository: scripts own their Lake cwd.
  const result = spawnSync(
    process.execPath,
    [repositoryPath(script), ...args],
    {
      cwd: scratch,
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result;
}

try {
  const cliPackage = join(scratch, "fib.irpkg");
  const generated = run("scripts/packages/lean-to-irpkg.mjs", [
    "Fib",
    cliPackage,
  ]);
  assert.match(generated.stdout, /mode:\s+auto-discover public definitions/);
  assert.match(generated.stdout, /local package ready/);
  const cliBytes = await readFile(cliPackage);
  const cliManifest = readIrPackageInfo(cliBytes).manifest;
  assert.deepEqual(
    cliManifest.exports.map((entry) => entry.entry),
    ["fib"],
  );
  assert.equal(cliManifest.metadata.targets[0].module, "Fib");
  assert.equal(cliManifest.metadata.targets[0].mode, "all");
  assert.equal(cliManifest.metadata.targets[0].source, undefined);
  assert.match(await readFile(join(scratch, "fib.report.md"), "utf8"), /fib/);

  const configs = [
    { version: 2, module: "Fib", package: join(scratch, "config-fib.irpkg") },
    {
      version: 2,
      module: "Quickstart",
      roots: ["Quickstart.double"],
      package: join(scratch, "quickstart.bundle"),
      report: join(scratch, "custom.md"),
    },
    {
      version: 2,
      module: "Quickstart",
      roots: ["Quickstart.total"],
      package: join(scratch, "total.irpkg"),
    },
  ];
  const configPaths = [];
  for (const [index, config] of configs.entries()) {
    const path = join(scratch, `${index}.json`);
    await writeFile(path, JSON.stringify(config));
    configPaths.push(path);
  }
  const prepared = run("scripts/packages/prepare-irpkg.mjs", configPaths);
  assert.match(prepared.stdout, /mode:\s+public module definitions from Fib/);
  assert.match(prepared.stdout, /roots:\s+Quickstart.double/);
  assert.deepEqual(
    await readFile(configs[0].package),
    cliBytes,
    "CLI and config all-public selection must produce identical packages",
  );
  const quickstartBytes = await readFile(configs[1].package);
  const manifest = readIrPackageInfo(quickstartBytes).manifest;
  assert.deepEqual(
    manifest.exports.map((entry) => entry.entry),
    ["Quickstart.double"],
  );
  assert.equal(manifest.metadata.targets[0].mode, "explicit");
  assert.match(await readFile(configs[1].report, "utf8"), /Quickstart.double/);

  const factory = createVirRuntimeFactory({
    wasmBytes: await readFile(
      join(repositoryRoot, "web/public/vir-upstream.wasm"),
    ),
  });
  for (const [bytes, entry, input, expected] of [
    [cliBytes, "fib", 8, "21"],
    [quickstartBytes, "Quickstart.double", 21, "42"],
    [await readFile(configs[2].package), "Quickstart.total", [2, 3, 5], "10"],
  ]) {
    const runtime = await factory.createRuntime({ irPackageSet: [bytes] });
    try {
      assert.equal(runtime.call(entry, input), expected);
    } finally {
      runtime.dispose();
    }
  }
  console.log(
    "module CLI smoke ok: module builds, shared config selection, paths, real Wasm",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
