/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { createInfoviewHostBindings } from "../../web/src/host/vir-infoview-host-bindings.js";

const bindings = createInfoviewHostBindings();
const empty = bindings["infoview.clientRequestOptions.empty"];
const setSignal = bindings["infoview.clientRequestOptions.setAbortSignal"];

test("request options are independent ordinary objects with an omitted signal", () => {
  const first = empty();
  assert.deepEqual(first, {});
  assert.equal(Object.getPrototypeOf(first), Object.prototype);
  assert.equal(Object.hasOwn(first, "abortSignal"), false);
  assert.notEqual(first, empty());
});

test("native request options and signal reach the exact receiver unchanged", () => {
  const options = empty();
  const controller = new AbortController();
  assert.equal(setSignal(options, controller.signal), undefined);
  assert.equal(options.abortSignal, controller.signal);
  const params = {};
  const promise = Promise.resolve(params);
  const session = {
    call(...args) {
      assert.equal(this, session);
      assert.deepEqual(args, ["method", params, options]);
      assert.equal(args[1], params);
      assert.equal(args[2], options);
      return promise;
    },
  };
  assert.equal(bindings["infoview.rpcSession.callWithOptions"](
    session, "method", params, options), promise);
  controller.abort();
  assert.equal(options.abortSignal.aborted, true);
});

test("the no-options call omits the native argument", () => {
  const session = { call(...args) { assert.equal(args.length, 2); return 42; } };
  assert.equal(bindings["infoview.rpcSession.call"](session, "method", {}), 42);
});

test("notification hook forwards exact undefined or array values through one binding", () => {
  const calls = [];
  const native = (...args) => { calls.push(args); };
  const bindings = createInfoviewHostBindings({ useClientNotificationEffect: native });
  const callback = () => {};
  const deps = [];
  bindings["infoview.useClientNotificationEffect"]("method", callback, undefined);
  bindings["infoview.useClientNotificationEffect"]("method", callback, deps);
  assert.equal(calls[0].length, 3);
  assert.equal(calls[0][2], undefined);
  assert.equal(Object.hasOwn(bindings, "infoview.useClientNotificationEffectWithDeps"), false);
  assert.equal(calls[1].length, 3);
  assert.equal(calls[0][1], callback);
  assert.equal(calls[1][1], callback);
  assert.equal(calls[1][2], deps);
  assert.throws(() => createInfoviewHostBindings()["infoview.useClientNotificationEffect"](
    "method", callback), /requires the upstream infoview host/);
});
