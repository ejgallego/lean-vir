/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { engineBenchmarkEntryHeader } from "../../benchmarks/harness/engine-bench-entries.mjs";

test("engine benchmark entry indices follow reordered package exports", () => {
  const manifest = {
    exports: ["unrelated", "SortDemo.demoFromArray", "fib"].map(entry => ({ entry })),
  };
  assert.equal(engineBenchmarkEntryHeader(manifest),
    "static constexpr uint32_t fib_export_index = 2;\n" +
    "static constexpr uint32_t sort_export_index = 1;\n");
});

test("engine benchmark embedding rejects either missing workload", () => {
  for (const entry of ["fib", "SortDemo.demoFromArray"]) {
    assert.throws(() => engineBenchmarkEntryHeader({ exports: [{ entry }] }),
      /engine benchmark package is missing export/);
  }
});
