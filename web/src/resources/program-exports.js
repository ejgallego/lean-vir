/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Only the root member supplies the callable interface. Bind declaration
// identities, never the runtime's convenience id/jsName alias lookup.
export function resolveProgramExports(requirements, rootExports) {
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
      return [role, entry];
    }),
  );
}
