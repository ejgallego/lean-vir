/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  candidatePressure,
  compactFrontierCostReport,
  markdownReport,
  normalizeCandidate,
  validateFrontierCostReport,
} from "./frontier-size-costs.mjs";

test("frontier size candidates reject duplicate names", () => {
  assert.throws(
    () => normalizeCandidate({ id: "duplicate", names: ["Float.add", "Float.add"] }, "test"),
    /names must be unique/,
  );
});

test("frontier size pressure sums distinct primary blockers", () => {
  const candidate = normalizeCandidate({
    id: "float-basic",
    names: ["Float.add", "Float.beq"],
  }, "test");
  const pressure = candidatePressure(candidate, new Map([
    ["Float.add", {
      primaryRoots: 59,
      primaryPublicRoots: 8,
      targets: ["lean_float_add"],
    }],
    ["Float.beq", {
      primaryRoots: 45,
      primaryPublicRoots: 4,
      targets: ["lean_float_beq"],
    }],
  ]));
  assert.deepEqual(pressure, {
    primaryRoots: 104,
    primaryPublicRoots: 12,
    targets: ["lean_float_add", "lean_float_beq"],
  });
});

test("frontier size markdown reports exact bytes and pressure density", () => {
  const markdown = markdownReport({
    baseline: { rawBytes: 1000, gzipBytes: 500 },
    candidates: [{
      id: "Float.add",
      names: ["Float.add"],
      targets: ["lean_float_add"],
      rawDeltaBytes: 256,
      gzipDeltaBytes: 32,
      primaryRoots: 59,
      primaryPublicRoots: 8,
      primaryRootsPerRawKiB: 236,
    }],
  });
  assert.match(markdown, /Baseline: 1,000 B raw, 500 B gzip\n/);
  assert.match(markdown, /`Float\.add` \| 1 \| 256 B \| 32 B/);
  assert.match(markdown, /Primary-root density is a prioritization hint/);
  assert.match(markdown, /`lean_float_add`/);
});

test("frontier size report compaction keeps only deployable measurements", () => {
  const report = {
    format: "lean-vir-frontier-size-costs",
    version: 1,
    generatedAt: "2026-08-09T00:00:00.000Z",
    baseline: { rawBytes: 1000, gzipBytes: 500, sha256: "baseline", path: "/tmp/private" },
    candidates: [{
      id: "Float.add",
      names: ["Float.add"],
      rawDeltaBytes: 256,
      gzipDeltaBytes: 32,
      primaryRoots: 59,
      primaryPublicRoots: 8,
      artifact: { path: "/tmp/private-candidate", sha256: "candidate" },
    }],
  };
  assert.equal(validateFrontierCostReport(report), report);
  assert.deepEqual(compactFrontierCostReport(report), {
    format: report.format,
    version: report.version,
    generatedAt: report.generatedAt,
    baseline: { rawBytes: 1000, gzipBytes: 500, sha256: "baseline" },
    candidates: [{
      id: "Float.add",
      names: ["Float.add"],
      rawDeltaBytes: 256,
      gzipDeltaBytes: 32,
      primaryRoots: 59,
      primaryPublicRoots: 8,
      error: undefined,
    }],
  });
});
