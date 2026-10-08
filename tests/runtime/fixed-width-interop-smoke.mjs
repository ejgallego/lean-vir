/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import { countLiveCallbacks } from "../support/lean-ownership.js";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { assert, createRuntimeModuleProject, join, readFile } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-fixed-width-"));
try {
  const project = await createRuntimeModuleProject(join(directory, "modules"), {
    FixedWidthTransport: await readFile(new URL("../../fixtures/runtime/FixedWidthTransport.lean", import.meta.url), "utf8"),
  });
  const built = project.build();
  assert.equal(built.status, 0, `${built.stderr}\n${built.stdout}`);
  const packagePath = join(directory, "fixed-width.irpkg");
  const generated = project.runVirIrpkg([
    packagePath, join(directory, "fixed-width.report.md"),
    "--target-marked-module", "FixedWidthTransport",
  ]);
  assert.equal(generated.status, 0, `${generated.stderr}\n${generated.stdout}`);

  const max64 = (1n << 64n) - 1n;
  const max32 = (1n << 32n) - 1n;
  const expected = { wide: [0n, 1n << 63n, max64], indices: [0, Number(1n << 31n), Number(max32)] };
  let rejectHostResult = null;
  let conversions = 0;
  const runtime = await createVirRuntime({
    wasmBytes: await readFile(new URL("../../web/public/vir-upstream.wasm", import.meta.url)),
    irPackageSet: [await readFile(packagePath)],
    hostBindings: {
      "test.fixedWidth.toJs": value => {
        conversions++;
        assert.deepEqual(value, expected);
        return value;
      },
      "test.fixedWidth.fromJs": value => rejectHostResult === "wide"
        ? { ...value, wide: [0n, max64 + 1n] }
        : rejectHostResult === "indices" ? { ...value, indices: [0n, max32 + 1n] } : value,
    },
  });
  try {
    assert.ok(runtime.interfaceManifest.hostImports.every(entry => entry.boundary === "explicitConversion"));
    const wide = runtime.call("wideCallback", 1);
    const index = runtime.call("indexCallback", 1);
    for (const [callback, max, high, resultType] of [
      [wide, max64, 1n << 63n, "bigint"], [index, max32, 1n << 31n, "number"],
    ]) {
      for (const input of [0n, high, max]) {
        const result = callback(input);
        assert.equal(result, resultType === "number" ? Number((input + 1n) & max) : (input + 1n) & max);
        assert.equal(typeof result, resultType);
      }
      for (const input of [-1n, max + 1n]) assert.throws(() => callback(input), /non-negative|out of range/);
      assert.equal(callback(max), resultType === "number" ? 0 : 0n);
    }
    const huge = (1n << 256n) + 3n;
    const nat = runtime.call("natCallback", 1);
    const int = runtime.call("intCallback", 1);
    for (const input of [0n, huge, huge.toString()]) {
      assert.equal(nat(input), BigInt(input) + 1n);
      assert.equal(int(input), BigInt(input) + 1n);
    }
    assert.equal(int(-huge), 1n - huge);
    assert.throws(() => nat(-1n), /non-negative/);
    for (const fn of [wide, index, nat, int]) {
      runtime.releaseLeanObjectHandleCell(runtime.leanCallbackCell(fn, "numeric callback"));
    }
    assert.equal(countLiveCallbacks(runtime.hostState), 0);
    assert.throws(() => wide(0), /disposed runtime/);
    assert.throws(() => nat(0), /disposed runtime/);

    const input = { wide: [0n, 1n << 63n, max64], indices: [0n, 1n << 31n, max32] };
    const roots = runtime.hostState.resourceRootCounts().active;
    assert.deepEqual(runtime.call("payloadRoundtrip", input), expected);
    assert.equal(runtime.hostState.resourceRootCounts().active, roots);
    for (const [field, constructor, typeName] of [
      ["wide", "vir_obj_uint64_scalar", "UInt64"],
      ["indices", "vir_obj_usize_scalar", "USize"],
    ]) {
      rejectHostResult = field;
      const original = runtime.exports;
      const created = [];
      const released = [];
      runtime.exports = { ...original,
        [constructor]: value => {
          const object = original[constructor](value);
          created.push(object);
          return object;
        },
        vir_obj_dec: object => { released.push(object); original.vir_obj_dec(object); },
      };
      try {
        assert.throws(() => runtime.call("payloadRoundtrip", input), new RegExp(`out of range for ${typeName}`));
        // The last valid zero box in the rejected host array is released directly.
        // Earlier argument boxes are consumed by the interpreter, not by JS.
        const lastBox = created.at(-1);
        assert.ok(lastBox > 0);
        assert.equal(released.filter(object => object === lastBox).length, 1);
      } finally {
        runtime.exports = original;
      }
      assert.equal(runtime.failure, null);
      assert.equal(runtime.hostState.resourceRootCounts().active, roots);
    }
    rejectHostResult = null;
    assert.deepEqual(runtime.call("payloadRoundtrip", input), expected);
    assert.equal(conversions, 4);
  } finally {
    runtime.dispose();
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("fixed-width interop smoke ok: compiler-produced callbacks and explicit host conversions");
