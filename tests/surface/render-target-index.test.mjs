/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  surfaceCounts,
  surfaceDefinition,
} from "./fixtures.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");

test("target index compares only compatible complete-frontier reports", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "vir-target-index-"));
  try {
    const generalPath = join(temporary, "general.json");
    const firPath = join(temporary, "fir.json");
    const zipPath = join(temporary, "zip.json");
    await Promise.all([
      writeFile(generalPath, `${JSON.stringify(reportFixture("Lean", false, []))}\n`),
      writeFile(firPath, `${JSON.stringify(reportFixture("Fir", true, ["IO.shared"]))}\n`),
      writeFile(zipPath, `${JSON.stringify(reportFixture("Zip", true, ["IO.shared", "Gzip.open"]))}\n`),
    ]);

    const oneTargetOutput = join(temporary, "one-target");
    runIndex(oneTargetOutput, [
      "lean", "Lean libraries", generalPath,
      "fir", "FIR compiler", firPath,
    ]);
    const oneTargetHtml = await readFile(join(oneTargetOutput, "index.html"), "utf8");
    const oneTargetHead = oneTargetHtml.match(/<thead>[\s\S]*?<\/thead>/u)?.[0] ?? "";
    assert.match(oneTargetHtml, /Add another selected-target analysis with a complete frontier/);
    assert.match(oneTargetHead, /FIR compiler/);
    assert.doesNotMatch(oneTargetHead, /Lean libraries/);

    const twoTargetOutput = join(temporary, "two-target");
    runIndex(twoTargetOutput, [
      "lean", "Lean libraries", generalPath,
      "fir", "FIR compiler", firPath,
      "lean-zip", "lean-zip operations", zipPath,
    ]);
    const twoTargetHtml = await readFile(join(twoTargetOutput, "index.html"), "utf8");
    const twoTargetHead = twoTargetHtml.match(/<thead>[\s\S]*?<\/thead>/u)?.[0] ?? "";
    assert.match(twoTargetHtml, /1 blocker is shared by every target/);
    assert.match(twoTargetHtml, /Boundary family \(distinct boundaries\)/);
    assert.match(twoTargetHead, /FIR compiler/);
    assert.match(twoTargetHead, /lean-zip operations/);
    assert.doesNotMatch(twoTargetHead, /Lean libraries/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("target index rejects duplicate output slugs", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "vir-target-index-slug-"));
  try {
    const reportPath = join(temporary, "report.json");
    await writeFile(reportPath, `${JSON.stringify(reportFixture("Fir", true, ["IO.shared"]))}\n`);
    const result = spawnSync(process.execPath, [
      "scripts/analysis/render-target-surface-index.mjs", join(temporary, "html"),
      "same", "First", reportPath,
      "same", "Second", reportPath,
    ], { cwd: repoRoot, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /duplicate report slug/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

function runIndex(output, args) {
  const result = spawnSync(
    process.execPath,
    ["scripts/analysis/render-target-surface-index.mjs", output, ...args],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function reportFixture(moduleName, completeFrontier, blockers) {
  const summaries = blockers.map((name) => ({
    blocker: { kind: "missingExtern", name },
    roots: 1,
    publicRoots: 1,
    exampleRoot: `${moduleName}.main`,
    examplePath: [`${moduleName}.main`, name],
  }));
  const selectedDeclarations = completeFrontier ? [`${moduleName}.main`] : [];
  const counts = surfaceCounts({
    total: selectedDeclarations.length,
    runnable: 0,
    blocked: selectedDeclarations.length,
    publicTotal: selectedDeclarations.length,
    publicRunnable: 0,
  });
  return {
    format: "lean-vir-library-surface",
    version: 3,
    lean: { version: "4.33.0", githash: "lean" },
    definition: surfaceDefinition(completeFrontier),
    selectedModules: [moduleName],
    selectedDeclarations,
    loadedModules: 1,
    closure: {
      selectedRoots: selectedDeclarations.length,
      capturedNodes: selectedDeclarations.length,
      rootReachableNodes: selectedDeclarations.length,
      supportOnlyNodes: 0,
    },
    runtimeCapabilities: {
      nativeExternCount: 0,
      primitiveNamespaces: ["Gzip", "IO"],
      nativeExterns: [],
    },
    counts,
    libraries: selectedDeclarations.length === 0 ? [] : [{
      name: moduleName.split(".", 1)[0],
      modulesWithFunctions: 1,
      counts,
    }],
    modules: selectedDeclarations.length === 0 ? [] : [{ name: moduleName, counts }],
    primaryBlockers: summaries.slice(0, 1),
    ...(completeFrontier ? { reachableBlockers: summaries } : {}),
    externs: blockers.map((name) => ({
      name,
      module: moduleName,
      status: "missing",
      targets: [],
      type: null,
      doc: null,
    })),
    declarations: selectedDeclarations.map((name) => ({
      name,
      module: moduleName,
      kind: "publicConstant",
      runnable: false,
      blocker: summaries[0]?.blocker ?? null,
      blockerPath: summaries[0]?.examplePath ?? [],
      type: null,
      doc: null,
      blockers: summaries.map((summary) => ({
        blocker: summary.blocker,
        path: summary.examplePath,
      })),
    })),
  };
}
