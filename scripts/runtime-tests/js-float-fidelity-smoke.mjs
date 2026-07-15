/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  createCommonHostBindings,
  createHostResourceState,
} from "../../web/src/vir-host-bindings.js";
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
  const resources = createHostResourceState();
  const positiveZero = resources.resourceForValue(0);
  const negativeZero = resources.resourceForValue(-0);
  assert.notEqual(negativeZero, positiveZero, "signed zero must use distinct host resources");
  assert.equal(resources.resourceForValue(0), positiveZero);
  assert.equal(resources.resourceForValue(-0), negativeZero);
  assert.ok(Object.is(resources.resolveResource(positiveZero, "Js Float"), 0));
  assert.ok(Object.is(resources.resolveResource(negativeZero, "Js Float"), -0));

  const nan = resources.resourceForValue(Number.NaN);
  assert.equal(resources.resourceForValue(Number.NaN), nan);
  assert.deepEqual(resources.debugResourceCounts(), {
    live: 3,
    primitives: 3,
    temporaryScopes: 0,
    disposables: 0,
  });

  resources.releaseValueResource(-0);
  assert.throws(() => resources.resolveResource(negativeZero, "Js Float"), /resource is not live/);
  assert.ok(Object.is(resources.resolveResource(positiveZero, "Js Float"), 0));
  assert.deepEqual(resources.debugResourceCounts(), {
    live: 2,
    primitives: 2,
    temporaryScopes: 0,
    disposables: 0,
  });

  resources.dispose();
  assert.deepEqual(resources.debugResourceCounts(), {
    live: 0,
    primitives: 0,
    temporaryScopes: 0,
    disposables: 0,
  });
}

{
  const { wasmBytes, hostPackageBytes } = await readRuntimeArtifacts();
  const runtime = await createVirRuntime({
    wasmBytes,
    irPackageBytes: hostPackageBytes,
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
  const resources = createHostResourceState();
  const bindings = createCommonHostBindings(resources);
  try {
    assert.throws(() => bindings["js.float"]("1.5"), /js\.float expects a number/);
    const stringResource = resources.resourceForValue("1.5");
    assert.throws(
      () => bindings["js.float.value"](stringResource),
      /js\.float\.value expects a JS number/,
    );

    for (const expected of floatCases) {
      const encoded = bindings["js.float"](expected);
      assertSameFloat(
        resources.resolveResource(encoded, "Js Float"),
        expected,
        `Float -> Js Float (${floatLabel(expected)})`,
      );
      assertSameFloat(
        bindings["js.float.value"](encoded),
        expected,
        `Float -> Js Float -> Float (${floatLabel(expected)})`,
      );

      const jsValue = resources.resourceForValue(expected);
      const decoded = bindings["js.float.value"](jsValue);
      const reencoded = bindings["js.float"](decoded);
      assertSameFloat(
        resources.resolveResource(reencoded, "Js Float"),
        expected,
        `Js Float -> Float -> Js Float (${floatLabel(expected)})`,
      );
    }
  } finally {
    resources.dispose();
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
