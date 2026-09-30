/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { assert, createRuntimeModuleProject, join, readFile } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-startup-reentry-"));
try {
  const project = await createRuntimeModuleProject(join(directory, "modules"), {
    StartupReentry: `module
meta import Vir.Attributes
public import Vir.Js
public section
open Lean.Vir
namespace StartupReentry
@[vir_js "startup.record"] opaque record (stage : Js String) : RuntimeM Unit
@[vir_startup] def first : RuntimeM Unit := do
  record (← JsValue.ofString "first.enter")
  record (← JsValue.ofString "first.exit")
@[vir_startup] def second : RuntimeM Unit := do
  record (← JsValue.ofString "second")
end StartupReentry`,
  });
  const built = project.build();
  assert.equal(built.status, 0, `${built.stderr}\n${built.stdout}`);
  const packagePath = join(directory, "startup.irpkg");
  const generated = project.runVirIrpkg([
    packagePath, join(directory, "startup.report.md"),
    "--target-marked-module", "StartupReentry",
  ]);
  assert.equal(generated.status, 0, `${generated.stderr}\n${generated.stdout}`);
  const calls = [];
  const failure = new Error("recoverable startup effect failure");
  let failSecond = true;
  let reentered = false;
  let runtime;
  runtime = await createVirRuntime({
    wasmBytes: await readFile(new URL("../../web/public/vir-upstream.wasm", import.meta.url)),
    irPackageSet: [await readFile(packagePath)],
    hostBindings: {
      "startup.record": (stage) => {
        calls.push(stage);
        if (stage === "first.enter" && !reentered) {
          reentered = true;
          // A host callback can capture a runtime once creation has resolved.
          runtime.runStartupEntries();
        }
        if (stage === "second" && failSecond) throw failure;
      },
    },
  });
  try {
    assert.throws(() => runtime.runStartupEntries(), error => error === failure);
    assert.equal(reentered, true, "the regression must reach synchronous host reentry");
    assert.equal(runtime.failure, null, "an IO failure must remain recoverable");
    assert.deepEqual(calls, ["first.enter", "first.exit", "second"]);
    failSecond = false;
    runtime.runStartupEntries();
    assert.deepEqual(calls, ["first.enter", "first.exit", "second", "second"]);
    runtime.runStartupEntries();
    assert.equal(calls.length, 4, "successful hooks must not run again");
  } finally {
    runtime.dispose();
  }
  console.log("real-Wasm startup host reentry, order and recoverable retry smoke ok");
} finally {
  await rm(directory, { recursive: true, force: true });
}
