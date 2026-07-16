#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { OBJECT_ABI_EXPORTS } from "../web/src/runtime/object-abi-exports.js";

const seen = new Set();
const duplicates = [];

for (const name of OBJECT_ABI_EXPORTS) {
  if (seen.has(name)) {
    duplicates.push(name);
  }
  seen.add(name);
}

if (duplicates.length !== 0) {
  throw new Error(`duplicate object ABI exports: ${duplicates.join(", ")}`);
}

for (const name of OBJECT_ABI_EXPORTS) {
  console.log(`-Wl,--export=${name}`);
}
