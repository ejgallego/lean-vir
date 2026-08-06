/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { runSync } from "./process-utils.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outputDir = await mkdtemp(join(tmpdir(), "vir-surface-smoke-"));
const jsonPath = join(outputDir, "surface.json");
const markdownPath = join(outputDir, "surface.md");
const htmlDir = join(outputDir, "html");
const selectedModule = "Lean.Expr";

try {
  runSync("lake", ["build", "vir_surface"], { cwd: repoRoot, capture: true });
  runSync(
    ".lake/build/bin/vir_surface",
    [jsonPath, markdownPath, "--module", selectedModule],
    { cwd: repoRoot, capture: true },
  );

  const report = JSON.parse(await readFile(jsonPath, "utf8"));
  const markdown = await readFile(markdownPath, "utf8");

  assert.equal(report.format, "lean-vir-library-surface");
  assert.equal(report.version, 2);
  assert.equal(report.definition.headline, "static transitive IR closure completeness");
  assert.equal(report.definition.encodingIsGate, false);
  assert.deepEqual(report.selectedModules, [selectedModule]);
  assert.ok(report.loadedModules >= 1);
  assert.ok(report.counts.total > 0);
  assert.equal(report.declarations.length, report.counts.total);
  assert.ok(report.externs.length > 0);
  assert.equal(report.counts.blocked, report.counts.total - report.counts.runnable);
  assert.equal(
    report.counts.total,
    report.counts.publicTotal + report.counts.privateTotal
      + report.counts.boxedTotal + report.counts.generatedTotal,
  );
  assert.ok(report.counts.publicRunnable <= report.counts.publicTotal);
  assert.equal(
    report.libraries.reduce((total, library) => total + library.counts.total, 0),
    report.counts.total,
  );
  assert.equal(
    report.modules.reduce((total, module) => total + module.counts.total, 0),
    report.counts.total,
  );
  assert.equal(
    report.primaryBlockers.reduce((total, summary) => total + summary.roots, 0),
    report.counts.blocked,
  );

  for (const declaration of report.declarations) {
    assert.equal(declaration.module, selectedModule);
    if (declaration.runnable) {
      assert.equal(declaration.blocker, null);
      assert.deepEqual(declaration.blockerPath, []);
    } else {
      assert.ok(declaration.blocker);
      assert.equal(declaration.blockerPath[0], declaration.name);
      assert.equal(
        declaration.blockerPath[declaration.blockerPath.length - 1],
        declaration.blocker.name,
      );
    }
  }

  const eqv = report.externs.find((declaration) => declaration.name === "Lean.Expr.eqv");
  assert.ok(eqv);
  assert.equal(eqv.module, selectedModule);
  assert.equal(eqv.status, "native");
  assert.deepEqual(eqv.targets, [{
    kind: "standard",
    backend: "all",
    value: "lean_expr_eqv",
  }]);
  const dbgToString = report.externs.find(
    (declaration) => declaration.name === "Lean.Expr.dbgToString",
  );
  assert.ok(dbgToString);
  assert.equal(dbgToString.module, selectedModule);
  assert.equal(dbgToString.status, "missing");
  assert.deepEqual(dbgToString.targets, [{
    kind: "standard",
    backend: "all",
    value: "lean_expr_dbg_to_string",
  }]);

  assert.match(markdown, /^# VIR Lean Library Surface/m);
  assert.match(markdown, /## By Library/);
  assert.match(markdown, new RegExp("\\| `" + selectedModule.replaceAll(".", "\\.") + "` \\|"));

  runSync(
    process.execPath,
    ["scripts/render-surface-report.mjs", jsonPath, htmlDir],
    { cwd: repoRoot, capture: true },
  );
  const htmlManifest = JSON.parse(await readFile(join(htmlDir, "vir-surface-html.json"), "utf8"));
  assert.equal(htmlManifest.format, "lean-vir-surface-html");
  assert.equal(htmlManifest.version, 2);
  assert.equal(htmlManifest.selectedModules, 1);
  assert.equal(htmlManifest.declarations, report.counts.total);
  assert.equal(htmlManifest.externs, report.externs.length);

  const indexHtml = await readFile(join(htmlDir, "index.html"), "utf8");
  assert.match(indexHtml, /VIR Runnable Surface/);
  assert.match(indexHtml, /data\/index\.js/);
  assert.match(indexHtml, /assets\/app\.js/);

  const indexContext = { globalThis: {} };
  runInNewContext(await readFile(join(htmlDir, "data/index.js"), "utf8"), indexContext);
  const htmlIndex = indexContext.globalThis.__virSurfaceIndex;
  assert.equal(htmlIndex.modules.length, 1);
  assert.equal(htmlIndex.modules[0].name, selectedModule);
  assert.equal(htmlIndex.modules[0].declarationCount, report.counts.total);
  assert.equal(htmlIndex.modules[0].externCount, report.externs.length);
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      htmlIndex.externs.find((declaration) => declaration.name === "Lean.Expr.eqv"),
    )),
    eqv,
  );

  const moduleFiles = await readdir(join(htmlDir, "data/modules"));
  assert.deepEqual(moduleFiles, ["000000.js"]);
  let modulePayload;
  const moduleContext = {
    globalThis: {
      __virSurfaceAcceptModule(value) {
        modulePayload = value;
      },
    },
  };
  runInNewContext(
    await readFile(join(htmlDir, "data/modules/000000.js"), "utf8"),
    moduleContext,
  );
  assert.equal(modulePayload.name, selectedModule);
  assert.equal(modulePayload.declarations.length, report.counts.total);
  for (const declaration of modulePayload.declarations) {
    assert.ok(declaration.length === 3 || declaration.length === 6);
    assert.ok(declaration[2] === 0 || declaration[2] === 1);
  }
  console.log(
    `surface report smoke ok (${report.counts.total} IR functions, ${report.externs.length} externs)`,
  );
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
