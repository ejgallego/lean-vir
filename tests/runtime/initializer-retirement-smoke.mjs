/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import { countLiveCallbacks } from "../support/lean-ownership.js";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import {
  IR_PACKAGE_SECTION,
  readIrPackageInfo,
} from "../../scripts/packages/irpkg-format.mjs";
import { assert, createRuntimeModuleProject, join, readFile } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-initializer-retirement-"));
try {
  const project = await createRuntimeModuleProject(join(directory, "modules"), {
    InitializerRetirement: `module
meta import Vir.Attributes
public import Vir.Js
public section
open Lean.Vir
namespace InitializerRetirement
@[vir_export] def retainFirstValue : Unit := ()
@[vir_export] def failSecondValue : Unit := ()
@[vir_js "retirement.retain"] opaque retainHandle
    (handle : JSL (Unit → Nat)) : RuntimeM Unit
@[vir_js "retirement.shouldFail"] opaque shouldFail : RuntimeM (Js Bool)
@[vir_export] def retainFirst : IO Unit := RuntimeM.run do
  let handle ← LeanRef.toJSL (fun (_ : Unit) => 17)
  retainHandle handle
@[vir_export] def failSecond : IO Unit := do
  let flag ← shouldFail.run
  if ← (JsValue.toBool flag).run then throw (IO.userError "initializer IO failure")
@[vir_export] def consume (handle : JSL (Unit → Nat)) : RuntimeM Nat := do
  let closure ← LeanRef.fromJSL handle
  pure (closure ())
end InitializerRetirement`,
  });
  const built = project.build();
  assert.equal(built.status, 0, `${built.stderr}\n${built.stdout}`);

  const packagePath = join(directory, "initializer-retirement.irpkg");
  const generated = project.runVirIrpkg([
    packagePath,
    join(directory, "initializer-retirement.report.md"),
    "--target-marked-module",
    "InitializerRetirement",
  ]);
  assert.equal(generated.status, 0, `${generated.stderr}\n${generated.stdout}`);

  const packageBytes = await appendInitializers(
    await readFile(packagePath),
    "InitializerRetirement.retainFirst",
    "InitializerRetirement.failSecond",
  );
  let failNextInitializer = true;
  let failedRuntime = null;
  let stateBeforeFailure = null;
  const retainedHandles = [];
  const factory = createVirRuntimeFactory({
    wasmBytes: await readFile(
      process.argv[2] ?? new URL("../../web/public/vir-upstream.wasm", import.meta.url),
    ),
    hostBindings: {
      "retirement.retain": (handle) => { retainedHandles.push(handle); },
      "retirement.shouldFail": () => {
        if (failNextInitializer) {
          failNextInitializer = false;
          stateBeforeFailure = {
            callbacks: countLiveCallbacks(failedRuntime.hostState),
            objectHandles: failedRuntime.hostState.leanObjectHandleCells.size,
          };
          return true;
        }
        return false;
      },
    },
  });

  failedRuntime = await factory.createRuntime();
  try {
    assert.throws(
      () => failedRuntime.loadIrPackageSetBytes([packageBytes]),
      /initializer failed for `InitializerRetirement\.failSecondValue` via `InitializerRetirement\.failSecond`:.*initializer IO failure/,
    );
    assert.deepEqual(stateBeforeFailure, { callbacks: 0, objectHandles: 1 },
      "the first initializer must export a JSL root containing its Lean closure");
    assert.equal(retainedHandles.length, 1);
    const escapedHandle = retainedHandles[0];
    assert.equal(failedRuntime.failure instanceof Error, true,
      "an initializer that has started and failed must retire its interpreter");
    assert.throws(
      () => failedRuntime.loadIrPackageSetBytes([packageBytes]),
      /fresh runtime/,
      "a failed initializer must not permit a replacement package install",
    );
    assert.throws(
      () => failedRuntime.call("InitializerRetirement.consume", escapedHandle),
      /fresh runtime/,
      "the failed interpreter cannot revalidate its escaped JSL closure",
    );
    assert.throws(() => failedRuntime.retainLeanObjectHandleValue(escapedHandle, "escaped initializer handle"),
      /fresh runtime/, "direct handle retention cannot re-enter the failed instance");
    assert.equal(retainedHandles.length, 1,
      "rejected reinstall must not run the initializer or retain a second handle");

    const freshRuntime = await factory.createRuntime({ irPackageSet: [packageBytes] });
    try {
      assert.equal(retainedHandles.length, 2,
        "a fresh interpreter can complete the initializer sequence");
      assert.equal(countLiveCallbacks(freshRuntime.hostState), 0,
        "the retained value is a JSL handle rather than a converted JS callback");
      assert.equal(freshRuntime.call("InitializerRetirement.consume", retainedHandles[1]), 17n);
      assert.throws(
        () => freshRuntime.call("InitializerRetirement.consume", escapedHandle),
        /live Lean object handle resource/,
        "a new interpreter cannot revalidate the retired interpreter's JSL handle",
      );
      assert.equal(freshRuntime.call("InitializerRetirement.consume", retainedHandles[1]), 17n,
        "rejecting the stale handle leaves the fresh interpreter usable");
    } finally {
      freshRuntime.dispose();
    }
  } finally {
    failedRuntime.dispose();
  }
  console.log("real-Wasm initializer failure retires escaped Lean closure handles; fresh factory runtime succeeds");
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function appendInitializers(input, ...entries) {
  const info = readIrPackageInfo(input);
  const sectionIndex = info.package.sections.findIndex(
    (section) => section.kind === IR_PACKAGE_SECTION.INIT_GLOBALS,
  );
  assert.notEqual(sectionIndex, -1, "IR package must have an initializer section");
  const section = info.package.sections[sectionIndex];
  const old = input.subarray(section.offset, section.offset + section.byteLength);
  const oldCount = new DataView(old.buffer, old.byteOffset).getUint32(0, true);
  const contents = Uint8Array.from([
    ...u32(oldCount + entries.length),
    ...old.subarray(4),
    ...entries.flatMap(entry => [...encodeName(`${entry}Value`), ...encodeName(entry)]),
  ]);
  const result = Uint8Array.from([...input, ...contents]);
  const view = new DataView(result.buffer);
  const entryOffset = 4 + view.getUint32(0, true) + 4 + 8 + 12 * sectionIndex;
  view.setUint32(entryOffset + 4, input.length, true);
  view.setUint32(entryOffset + 8, contents.length, true);
  return result;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function encodeName(name) {
  let encoded = [0];
  for (const part of name.split(".")) {
    const text = new TextEncoder().encode(part);
    encoded = [1, ...encoded, ...u32(text.length), ...text];
  }
  return encoded;
}
