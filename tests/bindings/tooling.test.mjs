/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  renderBindingExplorerHtml,
} from "../../scripts/bindings/binding-explorer.mjs";
import {
  renderTypeAnchorReport,
} from "../../scripts/bindings/type-anchor-renderer.mjs";

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
