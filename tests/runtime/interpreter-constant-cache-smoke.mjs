/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import {
  publicArtifactPath,
  wasmPublicFile,
} from "../../scripts/packages/browser-package-config.mjs";
import {
  assert,
  ensureVirJsBuilt,
  join,
  readFile,
  runVirIrpkg,
  writeRuntimeFixture,
} from "./shared.mjs";

const wasmBytes = await readFile(
  new URL(`../../${publicArtifactPath(wasmPublicFile)}`, import.meta.url),
);
const freshDir = await mkdtemp(join(tmpdir(), "lean-vir-constant-cache-"));
const source = join(freshDir, "InterpreterConstantCache.lean");
const packagePath = join(freshDir, "interpreter-constant-cache.irpkg");
const reportPath = join(freshDir, "interpreter-constant-cache.report.md");
let runtime = null;

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
  assert.ok(
    second.timings.executeMs * 4 < first.timings.executeMs,
    `${label} warm call should avoid rebuilding the dense table: ` +
      `first=${first.timings.executeMs.toFixed(3)}ms second=${second.timings.executeMs.toFixed(3)}ms`,
  );
}

try {
  ensureVirJsBuilt();
  await writeRuntimeFixture(source, "InterpreterConstantCache.lean");
  const generated = runVirIrpkg([
    packagePath,
    reportPath,
    "--target-marked",
    source,
  ]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const packageBytes = await readFile(packagePath);
  runtime = await createVirRuntimeFactory({ wasmBytes }).createRuntime({
    irPackageSetBytes: [packageBytes],
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

  runtime.loadIrPackageSetBytes([packageBytes]);
  assert.equal(
    firstCell.live,
    false,
    "replacement must release the old first cell",
  );
  assert.equal(
    secondCell.live,
    false,
    "replacement must release the old second cell",
  );

  const replacementFirst = runtime.callTimed(
    "Vir.Fixtures.InterpreterConstantCache.denseTableHandle",
  );
  const replacementSecond = runtime.callTimed(
    "Vir.Fixtures.InterpreterConstantCache.denseTableHandle",
  );
  assertWarmCache(replacementFirst, replacementSecond, "replacement package");

  console.log(
    "interpreter constant cache smoke ok: " +
      `initial=${first.timings.executeMs.toFixed(3)}/${second.timings.executeMs.toFixed(3)}ms ` +
      `replacement=${replacementFirst.timings.executeMs.toFixed(3)}/` +
      `${replacementSecond.timings.executeMs.toFixed(3)}ms`,
  );
} finally {
  try {
    runtime?.dispose();
  } finally {
    await rm(freshDir, { recursive: true, force: true });
  }
}
