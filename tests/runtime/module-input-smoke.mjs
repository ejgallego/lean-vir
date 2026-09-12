/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { repositoryRoot } from "../../scripts/repository-paths.mjs";
import { readIrPackageInfo } from "../../web/src/runtime/ir-package.js";
import { validateInterfaceManifest } from "../../web/src/runtime/interface-manifest.js";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { createTestModuleProject } from "../support/module-project.mjs";
import { virIrpkgPath } from "../../scripts/packages/irpkg-generator.mjs";

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
  const wasmBytes = await readFile(join(repositoryRoot, "web/public/vir-upstream.wasm"));
  const factory = createVirRuntimeFactory({ wasmBytes });
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
  const setupPath = join(scratch, "empty.setup.json");
  await writeFile(setupPath, JSON.stringify({
    name: moduleName, isModule: true, importArts: {},
    dynlibs: [], plugins: [], options: {},
  }));
  assert.deepEqual(
    (await generate("setup-marked", [
      "--setup", setupPath, "--target-marked-module", moduleName,
    ])).bytes,
    marked.bytes,
    "an empty artifact map must preserve conventional module imports",
  );
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
    [],
    ["--setup"],
    ["--setup", setupPath],
    ["--target-module", moduleName],
    ["--package-module", moduleName],
    ["--target-marked-module"],
    ["--target-marked-module", "--target-all-module", moduleName],
    ["--target-marked-module", "invalid..module"],
    ["--target-module", "fixtures/Basic.lean", selected],
    ["--target-module", "fixtures\\Basic.lean", selected],
    ["--target-all-module", "Basic.lean"],
    ["--target", "fixtures/Basic.lean", selected],
    ["--package-target", "fixtures/Basic.lean", selected],
    ["--target-all", "fixtures/Basic.lean"],
    ["--target-marked", "fixtures/Basic.lean"],
  ]) {
    const result = lake([
      "env",
      ".lake/build/bin/vir_irpkg",
      join(scratch, "invalid.irpkg"),
      join(scratch, "invalid.report.md"),
      ...args,
    ]);
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    await assert.rejects(readFile(join(scratch, "invalid.irpkg")), { code: "ENOENT" });
    await assert.rejects(readFile(join(scratch, "invalid.report.md")), { code: "ENOENT" });
  }
  // Public wrappers may reach private host declarations in a transitive owner.
  // The closure needs both their compiled IR and their validated signature metadata,
  // even when the compiler inlines the wrapper into the consumer.
  const privateHost = await createTestModuleProject({
    directory: join(scratch, "private-host-project"),
    modules: {
      "PrivateHost.Owner": `module
public import Vir
namespace PrivateHost
@[vir_js "test.private.echo"]
private opaque echo (value : @& Lean.Vir.Js String) :
    Lean.Vir.RuntimeM (Lean.Vir.Js String)
@[inline] public def run (value : Lean.Vir.Js String) : Lean.Vir.RuntimeM (Lean.Vir.Js String) :=
  echo value
end PrivateHost
`,
      "PrivateHost.Consumer": `module
public import PrivateHost.Owner
@[vir_export]
public def PrivateHost.answer (value : String) : Lean.Vir.RuntimeM String := do
  Lean.Vir.JsValue.toString (← run (← Lean.Vir.JsValue.ofString value))
`,
    },
  });
  success(privateHost.build());
  const privateOutput = join(scratch, "private-host.irpkg");
  success(spawnSync(virIrpkgPath, [
    privateOutput, join(scratch, "private-host.report.md"),
    "--target-marked-module", "PrivateHost.Consumer",
  ], { cwd: privateHost.directory, env: privateHost.env(), encoding: "utf8" }));
  const privateBytes = await readFile(privateOutput);
  const privateManifest = readIrPackageInfo(privateBytes).manifest;
  validateInterfaceManifest(privateManifest);
  assert.deepEqual(privateManifest.exports.map((entry) => entry.entry), ["PrivateHost.answer"]);
  const privateImport = privateManifest.hostImports.find((entry) => entry.target === "test.private.echo");
  assert.ok(privateImport);
  assert.match(privateImport.name, /^_private\.PrivateHost\.Owner\./);
  let privateCalls = 0;
  const privateFactory = createVirRuntimeFactory({
    wasmBytes,
    hostBindings: { "test.private.echo": (value) => { privateCalls++; return value; } },
  });
  const privateRuntime = await privateFactory.createRuntime({ irPackageSet: [privateBytes] });
  try {
    assert.equal(privateRuntime.call("PrivateHost.answer", "private value"), "private value");
    assert.equal(privateCalls, 1);
  } finally {
    privateRuntime.dispose();
  }

  // Direct Lean import defaults to legacy visibility unless the caller opts
  // into the module system. A compiled .olean alone must not be sufficient.
  const legacy = await createTestModuleProject({
    directory: join(scratch, "legacy-project"),
    modules: { LegacyInput: "def legacyAnswer : Nat := 42\n" },
  });
  success(legacy.build());
  for (const [name, diagnostic] of [
    ["LegacyInput", /cannot import non-`module` LegacyInput from `module`/],
    ["MissingInput", /unknown module prefix 'MissingInput'/],
  ]) {
    const output = join(scratch, `${name}.irpkg`);
    const result = spawnSync(
      virIrpkgPath,
      [output, join(scratch, `${name}.report.md`), "--target-all-module", name],
      { cwd: legacy.directory, env: legacy.env(), encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.ifError(result.error);
    assert.match(result.stdout + result.stderr, diagnostic);
    await assert.rejects(readFile(output), { code: "ENOENT" });
  }
  console.log(
    "module input smoke ok: selection, provenance, reuse, private host imports, no source re-elaboration, non-module and missing-module rejection",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
