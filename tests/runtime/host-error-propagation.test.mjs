/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { VirHostState } from "../../web/src/runtime/host-state.js";
import { VirRuntime } from "../../web/src/runtime/core.js";
import { RuntimeCallTiming } from "../../web/src/runtime/call-timing.js";

test("a pending host error forbids dispatch and reentry without clearing the original", () => {
  const hostState = new VirHostState({ defaultHostBindings: {} });
  const failure = new Error("first failure");
  hostState.recordCallError(failure);
  const runtime = Object.create(VirRuntime.prototype);
  Object.assign(runtime, { hostState, resolveCallSlot: () => 1 });
  for (const operation of [
    () => hostState.callObjectsImpl(0, 0, 0),
    () => runtime.callClosureObjects(1, null, []),
    () => runtime.callResolvedObjects({ entry: "test" }, null, [], () => {}),
  ]) {
    assert.throws(operation, error => error === failure);
    assert.equal(hostState.callError, failure);
  }
  assert.equal(hostState.takeCallError(), failure);
});

test("export errors preserve the original host error over secondary traps and balance timing", () => {
  for (const timed of [false, true]) {
    const hostState = new VirHostState({ defaultHostBindings: {} });
    const failure = new Error("original host exception");
    const runtime = Object.create(VirRuntime.prototype);
    Object.assign(runtime, {
      hostState,
      resolveCallSlot: () => 1,
      exports: {
        vir_call_resolved_objects() {
          hostState.recordCallError(failure);
          throw new WebAssembly.RuntimeError("secondary trap");
        },
      },
    });
    const timing = timed ? new RuntimeCallTiming() : null;
    assert.throws(
      () => runtime.callResolvedObjects({ entry: "test" }, null, [], () => {}, timing),
      error => error === failure,
    );
    assert.equal(hostState.callError, null);
    assert.equal(hostState.callTimings.length, 0);
    timing?.finish();
  }
});
