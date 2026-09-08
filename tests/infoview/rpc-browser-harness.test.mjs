/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { test } from "node:test";
import { awaitRpcOutcome } from "./rpc-browser-harness.mjs";

for (const kind of ["resolve", "reject"]) {
  test(`RPC gate holds a ${kind} outcome and preserves its identity`, async () => {
    const request = Promise.withResolvers();
    const gate = { ...Promise.withResolvers(), ready: false };
    const payload =
      kind === "resolve"
        ? { __rpcref: "reference" }
        : Object.assign(new Error("actual server failure"), { code: -32800 });
    let delivered = false;
    const outcome = awaitRpcOutcome(request.promise, gate).then(
      (value) => {
        delivered = true;
        return { kind: "resolve", value };
      },
      (value) => {
        delivered = true;
        return { kind: "reject", value };
      },
    );
    await Promise.resolve();
    assert.equal(gate.ready, false);
    request[kind](payload);
    await Promise.resolve();
    assert.equal(gate.ready, true);
    assert.equal(delivered, false);
    gate.resolve();
    const actual = await outcome;
    assert.equal(actual.kind, kind);
    assert.equal(actual.value, payload);
  });
}

test("ungated RPC outcomes pass through unchanged", async () => {
  const value = {};
  assert.equal(await awaitRpcOutcome(Promise.resolve(value)), value);
  const error = new Error("server error");
  await assert.rejects(
    awaitRpcOutcome(Promise.reject(error)),
    (actual) => actual === error,
  );
});
