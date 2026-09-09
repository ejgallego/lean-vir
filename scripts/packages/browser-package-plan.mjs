/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { fixtureRoots } from "../../fixtures/fixture-manifest.mjs";

/** Select each package once, even when both its id and filename are requested. */
export function selectBrowserPackages(specs, selectors) {
  for (const selector of selectors) {
    if (!specs.some((spec) => spec.id === selector || spec.file === selector)) {
      throw new Error(
        `unknown package ${JSON.stringify(selector)}; available packages: ` +
          specs.map((spec) => `${spec.id} (${spec.file})`).join(", "),
      );
    }
  }
  return selectors.size === 0
    ? [...specs]
    : specs.filter(
        (spec) => selectors.has(spec.id) || selectors.has(spec.file),
      );
}

/** Pure root-union plan. Source paths select catalog entries, never compiler inputs. */
export function planBrowserPackage(spec, fixtures) {
  const exported = new Map();
  const internal = new Map();
  function add(targets, module, roots) {
    const selected = targets.get(module) ?? new Set();
    for (const root of roots) selected.add(root);
    targets.set(module, selected);
  }
  for (const target of spec.targets ?? []) {
    add(target.packageOnly ? internal : exported, target.module, target.roots);
  }
  const moduleBySource = new Map(
    (spec.fixtureInputs ?? []).map(({ source, module }) => [source, module]),
  );
  for (const fixture of fixtures) {
    const module = moduleBySource.get(fixture.source);
    if (module !== undefined) add(exported, module, fixtureRoots(fixture));
  }
  const modules = [...new Set([...exported.keys(), ...internal.keys()])];
  if (modules.length === 0)
    throw new Error(`${spec.id}: package has no module targets`);
  const targetArgs = [
    ...[...exported].flatMap(([module, roots]) => [
      "--target-module",
      module,
      ...roots,
    ]),
    ...[...internal].flatMap(([module, roots]) => [
      "--package-module",
      module,
      ...roots,
    ]),
  ];
  return { modules, targetArgs };
}
