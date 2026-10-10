/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function directJsArgumentSupported(pair) {
  if (directJsValueSupported(pair.value)) return true;
  if (pair.value.tag !== "function") return false;
  return pair.value.args.every(directJsValueSupported) && directJsValueSupported(pair.value.result);
}

export function directJsResultSupported(pair) { return directJsValueSupported(pair.value); }

function directJsValueSupported(view) {
  return view.tag === "unit" || view.tag === "jsReference";
}
