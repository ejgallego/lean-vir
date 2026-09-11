/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createJsValueHostBindings } from "../../web/src/host/vir-js-value-bindings.js";
import { createVirRuntime } from "../../web/src/vir-runtime.js";
import { assert, join, readFile, runVirIrpkg, spawnSync } from "./shared.mjs";

const root = new URL("../../", import.meta.url);
const output = fileURLToPath(new URL("build/runtime/js-nat-number/", root));
await mkdir(output, { recursive: true });
const built = spawnSync("lake", ["build", "+JsNatNumber"], {
  cwd: root, encoding: "utf8",
});
assert.equal(built.status, 0, built.stderr || built.stdout);

const entries = ["checked", "bigint", "roundtrip"].map((name) =>
  `Vir.Fixtures.JsNatNumber.${name}`);
const packagePath = join(output, "js-nat-number.irpkg");
const generated = runVirIrpkg([
  packagePath, join(output, "js-nat-number.report.md"),
  "--target-module", "JsNatNumber", ...entries,
]);
assert.equal(generated.status, 0, generated.stderr || generated.stdout);

const providers = createJsValueHostBindings();
const numberInputs = [];
const runtime = await createVirRuntime({
  wasmBytes: await readFile(new URL("web/public/vir-upstream.wasm", root)),
  irPackageSet: [await readFile(packagePath)],
  defaultHostBindings: {
    ...providers,
    // Observe the real conversion without replacing its behavior.
    "js.float": (value) => {
      numberInputs.push(value);
      return providers["js.float"](value);
    },
  },
});

try {
  assert.deepEqual(runtime.interfaceManifest.exports.map((entry) => entry.entry).sort(),
    [...entries].sort());
  assert.deepEqual(runtime.interfaceManifest.hostImports.map((entry) => entry.target).sort(),
    ["js.float", "js.nat", "js.nat.value"]);
  for (const value of [0n, 1n, 9007199254740991n]) {
    const callsBefore = numberInputs.length;
    const result = runtime.call(entries[0], value.toString());
    assert.equal(typeof result, "number");
    assert.ok(Number.isSafeInteger(result));
    assert.equal(BigInt(result), value);
    assert.equal(JSON.stringify({ value: result }), `{"value":${value}}`);
    assert.deepEqual(numberInputs.slice(callsBefore), [result]);
  }
  for (const value of [9007199254740992n, 9007199254740993n, 2n ** 256n - 1n]) {
    const callsBefore = numberInputs.length;
    // Structural Option results lift as the inner value or null.
    assert.equal(runtime.call(entries[0], value.toString()), null);
    assert.equal(numberInputs.length, callsBefore, "overflow must not call js.float");
  }
  for (const value of [0n, 9007199254740993n, 2n ** 256n - 1n]) {
    const result = runtime.call(entries[1], value.toString());
    assert.equal(typeof result, "bigint");
    assert.equal(result, value);
    assert.equal(runtime.call(entries[2], value.toString()), value.toString());
    assert.throws(() => JSON.stringify({ value: result }), TypeError);
  }
  assert.equal(numberInputs.length, 3);
} finally {
  runtime.dispose();
}

console.log("js-nat-number smoke ok: exact safe numbers, checked overflow, unchanged BigInt");
