/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateFixtureManifest } from "../fixtures/fixture-manifest.mjs";
import {
  browserPackageConfigVersion,
  deriveBrowserPackageConfig,
} from "../web/src/pages/browser-package-config.js";

function packageSpec(id, overrides = {}) {
  return { id, file: `${id}.irpkg`, fixtureSources: [], ...overrides };
}

function browserConfig(overrides = {}) {
  return {
    version: browserPackageConfigVersion,
    defaultPackage: "fixtures-basic",
    hostPackage: "demo-host",
    packages: [
      packageSpec("fixtures-basic", { fixtureSources: ["fixtures/Basic.lean"] }),
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
    readFile(new URL("../fixtures/browser-packages.json", import.meta.url), "utf8"),
    readFile(new URL("../fixtures/manifest.json", import.meta.url), "utf8"),
  ]);
  const config = deriveBrowserPackageConfig(JSON.parse(rawBrowserConfig));
  const fixtures = validateFixtureManifest(JSON.parse(rawFixtureManifest));
  const sources = new Set(fixtures.map((fixture) => fixture.source));

  assert.equal(browserPackageConfigVersion, 1);
  for (const source of sources) {
    assert.match(config.packageFileForFixtureSource(source), /\.irpkg$/);
  }
});

test("browser package configs reject malformed containers and versions", () => {
  for (const config of [null, []]) {
    assert.throws(() => deriveBrowserPackageConfig(config), /browser package config must be an object/);
  }
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({ version: 2 })),
    /browser package config version must be 1, got 2/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({ typo: true })),
    /browser package config: unknown field typo/,
  );
  assert.throws(
    () => deriveBrowserPackageConfig(browserConfig({ packages: [] })),
    /packages must be a non-empty array/,
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
        ? { ...spec, fixtureSources: ["fixtures/Basic.lean"] }
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
        ? { ...spec, fixtureSources: "fixtures/Basic.lean" }
        : spec),
    })),
    /fixtures-basic: fixtureSources must be an array/,
  );
});
