/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { createInfoviewHostBindings } from "../../web/src/host/vir-infoview-host-bindings.js";

/** Exercise the actual object ABI and interpreted ToJson/FromJson instances. */
export async function checkJsonValueCodec(wasmBytes, irPackage) {
  const runtime = await createVirRuntime({
    wasmBytes, irPackageSet: [irPackage], hostBindings: createInfoviewHostBindings(),
  });
  const call = (name, ...args) => runtime.call(`JsonValueCodec.${name}`, ...args);
  let cases = 0;
  try {
    for (const value of [null, true, false, "", "λ😀", 0, -1,
      Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER,
      { p: "hello" }, { __rpcref: "ordinary" }, { nested: [{ p: "7" }] },
      { nested: [{ empty: {}, value: null }], option: ["constructor", 3] }]) {
      assert.deepEqual(call("copy", value), { kind: "ok", value });
      cases++;
    }
    const sample = call("sampleWire");
    assert.equal(sample.kind, "ok");
    assert.deepEqual(call("roundtripFoo", sample.value), sample);
    assert.equal(call("roundtripFoo", { ...sample.value, rows: false }).kind, "error");
    const reply = Object.freeze(sample.value);
    const pending = Promise.resolve(reply);
    const options = { abortSignal: new AbortController().signal };
    const session = {
      call(method, params, receivedOptions) {
        assert.equal(this, session);
        assert.equal(method, "echo");
        assert.deepEqual(params, sample.value);
        assert.equal(receivedOptions, options);
        return pending;
      },
    };
    const request = call("call", session, "echo", sample.value.title, options, 7);
    assert.equal(request.kind, "ok");
    assert.equal(request.value, pending, "RPC returns the exact native Promise");
    assert.equal(await request.value, reply, "the reply is not decoded or wrapped by RPC");
    const summarize = call("resultSummary");
    assert.equal(typeof summarize, "function");
    assert.equal(await request.value.then(summarize), "shared Foo:7:1");
    assert.match(await Promise.resolve({ ...reply, rows: false }).then(summarize), /^error:/);
    const rejection = { reason: "transport" };
    await assert.rejects(Promise.reject(rejection).then(summarize), error => error === rejection);
    for (const [mantissa, exponent, value] of [
      [9007199254740991n, 0, 9007199254740991],
      [-9007199254740991n, 0, -9007199254740991],
      [100n, 2, 1], [-100n, 2, -1], [0n, 1000000, 0],
    ]) {
      assert.deepEqual(call("integerWire", mantissa, exponent), { kind: "ok", value });
      cases++;
    }
    for (const [mantissa, exponent] of [
      [9007199254740992n, 0], [-9007199254740992n, 0],
      [15n, 1], [-15n, 1], [1n, 1000000],
    ]) {
      assert.equal(call("integerWire", mantissa, exponent).kind, "error");
      cases++;
    }
    const cycle = {}; cycle.self = cycle;
    const handle = call("leanHandle");
    for (const value of [undefined, () => {}, 1n, Symbol("x"), new Date(),
      NaN, Infinity, -0, 0.5, 2 ** 53, "\ud800", Array(1), cycle,
      handle]) {
      assert.equal(call("copy", value).kind, "error");
      cases++;
    }
    assert.deepEqual(handle, {}, "rejecting a JSL does not mutate its payload");
    let aliased = 0;
    for (let i = 0; i < 40; i++) aliased = [aliased, aliased];
    assert.match(call("copy", aliased).value, /1000000 nodes/);
    let nested = null;
    for (let i = 0; i < 256; i++) nested = [nested];
    assert.deepEqual(call("copy", nested), { kind: "ok", value: nested });
    assert.match(call("copy", [nested]).value, /nesting exceeds 256/);
    assert.deepEqual(call("nestedWire", 256), { kind: "ok", value: nested });
    assert.match(call("nestedWire", 257).value, /nesting exceeds 256/);
    assert.deepEqual(call("copy", { still: "usable" }), { kind: "ok", value: { still: "usable" } });
    cases += 6;
    return { cases, sharedFoo: true, nativePromise: true, leanContinuation: true };
  } finally {
    runtime.dispose();
  }
}
