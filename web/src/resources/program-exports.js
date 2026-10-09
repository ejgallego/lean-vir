/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { interfaceSignatureKey } from "../runtime/interface-manifest.js";

export function snapshotExpectedExports(value) {
  if (value === undefined) return new Map();
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("expectedExports must be a declaration map");
  const expected = new Map();
  for (const declaration of Object.getOwnPropertyNames(value)) {
    const signature = structuredClone(value[declaration]);
    if (
      !declaration ||
      !signature ||
      Object.keys(signature).sort().join(",") !== "args,effect,result"
    )
      throw new TypeError(
        "expectedExports entries must contain args, result and effect",
      );
    expected.set(declaration, interfaceSignatureKey(signature));
  }
  if (Object.getOwnPropertySymbols(value).length)
    throw new TypeError("expectedExports requires string declaration keys");
  return expected;
}

// Only the root member supplies callable entries; convenience aliases such as
// The full Lean entry is the sole public call key; nameKey preserves native identity.
export function resolveProgramExports(rootExports, expected = new Map()) {
  const declarations = new Map();
  for (const entry of rootExports) {
    if (declarations.has(entry.entry))
      throw new Error(`ambiguous program export ${entry.entry}`);
    declarations.set(entry.entry, entry);
  }
  for (const [declaration, signatureKey] of expected) {
    const entry = declarations.get(declaration);
    if (entry === undefined)
      throw new Error(`missing program export ${declaration}`);
    if (
      signatureKey !==
      interfaceSignatureKey({
        args: entry.args.map((arg) => arg.type),
        result: entry.result,
        effect: entry.effect,
      })
    )
      throw new Error(
        `program export ${declaration} does not match expected callable signature`,
      );
  }
  return declarations;
}
