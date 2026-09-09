/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDistinctModulePackageOutputs,
  normalizeModulePackageConfig,
} from "../../scripts/packages/module-package-config.mjs";

function config(overrides = {}) {
  return { version: 2, module: "Examples.Fib", ...overrides };
}

test("module package defaults select all public definitions", () => {
  assert.deepEqual(normalizeModulePackageConfig(config()), {
    module: "Examples.Fib",
    packagePath: "build/generated/Fib.irpkg",
    reportPath: "build/generated/Fib.report.md",
    roots: [],
    targetArgs: ["--target-all-module", "Examples.Fib"],
  });
  assert.deepEqual(
    normalizeModulePackageConfig(config({ roots: [] })),
    normalizeModulePackageConfig(config()),
  );
});

test("module package explicit roots preserve order and do not mutate input", () => {
  const roots = Object.freeze(["Examples.Fib.fib", "Examples.Fib.demo"]);
  const input = Object.freeze(config({ roots }));
  const normalized = normalizeModulePackageConfig(input);
  assert.deepEqual(normalized.roots, roots);
  assert.notEqual(normalized.roots, roots);
  assert.deepEqual(normalized.targetArgs, [
    "--target-module",
    "Examples.Fib",
    ...roots,
  ]);
});

test("removed includeAll cannot override root selection", () => {
  for (const includeAll of [true, false, null, 0, "true", [], {}]) {
    for (const roots of [undefined, [], ["Examples.Fib.fib"]]) {
      assert.throws(
        () => normalizeModulePackageConfig(config({ includeAll, roots })),
        /unknown field includeAll/,
      );
    }
  }
});

test("module package output paths share the existing report suffix convention", () => {
  for (const [packagePath, reportPath] of [
    ["web/public/fib.irpkg", "web/public/fib.report.md"],
    ["build/custom.bundle", "build/custom.bundle.report.md"],
    ["build/output with spaces.irpkg", "build/output with spaces.report.md"],
  ]) {
    const normalized = normalizeModulePackageConfig(
      config({ package: packagePath }),
    );
    assert.equal(normalized.packagePath, packagePath);
    assert.equal(normalized.reportPath, reportPath);
  }
  assert.equal(
    normalizeModulePackageConfig(
      config({
        report: "build/reports/fib.md",
      }),
    ).reportPath,
    "build/reports/fib.md",
  );
});

test("module and root identities preserve Unicode and escaped names for Lean", () => {
  assert.equal(
    normalizeModulePackageConfig(
      config({
        module: "Examples.Δοκιμή",
      }),
    ).packagePath,
    "build/generated/Δοκιμή.irpkg",
  );
  const module = "Examples.«Name.with dots»";
  const roots = ["Examples.«Name.with dots».«export value»", "Examples.δ'"];
  assert.deepEqual(
    normalizeModulePackageConfig(
      config({
        module,
        roots,
        package: "build/quoted.irpkg",
      }),
    ).targetArgs,
    ["--target-module", module, ...roots],
  );
  assert.throws(
    () => normalizeModulePackageConfig(config({ module })),
    /quoted module names require an explicit `package` path/,
  );
});

test("module package configs reject malformed containers, versions and unknown fields", () => {
  for (const input of [null, undefined, [], "config", 2, true]) {
    assert.throws(
      () => normalizeModulePackageConfig(input),
      /must be an object/,
    );
  }
  for (const version of [undefined, null, 1, 3, "2"]) {
    assert.throws(
      () => normalizeModulePackageConfig(config({ version })),
      /version must be 2/,
    );
  }
  for (const field of ["source", "typo", "targetArgs", "packagePath"]) {
    assert.throws(
      () => normalizeModulePackageConfig(config({ [field]: "bad" })),
      new RegExp(`unknown field ${field}`),
    );
  }
});

test("module identities reject malformed values and source or Lake-target syntax", () => {
  for (const module of [
    undefined,
    null,
    3,
    [],
    {},
    "",
    " ",
    " Examples.Fib",
    "Examples.Fib ",
    "Examples.\nFib",
    "Examples.\0Fib",
    "Examples/Fib",
    "Examples\\Fib",
    "Examples.Fib.lean",
    "-Example",
    "--target-all",
    "+Examples.Fib",
    "@dependency",
    "Examples.Fib:vir",
  ]) {
    assert.throws(() => normalizeModulePackageConfig(config({ module })));
  }
});

test("module package selections reject malformed roots", () => {
  for (const roots of [null, "Examples.Fib.fib", 3, true, {}]) {
    assert.throws(
      () => normalizeModulePackageConfig(config({ roots })),
      /`roots` must be an array/,
    );
  }
  for (const root of [
    null,
    3,
    {},
    [],
    "",
    " ",
    " fib",
    "fib ",
    "f\nib",
    "--target-all",
  ]) {
    assert.throws(() =>
      normalizeModulePackageConfig(config({ roots: [root] })),
    );
  }
});

test("module package paths reject empty, flag-valued and non-string values", () => {
  for (const field of ["package", "report"]) {
    for (const value of [
      null,
      3,
      [],
      {},
      "",
      " ",
      "--help",
      "-o",
      "bad\0path",
      "bad\npath",
    ]) {
      assert.throws(
        () => normalizeModulePackageConfig(config({ [field]: value })),
        /must be a non-empty path, not an option/,
      );
    }
  }
});

test("module package outputs reject package/report collisions within a config", () => {
  const normalized = normalizeModulePackageConfig(
    config({
      package: "build/fib.irpkg",
      report: "build/fib.irpkg",
    }),
  );
  assert.throws(
    () => assertDistinctModulePackageOutputs([normalized], "/repo"),
    /output collision.*package for module "Examples.Fib".*report for module "Examples.Fib"/,
  );
});

test("module package outputs reject all cross-config role collisions", () => {
  for (const [firstRole, secondRole] of [
    ["package", "package"],
    ["package", "report"],
    ["report", "package"],
    ["report", "report"],
  ]) {
    const normalized = [
      normalizeModulePackageConfig(
        config({
          module: "Examples.First",
          [firstRole]: "build/shared.irpkg",
        }),
      ),
      normalizeModulePackageConfig(
        config({
          module: "Examples.Second",
          [secondRole]: "build/shared.irpkg",
        }),
      ),
    ];
    assert.throws(
      () => assertDistinctModulePackageOutputs(normalized, "/repo"),
      new RegExp(
        `output collision.*${firstRole} for module "Examples.First".*${secondRole} for module "Examples.Second"`,
      ),
    );
  }
});

test("module package outputs reject colliding default terminal components", () => {
  const normalized = ["First.Widget", "Second.Widget"].map((module) =>
    normalizeModulePackageConfig(config({ module })),
  );
  assert.throws(
    () => assertDistinctModulePackageOutputs(normalized, "/repo"),
    /output collision.*\/repo\/build\/generated\/Widget.irpkg/,
  );
});

test("module package outputs resolve lexical aliases against the explicit root", () => {
  const normalized = [
    normalizeModulePackageConfig(
      config({
        module: "First",
        package: "build/tmp/../shared.irpkg",
      }),
    ),
    normalizeModulePackageConfig(
      config({
        module: "Second",
        package: "/repo/build/shared.irpkg",
      }),
    ),
  ];
  assert.throws(
    () => assertDistinctModulePackageOutputs(normalized, "/repo"),
    /output collision.*\/repo\/build\/shared.irpkg/,
  );
});

test("module package outputs accept distinct paths without modifying configs", () => {
  const normalized = Object.freeze(
    ["First.Widget", "Second.Widget"].map((module) =>
      Object.freeze(
        normalizeModulePackageConfig(
          config({
            module,
            package: `build/${module}.irpkg`,
          }),
        ),
      ),
    ),
  );
  assert.doesNotThrow(() =>
    assertDistinctModulePackageOutputs(normalized, "/repo"),
  );
  assert.doesNotThrow(() => assertDistinctModulePackageOutputs([], "/repo"));
  for (const root of [undefined, null, "", "relative"])
    assert.throws(
      () => assertDistinctModulePackageOutputs(normalized, root),
      /root must be an absolute path/,
    );
});
