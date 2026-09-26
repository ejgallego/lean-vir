/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { releaseCallbackRoots } from "../../web/src/runtime/callbacks.js";
import {
  publicArtifactPath,
  wasmPublicFile,
} from "../../scripts/packages/browser-package-config.mjs";
import {
  assert,
  generateIrPackage,
  join,
  readFile,
  writeRuntimeFixture,
} from "./shared.mjs";

const wasmBytes = await readFile(
  process.argv[2] ??
    new URL(`../../${publicArtifactPath(wasmPublicFile)}`, import.meta.url),
);
const freshDir = await mkdtemp(join(tmpdir(), "lean-vir-constant-cache-"));
const source = join(freshDir, "InterpreterConstantCache.lean");
const packagePath = join(freshDir, "interpreter-constant-cache.irpkg");
let runtime = null;
const callbacks = [];

function assertCallbackCache(label) {
  const install =
    "Vir.Fixtures.InterpreterConstantCache.installDenseTableCallback";
  runtime.call(install);
  runtime.call(install);
  assert.equal(callbacks.length, 2);
  const first = callbacks[0](0n);
  const second = callbacks[1](0n);
  const firstCell = liveObjectCell(first, `${label} first callback result`);
  const secondCell = liveObjectCell(second, `${label} second callback result`);
  const pointer = firstCell.object;
  assert.equal(
    secondCell.object,
    pointer,
    `${label} independent callbacks share the cached constant`,
  );

  // Keep firstCell as a live identity witness so allocator address reuse cannot
  // disguise reconstruction. Explicit internal releases make cleanup deterministic.
  runtime.releaseLeanObjectHandleCell(secondCell);
  assert.equal(secondCell.live, false);
  releaseCallbackRoots([callbacks.shift()]);
  assert.equal(runtime.liveCallbacks.size, 1);
  const surviving = callbacks[0](0n);
  const survivingCell = liveObjectCell(
    surviving,
    `${label} surviving callback result`,
  );
  assert.equal(
    survivingCell.object,
    pointer,
    `${label} releasing a result and one callback preserves the cache`,
  );
  releaseCallbackRoots(callbacks);
  runtime.releaseLeanObjectHandleCell(survivingCell);
  assert.equal(runtime.liveCallbacks.size, 0);
  const named = runtime.call(
    "Vir.Fixtures.InterpreterConstantCache.denseTableHandle",
  );
  const namedCell = liveObjectCell(named, `${label} named result after callbacks`);
  assert.equal(
    namedCell.object,
    pointer,
    `${label} named entry shares the callback-populated cache`,
  );
  runtime.releaseLeanObjectHandleCell(namedCell);
  assert.equal(liveObjectCell(first, `${label} identity witness`), firstCell);
  runtime.releaseLeanObjectHandleCell(firstCell);
  assert.equal(firstCell.live, false);
  assert.equal(runtime.hostState.leanObjectHandleCells.size, 0);
}

function liveObjectCell(resource, label) {
  assert.ok(resource !== null, `${label} must be a live JSL value`);
  const cell = runtime.leanObjectHandleCell(resource, label);
  assert.equal(cell.live, true, `${label} Lean object cell must be live`);
  assert.ok(
    Number.isInteger(cell.object) && cell.object > 0,
    `${label} must retain a Lean object`,
  );
  return cell;
}

function assertWarmCache(first, second, label) {
  assert.equal(
    liveObjectCell(second.value, `${label} second handle`).object,
    liveObjectCell(first.value, `${label} first handle`).object,
    `${label} calls must retain the same cached nullary object`,
  );
}

try {
  await writeRuntimeFixture(source, "InterpreterConstantCache.lean");
  await generateIrPackage("InterpreterConstantCache", source, packagePath, "marked");
  const packageBytes = await readFile(packagePath);
  const factory = createVirRuntimeFactory({
    wasmBytes,
    hostBindings: {
      "test.retainDenseTableCallback": callback => {
        callbacks.push(callback);
      },
    },
  });
  runtime = await factory.createRuntime({
    irPackageSet: [packageBytes],
  });

  assertCallbackCache("initial package");
  runtime.dispose();
  runtime = await factory.createRuntime({
    irPackageSet: [packageBytes],
  });

  const first = runtime.callTimed(
    "Vir.Fixtures.InterpreterConstantCache.denseTableHandle",
  );
  const second = runtime.callTimed(
    "Vir.Fixtures.InterpreterConstantCache.denseTableHandle",
  );
  assertWarmCache(first, second, "initial package");
  const firstCell = liveObjectCell(first.value, "initial package first handle");
  const secondCell = liveObjectCell(
    second.value,
    "initial package second handle",
  );
  assert.equal(
    runtime.call(
      "Vir.Fixtures.InterpreterConstantCache.denseLookupValue",
      32770,
    ),
    "1",
    "the packaged implementation must use the dense-table implemented_by body",
  );

  const previousRuntime = runtime;
  runtime = await factory.createRuntime({
    irPackageSet: [packageBytes],
  });
  previousRuntime.dispose();
  assert.equal(
    firstCell.live,
    false,
    "disposing the previous generation releases the old first cell",
  );
  assert.equal(
    secondCell.live,
    false,
    "disposing the previous generation releases the old second cell",
  );

  assertCallbackCache("fresh package generation");

  const replacementFirst = runtime.callTimed(
    "Vir.Fixtures.InterpreterConstantCache.denseTableHandle",
  );
  const replacementSecond = runtime.callTimed(
    "Vir.Fixtures.InterpreterConstantCache.denseTableHandle",
  );
  assertWarmCache(replacementFirst, replacementSecond, "replacement package");

  console.log(
    "interpreter constant cache smoke ok: callback identity/release/generation; " +
      `initial=${first.timings.executeMs.toFixed(3)}/${second.timings.executeMs.toFixed(3)}ms ` +
      `replacement=${replacementFirst.timings.executeMs.toFixed(3)}/` +
      `${replacementSecond.timings.executeMs.toFixed(3)}ms`,
  );
} finally {
  try {
    const hostState = runtime?.hostState;
    runtime?.dispose();
    if (runtime !== null) {
      assert.equal(runtime.liveCallbacks.size, 0);
      assert.equal(hostState.leanObjectHandleCells.size, 0);
    }
  } finally {
    await rm(freshDir, { recursive: true, force: true });
  }
}
