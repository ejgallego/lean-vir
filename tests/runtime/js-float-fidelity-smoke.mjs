/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import { createCommonHostBindings } from "../../web/src/vir-host-bindings.js";
import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { createCallbackHostBindings, readRuntimeArtifacts } from "./shared.mjs";

const floatCases = [
  1.5,
  -42.25,
  Number.MIN_VALUE,
  Number.MAX_VALUE,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  0,
  -0,
];

{
  const positiveZero = 0;
  const negativeZero = -0;
  assert.equal(Object.is(negativeZero, positiveZero), false);
  assert.equal(Object.is(0, positiveZero), true);
  assert.equal(Object.is(-0, negativeZero), true);

  const nan = Number.NaN;
  assert.equal(Object.is(Number.NaN, nan), true);
}

{
  const { wasmBytes, hostPackageBytes } = await readRuntimeArtifacts();
  const runtime = await createVirRuntime({
    wasmBytes,
    irPackageSet: [hostPackageBytes],
    hostBindings: createCallbackHostBindings(),
  });
  try {
    for (const expected of floatCases) {
      assertSameFloat(
        runtime.call("HostInterop.floatRoundTrip", expected),
        expected,
        `Lean Float -> Js Float -> Lean Float (${floatLabel(expected)})`,
      );
    }
  } finally {
    runtime.dispose();
  }
}

{
  const bindings = createCommonHostBindings();
  assert.throws(
    () => bindings["js.float"]("1.5"),
    /js\.float expects a number/,
  );
  const stringResource = "1.5";
  assert.throws(
    () => bindings["js.float.value"](stringResource),
    /js\.float\.value expects a JS number/,
  );

  for (const expected of floatCases) {
    const encoded = bindings["js.float"](expected);
    assertSameFloat(
      encoded,
      expected,
      `Float -> Js Float (${floatLabel(expected)})`,
    );
    assertSameFloat(
      bindings["js.float.value"](encoded),
      expected,
      `Float -> Js Float -> Float (${floatLabel(expected)})`,
    );

    const jsValue = expected;
    const decoded = bindings["js.float.value"](jsValue);
    const reencoded = bindings["js.float"](decoded);
    assertSameFloat(
      reencoded,
      expected,
      `Js Float -> Float -> Js Float (${floatLabel(expected)})`,
    );
  }
}

function assertSameFloat(actual, expected, label) {
  assert.ok(
    Object.is(actual, expected),
    `${label}: expected ${floatLabel(expected)}, got ${floatLabel(actual)}`,
  );
}

function floatLabel(value) {
  if (Number.isNaN(value)) return "NaN";
  if (Object.is(value, -0)) return "-0";
  if (value === Number.POSITIVE_INFINITY) return "+Infinity";
  return String(value);
}
