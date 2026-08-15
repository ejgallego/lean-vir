/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import { RuntimeCallTiming } from "../../web/src/runtime/call-timing.js";
import { VirHostState } from "../../web/src/runtime/host-state.js";

let current = 0;
const advance = (milliseconds) => {
  current += milliseconds;
};
const timing = new RuntimeCallTiming(() => current);

let started = timing.beginPhase();
advance(2);
timing.endMarshal(started);
started = timing.beginPhase();
advance(1);
timing.endMarshal(started);

const hostState = new VirHostState({ defaultHostBindings: {} });
let nested = false;
hostState.callObjectsImpl = () => {
  advance(1);
  if (!nested) {
    nested = true;
    hostState.callObjects(0, 0, 0);
  }
  advance(1);
  return 7;
};
hostState.beginCallTiming(timing);
try {
  started = timing.beginPhase();
  assert.equal(hostState.callObjects(0, 0, 0), 7);
  timing.endExecute(started);
} finally {
  hostState.endCallTiming(timing);
}

started = timing.beginPhase();
advance(3);
timing.endDecode(started);
advance(2);
assert.deepEqual(timing.finish(), {
  marshalMs: 3,
  executeMs: 4,
  decodeMs: 3,
  hostMs: 4,
  totalMs: 12,
});
assert.throws(() => timing.finish(), /already finished/);

const incomplete = new RuntimeCallTiming(() => current);
const incompleteHostStarted = incomplete.beginHost();
assert.throws(() => incomplete.finish(), /active host import/);
incomplete.endHost(incompleteHostStarted);
assert.equal(incomplete.finish().hostMs, 0);

console.log("vir runtime call timing smoke ok");
