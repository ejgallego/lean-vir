/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function fixtureModuleMap(packageSpecs, fixtures) {
  const bySource = new Map(
    packageSpecs.flatMap((spec) =>
      (spec.fixtureInputs ?? []).map(({ source, module }) => [source, module]),
    ),
  );
  return new Map(
    fixtures.map((fixture) => {
      const module = bySource.get(fixture.source);
      if (module === undefined) {
        throw new Error(
          `${fixture.id}: no compiled module for ${fixture.source}`,
        );
      }
      return [fixture.source, module];
    }),
  );
}

export function fixtureHostModule(fixture, module) {
  if (fixture.result?.type !== "Nat") {
    throw new Error(
      `${fixture.id}: unsupported host result type ${fixture.result?.type}`,
    );
  }
  return [
    "module",
    // The oracle deliberately interprets imported runtime IR, including private
    // helpers. An ordinary public import exposes signatures, not those bodies.
    `public import ${module}`,
    `import all ${module}`,
    "",
    "set_option interpreter.prefer_native false",
    `${fixture.unsafe ? "public unsafe" : "public"} def main : IO UInt32 := do`,
    `  IO.println (toString ${fixture.entry})`,
    "  return 0",
    "",
  ].join("\n");
}
