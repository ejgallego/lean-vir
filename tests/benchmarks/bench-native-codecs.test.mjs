/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { timedNativeCalls } from "../../benchmarks/harness/bench-native-codecs.mjs";

test("native codec timing closes before result validation", () => {
  let clockOpen = false, calls = 0;
  const clock = () => { clockOpen = !clockOpen; return clockOpen ? 100 : 102; };
  const result = new Proxy({ value: 42 }, {
    ownKeys(target) {
      assert.equal(clockOpen, false, "validation entered the timed region");
      return Reflect.ownKeys(target);
    },
  });
  assert.equal(timedNativeCalls(() => { calls++; return result; }, { value: 42 }, 3, clock), 2);
  assert.equal(calls, 3);
});

test("native codec comparison rejects an incorrect fast result", () => {
  let time = 0;
  assert.throws(() => timedNativeCalls(() => [], [42n], 3, () => ++time),
    assert.AssertionError);
});
