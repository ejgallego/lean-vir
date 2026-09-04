/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import { createLatestLoadGate } from "../../web/app/pages/latest-load.js";

test("latest-load gates reject superseded async work", () => {
  const gate = createLatestLoadGate();
  const first = gate.begin();
  assert.equal(gate.isCurrent(first), true);
  const second = gate.begin();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  let discarded = 0;
  assert.equal(
    gate.discardStale(first, () => {
      discarded += 1;
    }),
    true,
  );
  assert.equal(
    gate.discardStale(second, () => assert.fail()),
    false,
  );
  assert.equal(discarded, 1);
});
