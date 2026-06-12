/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  defaultPackageFile,
  hostPackageFile,
  packageFileByFixtureSource,
} from "./browser-packages.js";
import fixtureManifest from "../../../fixtures/manifest.json";

export const maxFibInput = 17;
export const maxSortItems = 16;
export const maxSortValue = 9999;

export const demoFixtures = [
  {
    id: "fib",
    source: "examples/Fib.lean",
    entry: "fib",
    packageFile: defaultPackageFile,
    group: "demo",
    runner: "fib",
    result: { type: "Nat" },
    input: {
      kind: "nat",
      label: "Input",
      defaultValue: "8",
      max: maxFibInput,
      hint: `Nat, 0..${maxFibInput}`,
    },
  },
  {
    id: "sort-array",
    source: "examples/MergeSort.lean",
    entry: "SortDemo.demoFromArray",
    packageFile: defaultPackageFile,
    group: "demo",
    runner: "sort",
    result: { type: "Nat" },
    input: {
      kind: "natArray",
      label: "Array",
      defaultValue: "7, 3, 9, 1, 4, 1, 5, 2",
      hint: `Nat array, up to ${maxSortItems} items`,
    },
  },
  {
    id: "host-title",
    source: "examples/HostInterop.lean",
    entry: "HostInterop.titleHandshake",
    packageFile: hostPackageFile,
    group: "demo",
    runner: "hostTitle",
    result: { type: "String" },
    input: {
      kind: "string",
      label: "Title",
      defaultValue: "browser handshake",
      hint: "String passed from Lean to the browser document title",
    },
  },
  {
    id: "string-roundtrip",
    source: "fixtures/Basic.lean",
    entry: "Vir.Fixtures.Basic.stringUtf8RoundtripScore",
    packageFile: defaultPackageFile,
    group: "demo",
    runner: "singleString",
    result: { type: "Nat" },
    input: {
      kind: "string",
      label: "String",
      defaultValue: "Aé∀Z",
      hint: "String -> Nat score through Lean UTF-8 operations",
    },
  },
  {
    id: "bytearray-score",
    source: "fixtures/Basic.lean",
    entry: "Vir.Fixtures.Basic.byteArrayInputScore",
    packageFile: defaultPackageFile,
    group: "demo",
    runner: "byteArray",
    result: { type: "Nat" },
    input: {
      kind: "byteArray",
      label: "Bytes",
      defaultValue: "65, 66, 67",
      hint: "ByteArray values, each in 0..255",
    },
  },
];

export const manifestFixtures = (fixtureManifest.fixtures ?? []).map((fixture) => ({
  ...fixture,
  packageFile: packageFileByFixtureSource.get(fixture.source) ?? defaultPackageFile,
  group: "manifest",
}));

export const fixtures = [...demoFixtures, ...manifestFixtures];

export function createFixtureInputDefaults() {
  return new Map(
    demoFixtures
      .filter((fixture) => fixture.input)
      .map((fixture) => [fixture.id, fixture.input.defaultValue ?? ""]),
  );
}

export function matchesFixtureFilter(fixture, filter) {
  if (filter === "all") return true;
  if (filter === "demos") return fixture.group === "demo";
  return fixture.source === filter;
}

export function sourceLabel(path) {
  return path.replace(/^fixtures\//, "").replace(/^examples\//, "").replace(".lean", "");
}
