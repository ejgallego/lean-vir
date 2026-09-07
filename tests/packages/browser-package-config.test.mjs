/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateFixtureManifest } from "../../fixtures/fixture-manifest.mjs";
import {
  browserPackageConfigVersion,
  deriveBrowserPackageConfig,
} from "../../web/app/pages/browser-package-config.js";

function packageSpec(id, overrides = {}) {
  return { id, file: `${id}.irpkg`, fixtureInputs: [], ...overrides };
}

function browserConfig(overrides = {}) {
  return {
    version: browserPackageConfigVersion,
    defaultPackage: "fixtures-basic",
    hostPackage: "demo-host",
    packages: [
      packageSpec("fixtures-basic", {
        fixtureInputs: [{ source: "fixtures/Basic.lean", module: "Fixture.Basic" }],
      }),
      packageSpec("demo-host"),
      packageSpec("pretty-printer"),
      packageSpec("fixtures-lean"),
      packageSpec("fixtures-boundary"),
    ],
    localPackages: [],
    ...overrides,
  };
}

test("checked-in fixture sources have exactly one browser package", async () => {
  const [rawBrowserConfig, rawFixtureManifest] = await Promise.all([
    readFile(new URL("../../fixtures/browser-packages.json", import.meta.url), "utf8"),
    readFile(new URL("../../fixtures/manifest.json", import.meta.url), "utf8"),
  ]);
  const config = deriveBrowserPackageConfig(JSON.parse(rawBrowserConfig));
  const fixtures = validateFixtureManifest(JSON.parse(rawFixtureManifest));
  const sources = new Set(fixtures.map((fixture) => fixture.source));

  assert.equal(browserPackageConfigVersion, 2);
  assert.equal(config.validateFixturePackageCoverage(fixtures), fixtures);
  for (const source of sources) {
    assert.match(config.packageFileForFixtureSource(source), /\.irpkg$/);
  }
});

test("browser package configs reject malformed containers and versions", () => {
  for (const config of [null, []]) {
    assert.throws(() => deriveBrowserPackageConfig(config), /browser package config must be an object/);
  }
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({ version: 1 })),
    /browser package config version must be 2, got 1/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({ typo: true })),
    /browser package config: unknown field typo/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({ packages: [] })),
    /packages must be a non-empty array/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({ localPackages: {} })),
    /localPackages must be an array/,
  );
});

test("browser package configs require unique package identities and files", () => {
  const packages = browserConfig().packages;
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({
      packages: [...packages, packageSpec("fixtures-basic", { file: "other.irpkg" })],
    })),
    /duplicate browser package id "fixtures-basic"/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({
      packages: [...packages, packageSpec("other", { file: "fixtures-basic.irpkg" })],
    })),
    /duplicate browser package file "fixtures-basic\.irpkg"/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({
      localPackages: [{ file: "fixtures-basic.irpkg", label: "Duplicate" }],
    })),
    /duplicate browser package file "fixtures-basic\.irpkg"/,
  );
});

test("browser package configs require valid named package references", () => {
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({ defaultPackage: "missing" })),
    /defaultPackage references unknown browser package "missing"/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({ hostPackage: "missing" })),
    /hostPackage references unknown browser package "missing"/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({
      packages: browserConfig().packages.filter((spec) => spec.id !== "fixtures-lean"),
    })),
    /fixtures-lean package references unknown browser package "fixtures-lean"/,
  );
});

test("fixture source package assignments are unique and total", () => {
  const packages = browserConfig().packages;
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({
      packages: packages.map((spec) => spec.id === "fixtures-lean"
        ? { ...spec, fixtureInputs: [{ source: "fixtures/Basic.lean", module: "Fixture.Basic" }] }
        : spec),
    })),
    /fixtures\/Basic\.lean: fixture source is assigned to both fixtures-basic\.irpkg and fixtures-lean\.irpkg/,
  );

  const config = deriveBrowserPackageConfig(browserConfig());
  assert.equal(config.packageFileForFixtureSource("fixtures/Basic.lean"), "fixtures-basic.irpkg");
  assert.throws(
    () => config.packageFileForFixtureSource("fixtures/Missing.lean"),
    /fixtures\/Missing\.lean: fixture source is not assigned to a browser package/,
  );
  assert.throws(
    () => config.validateFixturePackageCoverage([{ source: "fixtures/Missing.lean" }]),
    /fixtures\/Missing\.lean: fixture source is not assigned to a browser package/,
  );
  assert.throws(
    () => config.validateFixturePackageCoverage([]),
    /fixtures\/Basic\.lean: browser package assignment has no manifest fixtures/,
  );
});

test("browser package entries reject unknown and malformed fields", () => {
  const packages = browserConfig().packages;
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({
      packages: packages.map((spec) => spec.id === "fixtures-basic" ? { ...spec, typo: true } : spec),
    })),
    /browser package at index 0: unknown field typo/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({
      packages: packages.map((spec) => spec.id === "fixtures-basic"
        ? { ...spec, fixtureInputs: "fixtures/Basic.lean" }
        : spec),
    })),
    /fixtures-basic: fixtureInputs must be an array/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({
      packages: packages.map((spec) => spec.id === "fixtures-basic" ? { ...spec, id: "" } : spec),
    })),
    /browser package at index 0 id must be a non-empty string/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({
      localPackages: [{ file: "local.irpkg", label: "" }],
    })),
    /local browser package at index 0 label must be a non-empty string/,
  );
});

test("browser package targets validate their complete nested contract", () => {
  const packages = browserConfig().packages;
  function configWithTarget(target) {
    return browserConfig({
      packages: packages.map((spec) => spec.id === "fixtures-basic"
        ? { ...spec, targets: [target] }
        : spec),
    });
  }

  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({
      packages: packages.map((spec) => spec.id === "fixtures-basic"
        ? { ...spec, targets: {} }
        : spec),
    })),
    /fixtures-basic: targets must be an array/,
  );
  assert.doesNotThrow(() => deriveBrowserPackageConfig(configWithTarget({
    module: "Fib",
    roots: ["fib"],
    packageOnly: false,
  })));
  assert.throws(
    () => deriveBrowserPackageConfig(configWithTarget({ module: "Fib", root: "fib" })),
    /fixtures-basic: target at index 0: unknown field root/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(configWithTarget({ module: "", roots: ["fib"] })),
    /target at index 0.module must be a non-empty module identity/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(configWithTarget({
      module: "Fib",
      roots: "fib",
    })),
    /target at index 0 roots must be a non-empty array/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(configWithTarget({
      module: "Fib",
      roots: ["fib"],
      packageOnly: "yes",
    })),
    /target at index 0 packageOnly must be a boolean/,
  );
});

test("module targets reject source aliases, empty selections, and option-shaped names", () => {
  function withTarget(target) {
    const config = browserConfig();
    config.packages[0].targets = [target];
    return config;
  }
  for (const target of [null, [], "Fib"]) {
    assert.throws(() => deriveBrowserPackageConfig(withTarget(target)), /must be an object/);
  }
  assert.throws(
    () => deriveBrowserPackageConfig(withTarget({ source: "examples/Fib.lean", roots: ["fib"] })),
    /unknown field source/,
  );
  for (const roots of [undefined, null, [], "fib"]) {
    assert.throws(
      () => deriveBrowserPackageConfig(withTarget({ module: "Fib", roots })),
      /roots must be a non-empty array/,
    );
  }
  for (const name of [undefined, null, 42, "", " ", " Fib", "Fib\n", "--target-all-module"]) {
    assert.throws(
      () => deriveBrowserPackageConfig(withTarget({ module: name, roots: ["fib"] })),
      /module identity|must not be an option/,
    );
    assert.throws(
      () => deriveBrowserPackageConfig(withTarget({ module: "Fib", roots: [name] })),
      /module identity|must not be an option/,
    );
  }
  assert.doesNotThrow(() => deriveBrowserPackageConfig(withTarget({
    module: "Demo.«Escaped module»",
    roots: ["Demo.«Escaped root»"],
    packageOnly: true,
  })));
});

test("fixture inputs carry explicit module identities independent of source paths", () => {
  function withInputs(fixtureInputs) {
    const config = browserConfig();
    config.packages[0].fixtureInputs = fixtureInputs;
    return config;
  }
  const config = deriveBrowserPackageConfig(withInputs([
    { source: "fixtures/Basic.lean", module: "Registered.«Different module»" },
  ]));
  assert.equal(config.packageFileForFixtureSource("fixtures/Basic.lean"), "fixtures-basic.irpkg");

  for (const input of [null, [], "fixtures/Basic.lean"]) {
    assert.throws(() => deriveBrowserPackageConfig(withInputs([input])), /must be an object/);
  }
  assert.throws(
    () => deriveBrowserPackageConfig(withInputs([{ source: "fixtures/Basic.lean" }])),
    /module must be a non-empty module identity/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(withInputs([{ module: "Fixture.Basic" }])),
    /source must be a non-empty string/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(withInputs([
      { source: "fixtures/Basic.lean", module: "Fixture.Basic", roots: ["fib"] },
    ])),
    /unknown field roots/,
  );
  for (const module of ["--target-module", " Module", "Module\u0000"]) {
    assert.throws(
      () => deriveBrowserPackageConfig(withInputs([{ source: "fixtures/Basic.lean", module }])),
      /module identity|must not be an option/,
    );
  }
  const duplicate = { source: "fixtures/Basic.lean", module: "Fixture.Basic" };
  assert.throws(
    () => deriveBrowserPackageConfig(withInputs([duplicate, duplicate])),
    /fixture source is assigned to both/,
  );
  const sharedModule = browserConfig();
  sharedModule.packages[1].fixtureInputs = [
    { source: "elsewhere/Basic.lean", module: "Fixture.Basic" },
  ];
  assert.throws(
    () => deriveBrowserPackageConfig(sharedModule),
    /Fixture.Basic: fixture module is assigned to both fixtures\/Basic.lean and elsewhere\/Basic.lean/,
  );
});

test("package config rejects obsolete fixture aliases and malformed build prerequisites", () => {
  const obsolete = browserConfig();
  obsolete.packages[0].fixtureSources = ["fixtures/Basic.lean"];
  assert.throws(() => deriveBrowserPackageConfig(obsolete), /unknown field fixtureSources/);
  for (const lakeTargets of [null, "Vir", [""]]) {
    const config = browserConfig();
    config.packages[0].lakeTargets = lakeTargets;
    assert.throws(() => deriveBrowserPackageConfig(config), /lakeTargets/);
  }
  const config = browserConfig();
  config.packages[0].lakeTargets = ["Vir", "+Vir.Examples.Style:vir"];
  assert.doesNotThrow(() => deriveBrowserPackageConfig(config));
});
