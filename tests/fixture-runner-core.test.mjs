/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import { requireSuccessfulProcess } from "../scripts/process-utils.mjs";
import {
  classifyPackageFailure,
  packageDiagnostics,
} from "./support/fixture-diagnostics.mjs";
import {
  fixtureJobCount,
  fixtureMatchesFilter,
  parseFixtureRunnerConfig,
} from "./support/fixture-runner-config.mjs";

const report = [
  "# Package Report",
  "",
  "## Loaded IR Declarations",
  "",
  "- `Fixture.run` from `fixtures/Fixture.lean`",
  "- `Imported.dep` from `imported by Fixture.run`",
  "",
  "## Native Extern Declarations",
  "",
  "- `Nat.add` -> `lean_nat_add`",
  "",
  "## Initializer Globals",
  "",
  "- `Fixture.state` <- `Fixture.initState`",
  "",
  "## Missing IR Declarations",
  "",
  "- `Missing.decl` (via Fixture.run -> Fixture.helper)",
  "",
  "## Missing Native Extern Registrations",
  "",
  "- `Missing.extern`",
  "",
  "## Unsupported Init Globals",
  "",
  "- `Unsupported.state` (via Fixture.run)",
  "",
].join("\n");

test("package diagnostics parse report sections", () => {
  assert.deepEqual(packageDiagnostics(report), {
    loadedDecls: [
      { name: "Fixture.run", source: "fixtures/Fixture.lean", imported: false },
      { name: "Imported.dep", source: "imported by Fixture.run", imported: true },
    ],
    importedDecls: [
      { name: "Imported.dep", source: "imported by Fixture.run", imported: true },
    ],
    nativeExterns: [{ name: "Nat.add", symbol: "lean_nat_add" }],
    initGlobals: [{ name: "Fixture.state", initName: "Fixture.initState" }],
    missingDecls: [{ name: "Missing.decl", via: ["Fixture.run", "Fixture.helper"] }],
    missingNativeExterns: [{ name: "Missing.extern", via: [] }],
    unsupportedInitGlobals: [{ name: "Unsupported.state", via: ["Fixture.run"] }],
  });
});

test("package diagnostics ignore generated empty-section sentinels", () => {
  const emptyReport = [
    "## Loaded IR Declarations",
    "",
    "None.",
    "",
    "## Native Extern Declarations",
    "",
    "None.",
    "",
    "## Initializer Globals",
    "",
    "None.",
    "",
    "## Missing IR Declarations",
    "",
    "None.",
    "",
    "## Missing Native Extern Registrations",
    "",
    "None.",
    "",
    "## Unsupported Init Globals",
    "",
    "None.",
    "",
  ].join("\n");
  assert.deepEqual(packageDiagnostics(emptyReport), {
    loadedDecls: [],
    importedDecls: [],
    nativeExterns: [],
    initGlobals: [],
    missingDecls: [],
    missingNativeExterns: [],
    unsupportedInitGlobals: [],
  });
});

test("package diagnostics reject malformed known-section lines", () => {
  assert.throws(
    () => packageDiagnostics("## Missing IR Declarations\n\n- Missing.decl\n"),
    /invalid Missing IR Declarations report line: "- Missing\.decl"/,
  );
});

test("package failure classification follows boundary priority", () => {
  const diagnostics = packageDiagnostics(report);
  assert.deepEqual(classifyPackageFailure(diagnostics, "unsupported fallback"), {
    kind: "missing-native-extern",
    detail: "Missing.extern",
  });
  assert.deepEqual(classifyPackageFailure({
    ...diagnostics,
    missingNativeExterns: [],
  }, "unsupported fallback"), {
    kind: "missing-ir-decl",
    detail: "Missing.decl (via Fixture.run -> Fixture.helper)",
  });
  assert.deepEqual(classifyPackageFailure({
    ...diagnostics,
    missingNativeExterns: [],
    missingDecls: [],
  }, "unsupported fallback"), {
    kind: "unsupported-init-global",
    detail: "Unsupported.state (via Fixture.run)",
  });
});

test("package failure classification retains stderr fallbacks", () => {
  const diagnostics = packageDiagnostics("");
  assert.deepEqual(classifyPackageFailure(diagnostics, "unsupported codec\nmore detail"), {
    kind: "unsupported-ir-package",
    detail: "unsupported codec",
  });
  assert.deepEqual(classifyPackageFailure(diagnostics, "generator crashed\nmore detail"), {
    kind: "package-generation-failed",
    detail: "generator crashed",
  });
  assert.deepEqual(classifyPackageFailure(diagnostics, ""), {
    kind: "package-generation-failed",
    detail: "unknown failure",
  });
});

test("fixture runner configuration is immutable and preserves CLI behavior", () => {
  const config = parseFixtureRunnerConfig({
    argv: ["--no-build"],
    env: {
      VIR_FIXTURE_FILTER: "  Parser.Header  ",
      VIR_FIXTURE_JOBS: "3",
    },
    parallelism: 12,
  });
  assert.equal(Object.isFrozen(config), true);
  assert.deepEqual(config, {
    showHelp: false,
    fixtureFilter: "Parser.Header",
    skipBuild: true,
    configuredJobs: 3,
    parallelism: 12,
  });
  assert.throws(
    () => parseFixtureRunnerConfig({ argv: ["--unknown"] }),
    /unknown argument: --unknown/,
  );
  assert.equal(parseFixtureRunnerConfig({ argv: ["--help", "--unknown"] }).showHelp, true);
});

test("fixture runner configuration rejects malformed worker limits", () => {
  for (const value of ["0", "-1", "3 workers", "9007199254740992"]) {
    assert.throws(
      () => parseFixtureRunnerConfig({ env: { VIR_FIXTURE_JOBS: value } }),
      /VIR_FIXTURE_JOBS must be a (?:safe )?positive integer/,
    );
  }
});

test("fixture filters cover ids, sources, entries, and roots", () => {
  const fixture = {
    id: "parser-header",
    source: "fixtures/ParserHeader.lean",
    entry: "Fixture.run",
    roots: ["Fixture.helper"],
  };
  assert.equal(fixtureMatchesFilter(fixture, ""), true);
  assert.equal(fixtureMatchesFilter(fixture, "PARSER-HEADER"), true);
  assert.equal(fixtureMatchesFilter(fixture, "parserheader.lean"), true);
  assert.equal(fixtureMatchesFilter(fixture, "fixture.run"), true);
  assert.equal(fixtureMatchesFilter(fixture, "HELPER"), true);
  assert.equal(fixtureMatchesFilter(fixture, "missing"), false);
});

test("fixture job counts honor explicit and automatic limits", () => {
  const automatic = parseFixtureRunnerConfig({ parallelism: 12 });
  const explicit = parseFixtureRunnerConfig({
    env: { VIR_FIXTURE_JOBS: "20" },
    parallelism: 12,
  });
  assert.equal(fixtureJobCount(10, automatic), 6);
  assert.equal(fixtureJobCount(3, automatic), 3);
  assert.equal(fixtureJobCount(10, explicit), 10);
  assert.equal(fixtureJobCount(0, automatic), 0);
});

test("process result assertions share one failure format", () => {
  assert.doesNotThrow(() => requireSuccessfulProcess({ ok: true }, "command"));
  assert.throws(
    () => requireSuccessfulProcess({ ok: false, status: 3, stderr: "bad input" }, "command"),
    /command failed with status 3\nbad input/,
  );
});
