/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import { classifySurfaceBoundary } from "../../scripts/surface-boundary-family.mjs";

test("surface boundary families separate runtime domains and project FFI", () => {
  assert.equal(classifySurfaceBoundary("IO.FS.Handle.read", "Init.System.IO"), "IO / filesystem / process");
  assert.equal(classifySurfaceBoundary("ByteArray.copyWithin", "Init.Data.ByteArray"), "ByteArray primitives");
  assert.equal(classifySurfaceBoundary("Gzip.compress", "Zip.Gzip"), "Compression FFI");
  assert.equal(classifySurfaceBoundary("Lean.Expr.instantiate", "Lean.Expr"), "Lean expression / meta");
  assert.equal(classifySurfaceBoundary("Lean.IR.Checker.getMaxCtorTag", "Lean.Compiler.IR.Checker"), "Lean compiler runtime");
  assert.equal(classifySurfaceBoundary("UInt64.ctzFast", "Init.Data.UInt"), "Numeric / character primitives");
  assert.equal(classifySurfaceBoundary("Acme.Widget.open", "Acme.Widget"), "Project FFI");
});
