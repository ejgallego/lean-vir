/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { interfaceSignatureKey } from "../runtime/interface-manifest.js";

export function snapshotExpectedExports(value) {
  if (value === undefined) return new Map();
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("expectedExports must be a role map");
  const expected = new Map();
  for (const role of Object.getOwnPropertyNames(value)) {
    const entry = structuredClone(value[role]);
    if (
      !role ||
      !entry ||
      Object.keys(entry).sort().join(",") !==
        "declaration,interfaceId,signature" ||
      typeof entry.declaration !== "string" ||
      !entry.declaration ||
      typeof entry.interfaceId !== "string" ||
      !entry.interfaceId ||
      !entry.signature ||
      Object.keys(entry.signature).sort().join(",") !== "args,effect,result"
    )
      throw new TypeError(
        "expectedExports requires complete declaration, interfaceId and signature entries",
      );
    expected.set(role, {
      declaration: entry.declaration,
      interfaceId: entry.interfaceId,
      signatureKey: interfaceSignatureKey(entry.signature),
    });
  }
  if (Object.getOwnPropertySymbols(value).length)
    throw new TypeError("expectedExports requires string role keys");
  return expected;
}

export function checkExpectedExportMetadata(expected, requirements) {
  for (const [role, entry] of expected) {
    const matches = requirements.filter(
      (requirement) => requirement.role === role,
    );
    if (
      matches.length !== 1 ||
      matches[0].declaration !== entry.declaration ||
      matches[0].interfaceId !== entry.interfaceId
    )
      throw new Error(
        "program export does not match expected role, declaration and interfaceId",
      );
  }
}

// Only the root member supplies the callable interface. Bind declaration
// identities, never the runtime's convenience id/jsName alias lookup.
export function resolveProgramExports(
  requirements,
  rootExports,
  expected = new Map(),
) {
  checkExpectedExportMetadata(expected, requirements);
  const declarations = new Map();
  for (const entry of rootExports) {
    if (declarations.has(entry.entry))
      throw new Error(`ambiguous program export ${entry.entry}`);
    declarations.set(entry.entry, entry);
  }
  return new Map(
    requirements.map(({ role, declaration }) => {
      const entry = declarations.get(declaration);
      if (entry === undefined)
        throw new Error(`missing program export ${declaration}`);
      const expectation = expected.get(role);
      if (
        expectation &&
        expectation.signatureKey !==
          interfaceSignatureKey({
            args: entry.args.map((arg) => arg.type),
            result: entry.result,
            effect: entry.effect,
          })
      )
        throw new Error(
          "program export does not match expected callable signature",
        );
      return [role, entry];
    }),
  );
}
