/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { assert, generateIrPackage, join, readFile, spawnSync, writeRuntimeFixture } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-float-minmax-"));
let calls = 0;
try {
  const source = join(directory, "FloatMinMax.lean");
  const packagePath = join(directory, "float-minmax.irpkg");
  await writeRuntimeFixture(source, "FloatMinMax.lean");
  await generateIrPackage("FloatMinMax", source, packagePath, "marked");
  const native = spawnSync("lake", ["env", "lean", "--run", source], { encoding: "utf8" });
  assert.equal(native.status, 0, `${native.stdout}\n${native.stderr}`);
  const runtime = await createVirRuntime({
    wasmBytes: await readFile(new URL("../../web/public/vir-upstream.wasm", import.meta.url)),
    irPackageSet: [await readFile(packagePath)],
  });
  const call = (name, ...args) => { calls++; return runtime.call(`FloatMinMax.${name}`, ...args); };
  const view = new DataView(new ArrayBuffer(8));
  const fromBits = bits => { view.setBigUint64(0, bits); return view.getFloat64(0); };
  const toBits = number => { view.setFloat64(0, number); return view.getBigUint64(0); };
  const inputs = [
    0x7ff8000000000001n, 0x7ff0000000000001n, 0xfff8000000000001n,
    0xfff0000000000000n, 0xffefffffffffffffn, 0xbff0000000000000n,
    0x8000000000000001n, 0x8000000000000000n, 0n,
    1n, 0x3ff0000000000000n, 0x7fefffffffffffffn, 0x7ff0000000000000n,
  ];
  try {
    assert.equal(call("oracle", null), native.stdout.trim());
    for (const left of inputs) for (const right of inputs) {
      const a = fromBits(left), b = fromBits(right);
      for (const [name, expected] of [["minimum", Math.min(a, b)], ["maximum", Math.max(a, b)]]) {
        assert.equal(call(name, a, b), expected, `${name}(${left.toString(16)},${right.toString(16)})`);
        const bits = call(`${name}Bits`, left, right);
        if (Number.isNaN(expected)) {
          // Wasm may choose a NaN payload; propagation is the promised behavior.
          assert.equal(bits & 0x7ff0000000000000n, 0x7ff0000000000000n);
          assert.notEqual(bits & 0x000fffffffffffffn, 0n);
        } else {
          assert.equal(bits, toBits(expected));
        }
      }
    }
  } finally { runtime.dispose(); }
} finally { await rm(directory, { recursive: true, force: true }); }
console.log(`Float minimum/maximum smoke ok: native oracle and ${calls} Wasm calls`);
