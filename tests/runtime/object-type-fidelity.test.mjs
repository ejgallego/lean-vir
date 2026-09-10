/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { createJsCollectionHostBindings } from "../../web/src/host/vir-js-collection-bindings.js";
import { createJsValueHostBindings } from "../../web/src/host/vir-js-value-bindings.js";
import { VirRuntime } from "../../web/src/runtime/core.js";
import { VirHostState } from "../../web/src/runtime/host-state.js";

const objects = createJsCollectionHostBindings();
const requireString = createJsValueHostBindings()["js.string.fromAny"];

test("dynamic properties preserve exact values, missing undefined and getter behavior", () => {
  for (const value of [{}, [], () => {}, "text", 0, 1n, false, null, undefined]) {
    const object = objects["js.object.empty"]();
    objects["js.object.set"](object, "value", value);
    assert.equal(objects["js.object.get"](object, "value"), value);
    assert.equal(objects["js.object.get"](object, "missing"), undefined);
  }
  let reads = 0;
  const value = {};
  const receiver = { get field() { reads += 1; return value; } };
  assert.equal(objects["js.object.get"](receiver, "field"), value);
  assert.equal(reads, 1);
  const failure = new Error("upstream getter failed");
  assert.throws(() => objects["js.object.get"]({ get field() { throw failure; } }, "field"),
    (error) => error === failure);
});

test("closed String narrowing returns the exact primitive and rejects every wrong kind", () => {
  for (const value of ["", "hello", "λ🙂", "\ud800"]) assert.equal(requireString(value), value);
  let coercions = 0;
  const coercible = { [Symbol.toPrimitive]() { coercions += 1; return "not accepted"; } };
  for (const value of [undefined, null, false, 0, 1n, Symbol("s"), {}, [], () => {}, new String("s"), coercible]) {
    assert.throws(() => requireString(value), {
      name: "TypeError", message: "js.string.fromAny expects a primitive JavaScript string",
    });
  }
  assert.equal(coercions, 0, "narrowing must never execute coercion hooks");
});

test("native Promise projection checks one property read and rejects malformed fields", async () => {
  const project = (response) => requireString(objects["js.object.get"](response, "message"));
  let reads = 0;
  const response = { get message() { reads += 1; return reads === 1 ? "first" : 7; } };
  assert.equal(await objects["js.promise.thenValue"](Promise.resolve(response), project), "first");
  assert.equal(reads, 1, "check the returned value, not a second property read");
  for (const value of [undefined, null, 7, {}, new String("message")]) {
    const pending = Promise.resolve({ message: value });
    const result = objects["js.promise.thenValue"](pending, project);
    assert.ok(result instanceof Promise);
    await assert.rejects(result, {
      name: "TypeError", message: "js.string.fromAny expects a primitive JavaScript string",
    });
  }
});

test("callback bridge preserves the String check error as a Promise rejection", async () => {
  // Simulate only the interpreter entry: exercise the actual callback bridge's
  // recorded-host-error paths for both a returned failure and a Wasm trap.
  // This is a bridge unit test, not a real-Wasm or RPC integration test.
  for (const trap of [false, true]) {
    const hostState = new VirHostState({ defaultHostBindings: {} });
    let hostError;
    const runtime = Object.create(VirRuntime.prototype);
    Object.assign(runtime, {
      hostState,
      exports: {
        vir_closure_call_objects() {
          try {
            requireString(undefined);
            assert.fail("a missing message must not pass the String check");
          } catch (error) {
            hostError = error;
            hostState.recordCallError(error);
          }
          if (trap) throw new WebAssembly.RuntimeError("interpreter stopped");
          return 0;
        },
      },
    });
    const project = () => runtime.callClosureObjects(1, null, []);
    await assert.rejects(objects["js.promise.thenValue"](Promise.resolve({}), project),
      (error) => error === hostError && error instanceof TypeError);
    assert.equal(hostState.takeCallError(), null);
  }
});
