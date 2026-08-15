/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  balancedStdFormatAppend,
  stdFormat,
  taggedStdFormatChunks,
} from "../../fixtures/js/std-format-values.mjs";

test("Std.Format benchmark workloads preserve their declared node counts", () => {
  const tagWorkload = taggedStdFormatChunks(64, 64);
  assert.deepEqual(countFormatKinds(tagWorkload), {
    append: 63,
    tag: 4096,
    text: 64,
  });

  const emptyWorkload = balancedStdFormatAppend(Array.from({ length: 1024 }, () => stdFormat.nil()));
  assert.deepEqual(countFormatKinds(emptyWorkload), {
    append: 1023,
    nil: 1024,
  });
});

function countFormatKinds(root) {
  const counts = {};
  const pending = [root];
  while (pending.length !== 0) {
    const current = pending.pop();
    counts[current.kind] = (counts[current.kind] ?? 0) + 1;
    if (current.kind === "append") {
      pending.push(current.fields.arg1, current.fields.arg2);
    } else if (current.kind === "tag") {
      pending.push(current.fields.arg2);
    }
  }
  return counts;
}
