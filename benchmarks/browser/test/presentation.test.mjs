import assert from "node:assert/strict";
import test from "node:test";

import {
  backendColor,
  createBackendSelection,
  formatMetric,
  normalizeBenchmarkReport,
} from "../src/presentation.js";

test("backend presentation identity is stable across examples", () => {
  assert.equal(backendColor("vir"), "#f0a35e");
  assert.equal(backendColor("fir-native"), "#d879c6");
  assert.equal(
    backendColor("client-specific"),
    backendColor("client-specific"),
  );
  assert.match(backendColor("client-specific"), /^#[0-9a-f]{6}$/i);
});

test("backend selection preserves a nonempty visible intersection", () => {
  const selection = createBackendSelection();
  assert.deepEqual(selection.selected(["vir", "js"]), ["vir", "js"]);
  selection.set(["vir"]);
  assert.deepEqual(selection.selected(["vir", "js"]), ["vir"]);
  assert.deepEqual(selection.selected(["fir-native", "fflate"]), [
    "fir-native",
    "fflate",
  ]);
});

test("lean-zip reports normalize without changing their producer schema", () => {
  const report = {
    schemaVersion: 1,
    kind: "lean-zip/browser-benchmark-report",
    generatedAt: "2026-08-22T00:00:00Z",
    study: "suite",
    passed: true,
    backendIds: ["vir", "fflate"],
    cells: [
      {
        vector: "repeated-1k",
        level: 6,
        results: [
          {
            backend: "vir",
            outputBytes: 41,
            valid: true,
            exactNative: true,
            firstCallMs: 8.5,
            medianMs: 2.25,
          },
          {
            backend: "fflate",
            outputBytes: 38,
            valid: true,
            exactNative: null,
            firstCallMs: 0.9,
            medianMs: 0.2,
          },
        ],
      },
    ],
    caveats: ["Diagnostic timings only."],
  };
  const model = normalizeBenchmarkReport(report, [
    { id: "vir", label: "VIR" },
    { id: "fflate", label: "fflate" },
  ]);
  assert.equal(model.title, "Compression comparison · suite");
  assert.deepEqual(
    model.metrics.map(({ id }) => id),
    ["outputBytes", "firstCallMs", "steadyMs"],
  );
  assert.deepEqual(
    model.rows.map(({ groupLabel, backendLabel, passed, metrics }) => ({
      groupLabel,
      backendLabel,
      passed,
      metrics,
    })),
    [
      {
        groupLabel: "repeated-1k · level 6",
        backendLabel: "VIR",
        passed: true,
        metrics: { outputBytes: 41, firstCallMs: 8.5, steadyMs: 2.25 },
      },
      {
        groupLabel: "repeated-1k · level 6",
        backendLabel: "fflate",
        passed: true,
        metrics: { outputBytes: 38, firstCallMs: 0.9, steadyMs: 0.2 },
      },
    ],
  );
  assert.equal(report.cells[0].results[0].medianMs, 2.25);
});

test("pretty reports reuse the same workload and metric model", () => {
  const model = normalizeBenchmarkReport(
    {
      schemaVersion: 2,
      kind: "differential",
      passed: true,
      backendIds: ["js", "vir"],
      scenarios: [
        {
          caseId: "nested",
          label: "Nested document",
          width: 80,
          parity: true,
          backends: {
            js: {
              errors: [],
              summary: {
                totalMs: { median: 1.5 },
                executeMs: { median: 1.1 },
              },
            },
            vir: {
              errors: [],
              summary: {
                totalMs: { median: 4.5 },
                executeMs: { median: 3.8 },
              },
            },
          },
        },
      ],
    },
    [
      { id: "js", label: "JavaScript" },
      { id: "vir", label: "VIR" },
    ],
  );
  assert.deepEqual(
    model.metrics.map(({ id }) => id),
    ["totalMs", "executeMs"],
  );
  assert.deepEqual(
    model.rows.map(({ groupLabel, backendLabel, metrics }) => ({
      groupLabel,
      backendLabel,
      metrics,
    })),
    [
      {
        groupLabel: "Nested document · 80px",
        backendLabel: "JavaScript",
        metrics: {
          totalMs: 1.5,
          prepareMs: null,
          executeMs: 1.1,
          marshalMs: null,
          decodeMs: null,
          renderMs: null,
        },
      },
      {
        groupLabel: "Nested document · 80px",
        backendLabel: "VIR",
        metrics: {
          totalMs: 4.5,
          prepareMs: null,
          executeMs: 3.8,
          marshalMs: null,
          decodeMs: null,
          renderMs: null,
        },
      },
    ],
  );
});

test("dimension-based client reports use the shared scaling adapter", () => {
  const model = normalizeBenchmarkReport(
    {
      schemaVersion: 1,
      kind: "scaling",
      passed: true,
      backendIds: ["js", "vir"],
      dimensions: [
        {
          id: "trace",
          label: "Trace length",
          points: [
            {
              workloadId: "player",
              workloadLabel: "Player trace",
              size: 10,
              sizeLabel: "10",
              parity: true,
              backends: {
                js: {
                  errors: [],
                  summary: {
                    totalMs: { median: 0.5 },
                    prepareMs: { median: 0.1 },
                  },
                },
                vir: {
                  errors: [],
                  summary: {
                    totalMs: { median: 3.5 },
                    prepareMs: { median: 0.4 },
                  },
                },
              },
            },
          ],
        },
      ],
    },
    [
      { id: "js", label: "JavaScript" },
      { id: "vir", label: "VIR" },
    ],
  );
  assert.deepEqual(
    model.metrics.map(({ id }) => id),
    ["totalMs", "prepareMs"],
  );
  assert.deepEqual(
    model.rows.map(({ groupId, groupLabel, backendLabel }) => ({
      groupId,
      groupLabel,
      backendLabel,
    })),
    [
      {
        groupId: "trace/player/10",
        groupLabel: "Trace length · Player trace · 10",
        backendLabel: "JavaScript",
      },
      {
        groupId: "trace/player/10",
        groupLabel: "Trace length · Player trace · 10",
        backendLabel: "VIR",
      },
    ],
  );
});

test("retained-memory reports preserve dimension identity and memory metrics", () => {
  const model = normalizeBenchmarkReport(
    {
      kind: "memory-retained",
      passed: true,
      backendIds: ["vir"],
      points: [
        {
          dimension: "depth",
          dimensionLabel: "Document depth",
          caseId: "nested",
          label: "Nested document",
          size: 32,
          sizeLabel: "32 levels",
          parity: true,
          backends: {
            vir: {
              errors: [],
              timing: { totalMs: { median: 4.25 } },
              retainedResidentGrowthBytes: 4096,
              retainedCommittedGrowthBytes: 8192,
            },
          },
        },
      ],
    },
    [{ id: "vir", label: "VIR" }],
  );
  assert.deepEqual(
    model.metrics.map(({ id }) => id),
    ["totalMs", "retainedResidentBytes", "retainedCommittedBytes"],
  );
  assert.deepEqual(model.rows[0], {
    groupId: "depth/nested/32",
    groupLabel: "Document depth · Nested document · 32 levels",
    backendId: "vir",
    backendLabel: "VIR",
    passed: true,
    metrics: {
      totalMs: 4.25,
      retainedResidentBytes: 4096,
      retainedCommittedBytes: 8192,
    },
  });
});

test("metric formatting keeps timing and size units explicit", () => {
  assert.equal(formatMetric(0.001, "ms"), "<0.01 ms");
  assert.equal(formatMetric(1.25, "ms"), "1.25 ms");
  assert.equal(formatMetric(1536, "bytes"), "1.5 KiB");
});

test("reports must carry the common backend identity boundary", () => {
  assert.throws(
    () => normalizeBenchmarkReport({ kind: "custom" }, []),
    /identify its backends/,
  );
});
