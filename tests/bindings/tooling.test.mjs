/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  renderBindingExplorerHtml,
} from "../../scripts/bindings/binding-explorer.mjs";
import {
  renderTypeAnchorReport,
} from "../../scripts/bindings/type-anchor-renderer.mjs";
import {
  emitGeneratedFile,
  requiredValue,
} from "../../scripts/bindings/tool-utils.mjs";
import {
  repositoryPath,
  repositoryRoot,
} from "../../scripts/repository-paths.mjs";

test("binding explorer rendering injects one script-safe report", () => {
  const template = "<script id=\"report-data\">__VIR_BINDING_REPORT__</script>";
  const rendered = renderBindingExplorerHtml(template, { unsafe: "</script>" });

  assert.equal(
    rendered,
    '<script id="report-data">{"unsafe":"\\u003c/script>"}</script>',
  );
  assert.throws(
    () => renderBindingExplorerHtml("no marker", {}),
    /exactly one report marker/u,
  );
});

test("type anchor rendering is a side-effect-free format choice", () => {
  const report = {
    summary: { exact: 1, compatible: 0, weak: 0, missing: 0 },
    diagnosticSummary: { error: 0, warning: 0, info: 0 },
    results: [],
  };

  assert.match(renderTypeAnchorReport(report), /exact\t1/u);
  assert.match(renderTypeAnchorReport(report, "html"), /<!doctype html>/u);
});

test("binding CLI argument helpers report errors without exiting", () => {
  assert.throws(
    () => requiredValue(["--check"], 0, "--out"),
    /--out requires a value/u,
  );
});

test("generated-file checks reject stale output without exiting", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "vir-binding-tooling-"));
  try {
    const output = join(temporary, "artifact.txt");
    await writeFile(output, "old\n");
    await assert.rejects(
      emitGeneratedFile(output, "new\n", {
        check: true,
        root: temporary,
        staleHint: "regenerate it",
      }),
      /artifact\.txt is stale; regenerate it/u,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("binding entry points own help and error exit status", () => {
  const script = repositoryPath(
    "scripts",
    "bindings",
    "generate-ts-descriptors.mjs",
  );
  const help = spawnSync(process.execPath, [script, "--help"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Generate Lean VIR TypeScript descriptor JSON/u);
  assert.equal(help.stderr, "");

  const invalid = spawnSync(process.execPath, [script, "--unknown"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(invalid.status, 1, invalid.stdout);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /^error: unknown option --unknown\n$/u);
});
