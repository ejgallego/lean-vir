/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const boundaryFamilies = [
  "IO / filesystem / process",
  "ByteArray primitives",
  "Compression FFI",
  "Lean expression / meta",
  "Lean compiler runtime",
  "Numeric / character primitives",
  "Project FFI",
  "Other runtime",
];

export function classifySurfaceBoundary(name, moduleName = "") {
  if (/^(?:BaseIO|IO|Task)\./u.test(name)
      || /^(?:Handle|System\.FilePath)\./u.test(name)
      || name.includes(".Promise.")) {
    return "IO / filesystem / process";
  }
  if (name.startsWith("ByteArray.")) return "ByteArray primitives";
  if (/^(?:Checksum|Gzip|RawDeflate|Zlib)\./u.test(name)) return "Compression FFI";
  if (/^Lean\.(?:Expr|Meta)\./u.test(name)
      || /^Lean\.instantiate(?:Expr|Level)/u.test(name)) {
    return "Lean expression / meta";
  }
  if (/^Lean\.IR\./u.test(name)
      || ["Lean.closureMaxArgsFn", "Lean.maxSmallNatFn", "Lean.profileit"].includes(name)) {
    return "Lean compiler runtime";
  }
  if (/^(?:Char|Float|Float32|U?Int(?:8|16|32|64)?|USize|ISize)\./u.test(name)) {
    return "Numeric / character primitives";
  }
  const topModule = moduleName.split(".", 1)[0];
  if (moduleName && !["Init", "Lake", "Lean", "Std"].includes(topModule)) return "Project FFI";
  return "Other runtime";
}
