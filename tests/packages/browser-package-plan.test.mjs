/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import {
  planBrowserPackage,
  selectBrowserPackages,
} from "../../scripts/packages/browser-package-plan.mjs";

test("browser planning unions explicit and fixture roots by module without mutating inputs", () => {
  const spec = {
    id: "bundle",
    targets: [
      { module: "Demo.A", roots: ["a", "same"] },
      { module: "Demo.B", roots: ["b"] },
      { module: "Demo.A", roots: ["same", "extra"] },
      { module: "Demo.A", roots: ["support", "same"], packageOnly: true },
      { module: "Demo.C", roots: ["internal"], packageOnly: true },
    ],
    fixtureInputs: [{ source: "arbitrary/display.lean", module: "Demo.A" }],
  };
  const fixtures = [
    { source: "arbitrary/display.lean", entry: "a", roots: ["fixtureRoot"] },
    { source: "arbitrary/display.lean", entry: "same" },
    { source: "unselected.lean", entry: "notIncluded" },
  ];
  const before = structuredClone({ spec, fixtures });
  const plan = planBrowserPackage(spec, fixtures);
  assert.deepEqual(plan, {
    modules: ["Demo.A", "Demo.B", "Demo.C"],
    targetArgs: [
      "--target-module",
      "Demo.A",
      "a",
      "same",
      "extra",
      "fixtureRoot",
      "--target-module",
      "Demo.B",
      "b",
      "--package-module",
      "Demo.A",
      "support",
      "same",
      "--package-module",
      "Demo.C",
      "internal",
    ],
  });
  assert.deepEqual({ spec, fixtures }, before);
  assert.deepEqual(planBrowserPackage(spec, fixtures), plan);
  assert.ok(!plan.targetArgs.includes("arbitrary/display.lean"));
});

test("browser planning keeps package-only roots internal and rejects empty plans", () => {
  assert.deepEqual(
    planBrowserPackage(
      {
        id: "internal",
        targets: [{ module: "Support", roots: ["x"], packageOnly: true }],
      },
      [],
    ),
    { modules: ["Support"], targetArgs: ["--package-module", "Support", "x"] },
  );
  assert.throws(
    () => planBrowserPackage({ id: "empty" }, []),
    /empty: package has no module targets/,
  );
});

test("browser package filters deduplicate aliases and retain catalog order", () => {
  const specs = [
    { id: "a", file: "a.irpkg" },
    { id: "b", file: "b.irpkg" },
  ];
  assert.deepEqual(selectBrowserPackages(specs, new Set()), specs);
  assert.deepEqual(
    selectBrowserPackages(specs, new Set(["b.irpkg", "a", "a.irpkg"])),
    specs,
  );
  assert.deepEqual(selectBrowserPackages(specs, new Set(["a", "a.irpkg"])), [
    specs[0],
  ]);
  assert.throws(
    () => selectBrowserPackages(specs, new Set(["a", "missing"])),
    /unknown package "missing"/,
  );
  assert.throws(
    () => selectBrowserPackages(specs, new Set([""])),
    /unknown package/,
  );
});
