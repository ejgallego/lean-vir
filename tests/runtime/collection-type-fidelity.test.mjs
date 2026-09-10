/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { createJsCollectionHostBindings } from "../../web/src/host/vir-js-collection-bindings.js";

test("typed collection providers preserve native values, identity and index absence", () => {
  const bindings = createJsCollectionHostBindings();
  const array = bindings["js.array.empty"]();
  const item = {};
  assert.equal(bindings["js.array.push"](array, item), 1);
  assert.equal(bindings["js.array.item"](array, 0), item);
  assert.equal(bindings["js.array.item"](array, 1), undefined);
  const sparse = new Array(1);
  assert.equal(bindings["js.array.item"](sparse, 0), undefined);
  const callback = () => {};
  const tuple = [item, callback];
  assert.equal(bindings["js.tuple2.first"](tuple), item);
  assert.equal(bindings["js.tuple2.second"](tuple), callback);
  assert.deepEqual(tuple, [item, callback]);
});
