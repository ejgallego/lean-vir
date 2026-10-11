/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { inspect } from "node:util";
import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { assert, generateIrPackage, join, readFile, writeRuntimeFixture } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-float-math-"));
let calls = 0;
try {
  const source = join(directory, "FloatMath.lean");
  const packagePath = join(directory, "float-math.irpkg");
  await writeRuntimeFixture(source, "FloatMath.lean");
  await generateIrPackage("FloatMath", source, packagePath, "marked");
  const runtime = await createVirRuntime({
    wasmBytes: await readFile(new URL("../../web/public/vir-upstream.wasm", import.meta.url)),
    irPackageSet: [await readFile(packagePath)],
  });
  const call = (name, ...args) => { calls++; return runtime.call(`FloatMath.${name}`, ...args); };
  const equal = (name, args, expected) =>
    assert.equal(call(name, ...args), expected, `${name}(${args.map(x => inspect(x)).join(", ")})`);
  const near = (name, args, expected) => {
    const actual = call(name, ...args);
    assert.ok(
      Number.isFinite(actual) && Math.abs(actual - expected) <= Math.abs(expected) * 2e-14,
      `${name}(${args.map(x => inspect(x)).join(", ")}): actual ${inspect(actual)}, expected approximately ${inspect(expected)}`,
    );
  };
  try {
    assert.equal(runtime.interfaceManifest.exports.length, 25);
    for (const [name, input, expected] of [
      ["exp", 1, Math.E], ["log", Math.E, 1], ["exp2", 3, 8],
      ["log10", 100, 2], ["tan", 0.5, Math.tan(0.5)],
      ["asin", 0.5, Math.asin(0.5)], ["atan", 1, Math.PI / 4],
    ]) near(name, [input], expected);
    equal("pow", [-2, 3], -8);
    equal("pow", [-2, 0.5], NaN);
    equal("pow", [-0, -3], -Infinity);
    equal("log", [0], -Infinity);
    equal("log", [-1], NaN);
    equal("exp", [-Infinity], 0);
    for (const x of [NaN, Infinity, -Infinity, 0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, 1, 1e40, -1e40]) {
      equal("isNaN", [x], Number.isNaN(x));
      equal("isFinite", [x], Number.isFinite(x));
      const x32 = Math.fround(x); // Arguments narrow before Lean receives them.
      equal("nan32", [x], Number.isNaN(x32));
      equal("finite32", [x], Number.isFinite(x32));
      equal("inf32", [x], Math.abs(x32) === Infinity);
    }
    for (const x of [-1.5, -0.5, -0, 0, 0.5, 1.5, Infinity, -Infinity]) {
      equal("ceil", [x], Math.ceil(x));
      equal("ceil32", [x], Math.ceil(x));
      equal("floor32", [x], Math.floor(x));
      equal("abs32", [x], Math.abs(x));
    }
    equal("sqrt32", [4], 2);
    equal("sqrt32", [-0], -0);
    equal("sqrt32", [-1], NaN);
    for (const [x, expected] of [[-1.5, -2], [-0.5, -1], [-0, -0], [0.5, 1], [1.5, 2]])
      equal("round32", [x], expected); // Lean/libm rounds ties away from zero.
    equal("bits", [-0], 1n << 63n);
    equal("bits", [1], 0x3ff0000000000000n);
    equal("bits32", [-0], 0x80000000);
    equal("bits32", [1], 0x3f800000);
    for (const x of [
      0, -0, 1 + 2 ** -24, 1 + 3 * 2 ** -24, -(1 + 2 ** -24), -(1 + 3 * 2 ** -24),
      2 ** -149, -(2 ** -149), 2 ** -150, -(2 ** -150), 1e40, -1e40,
    ])
      equal("narrow", [x], Math.fround(x));
    for (const x of [0, -0, 2 ** -149, 1 + 2 ** -23, 3.4028234663852886e38])
      equal("widen", [x], Math.fround(x));
    equal("fma", [1 + 2 ** -27, 1 - 2 ** -27, -1], -(2 ** -54));
    equal("fma32", [1 + 2 ** -13, 1 - 2 ** -13, -1], -(2 ** -26));
    equal("fma", [Infinity, 0, 1], NaN);
    equal("fma32", [Infinity, 0, 1], NaN);
  } finally { runtime.dispose(); }
} finally { await rm(directory, { recursive: true, force: true }); }
assert.ok(calls > 100);
console.log(`Float/Float32 math smoke ok: 25 marked exports, ${calls} actual-Wasm checks`);
