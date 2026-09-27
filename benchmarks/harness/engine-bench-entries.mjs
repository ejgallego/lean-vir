/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readIrPackageFile } from "../../scripts/packages/irpkg-format.mjs";

export function engineBenchmarkEntryHeader(manifest) {
  return [
    ["fib_export_index", "fib"],
    ["sort_export_index", "SortDemo.demoFromArray"],
  ].map(([symbol, entry]) => {
    const index = manifest.exports.findIndex(value => value.entry === entry);
    if (index === -1) {
      throw new Error(`engine benchmark package is missing export ${entry}`);
    }
    return `static constexpr uint32_t ${symbol} = ${index};`;
  }).join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { manifest } = await readIrPackageFile(process.argv[2]);
  process.stdout.write(engineBenchmarkEntryHeader(manifest));
}
