/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function objectTypeNeedsBoxedBoundary(pair) {
  return nativeNeedsBoxedBoundary(pair.native);
}

function nativeNeedsBoxedBoundary(native) {
  const type = native.type;
  if (type?.tag === "float" || (type?.tag === "unsigned" && type.width === 64)) return true;
  const constructors = native.metadata?.constructors;
  return constructors?.length === 1 && constructors[0].representation === "identity"
    ? nativeNeedsBoxedBoundary(constructors[0].fields[0].type) : false;
}
