/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { assert, generateIrPackage, join, readFile, spawnSync, writeRuntimeFixture } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-primitives-"));
let calls = 0;
try {
  const source = join(directory, "Primitives.lean");
  const packagePath = join(directory, "primitives.irpkg");
  await writeRuntimeFixture(source, "Primitives.lean");
  await generateIrPackage("Primitives", source, packagePath, "marked");
  const native = spawnSync("lake", ["env", "lean", "--run", source], { encoding: "utf8" });
  assert.equal(native.status, 0, `${native.stdout}\n${native.stderr}`);
  const runtime = await createVirRuntime({
    wasmBytes: await readFile(new URL("../../web/public/vir-upstream.wasm", import.meta.url)),
    irPackageSet: [await readFile(packagePath)],
  });
  const call = (name, ...args) => { calls++; return runtime.call(`Primitives.${name}`, ...args); };
  try {
    assert.equal(call("oracle", null), native.stdout.trim());
    for (const bytes of [new Uint8Array(), Uint8Array.of(0), Uint8Array.of(0, 128, 255),
      Uint8Array.from({ length: 4096 }, (_, i) => i & 255)]) {
      assert.equal(call("byteSize", bytes), bytes.length);
      for (const index of [0, bytes.length - 1, bytes.length, 0x80000000, 0xffffffff].filter(i => i >= 0)) {
        const expected = bytes.slice();
        if (index < expected.length) expected[index] = 42;
        assert.deepEqual(call("byteSet", bytes, index, 42), expected);
        const shared = call("byteSetShared", bytes, index, 42);
        assert.deepEqual(shared, { fst: bytes, snd: expected });
      }
      assert.equal(call("byteEqual", bytes, bytes.slice()), true);
      assert.equal(call("byteEqual", bytes, Uint8Array.from([...bytes, 1])), false);
    }
    assert.equal(call("byteEqual", Uint8Array.of(1, 2, 3), Uint8Array.of(1, 4, 3)), false);
    assert.equal(call("byteEqual", Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4)), false);
    for (const value of [0, 1, 128, 255])
      assert.deepEqual(call("byteSetFresh", value), Uint8Array.of(value, value, 3));
    for (const value of [NaN, -Infinity, -1e100, -1.9, -Number.MIN_VALUE, -0, 0,
      Number.MIN_VALUE, 1.9, 254.9, 255, 255.9, 256, 1e100, Infinity]) {
      const expected = value >= 0 ? (value < 256 ? Math.trunc(value) : 255) : 0;
      assert.equal(call("floatByte", value), expected === 0 ? 0 : expected);
    }
    const min = -(1n << 63n), max = (1n << 63n) - 1n;
    for (const value of [NaN, -Infinity, -1e100, -(2 ** 63), -(2 ** 63) + 1024,
      -1.9, -Number.MIN_VALUE, -0, 0, Number.MIN_VALUE, 1.9,
      2 ** 63 - 1024, 2 ** 63, 1e100, Infinity]) {
      const expected = Number.isNaN(value) ? 0n : value <= -(2 ** 63) ? min
        : value >= 2 ** 63 ? max : BigInt(Math.trunc(value));
      assert.equal(call("floatInt", value), expected);
    }
    for (const value of [0n, 1n, 65n, 0xD7FFn, 0xD800n, 0xDFFFn, 0xE000n,
      0xFFFFn, 0x10000n, 0x10FFFFn, 0x110000n, 1n << 32n, (1n << 256n) + 65n]) {
      const valid = value < 0xD800n || (value > 0xDFFFn && value < 0x110000n);
      assert.equal(call("charValue", value), valid ? value : 0n);
      assert.equal(call("uintValue", value), Number(value & 0xffffffffn));
    }
    // Repeated calls catch stale shared-array writes and boxed argument lifetime errors.
    for (let i = 0; i < 128; i++) {
      const bytes = Uint8Array.of(1, 2, 3);
      assert.deepEqual(call("byteSetShared", bytes, 1, i), { fst: bytes, snd: Uint8Array.of(1, i, 3) });
      assert.equal(call("charValue", 0x10FFFFn), 0x10FFFFn);
    }
  } finally { runtime.dispose(); }
} finally { await rm(directory, { recursive: true, force: true }); }
console.log(`primitive smoke ok: six providers, native/Wasm oracle and ${calls} Wasm calls`);
