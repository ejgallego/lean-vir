/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { repositoryRoot } from "../../scripts/repository-paths.mjs";
import { readIrPackageInfo } from "../../web/src/runtime/ir-package.js";
import { validateInterfaceManifest } from "../../web/src/runtime/interface-manifest.js";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";

const moduleName = "ModuleSetFixture.InputSelection";
const selected = `${moduleName}.selected`;
const unmarked = `${moduleName}.unmarked`;
const imported = "ModuleSetFixture.Root.answer";
const scratch = await mkdtemp(join(tmpdir(), "vir-module-input-"));

function lake(args) {
  const result = spawnSync("lake", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.ifError(result.error);
  return result;
}

function success(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

try {
  success(lake(["build", "vir_irpkg", moduleName]));
  const factory = createVirRuntimeFactory({
    wasmBytes: await readFile(
      join(repositoryRoot, "web/public/vir-upstream.wasm"),
    ),
  });
  async function generate(name, args) {
    const output = join(scratch, `${name}.irpkg`);
    const result = lake([
      "env",
      ".lake/build/bin/vir_irpkg",
      output,
      join(scratch, `${name}.report.md`),
      ...args,
    ]);
    success(result);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /VIR_MODULE_INPUT_COMPILED/,
      "package generation re-elaborated the module source",
    );
    const bytes = await readFile(output);
    const info = readIrPackageInfo(bytes);
    validateInterfaceManifest(info.manifest);
    assert.ok(
      info.manifest.metadata.targets.every(
        (target) => target.module === moduleName && target.source === undefined,
      ),
    );
    return { bytes, manifest: info.manifest };
  }

  const marked = await generate("marked", [
    "--target-marked-module",
    moduleName,
  ]);
  assert.deepEqual(
    marked.manifest.exports.map((entry) => entry.entry),
    [selected],
  );
  assert.equal(marked.manifest.metadata.targets[0].mode, "markedModule");
  const all = await generate("all", ["--target-all-module", moduleName]);
  assert.deepEqual(all.manifest.exports.map((entry) => entry.entry).sort(), [
    selected,
    unmarked,
  ]);
  const combinedArgs = [
    "--target-module",
    moduleName,
    selected,
    "--package-module",
    moduleName,
    unmarked,
  ];
  const combined = await generate("combined", combinedArgs);
  assert.deepEqual(
    combined.manifest.exports.map((entry) => entry.entry),
    [selected],
  );
  assert.deepEqual(
    combined.manifest.metadata.targets.map((target) => target.mode),
    ["explicit", "packageOnly"],
  );
  assert.deepEqual(
    (await generate("repeated", combinedArgs)).bytes,
    combined.bytes,
    "module input bytes depend on output location or repeated loading",
  );
  const explicitImported = await generate("imported", [
    "--target-module",
    moduleName,
    imported,
  ]);
  assert.deepEqual(
    explicitImported.manifest.exports.map((entry) => entry.entry),
    [imported],
  );

  for (const [pkg, entry, expected] of [
    [marked, selected, "69"],
    [all, unmarked, "99"],
    [combined, selected, "69"],
    [explicitImported, imported, "62"],
  ]) {
    const runtime = await factory.createRuntime({ irPackageSet: [pkg.bytes] });
    try {
      assert.equal(runtime.call(entry), expected);
    } finally {
      runtime.dispose();
    }
  }

  for (const args of [
    ["--target-module", moduleName],
    ["--package-module", moduleName],
    ["--target-marked-module"],
    ["--target-marked-module", "--target-all-module", moduleName],
    ["--target-marked-module", "invalid..module"],
  ]) {
    const result = lake([
      "env",
      ".lake/build/bin/vir_irpkg",
      join(scratch, "invalid.irpkg"),
      join(scratch, "invalid.report.md"),
      ...args,
    ]);
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  }
  console.log(
    "module input smoke ok: selection, provenance, reuse, no source re-elaboration",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
