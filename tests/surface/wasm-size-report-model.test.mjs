/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  annotateRuntimeContextTree,
  annotateSurfaceSummaries,
  binaryPayload,
  buildOwnershipTree,
  buildSectionTree,
  connectSurfaceLinks,
  countKind,
  indexSurfaceLinks,
} from "../../scripts/analysis/wasm-size-report/model.mjs";

test("binary and section models retain sizes and account for framing bytes", () => {
  const report = {
    rawBytes: 120,
    gzipBytes: 61,
    sections: [
      { label: "Code", rawBytes: 80, gzipBytes: 40 },
      { label: "Data", rawBytes: 20, gzipBytes: 12 },
    ],
  };
  assert.deepEqual(binaryPayload(report, "/tmp/vir-release.wasm"), {
    file: "vir-release.wasm",
    rawBytes: 120,
    gzipBytes: 61,
    sections: [
      { name: "Code", rawBytes: 80, gzipBytes: 40 },
      { name: "Data", rawBytes: 20, gzipBytes: 12 },
    ],
  });
  assert.deepEqual(buildSectionTree(report, "release"), {
    id: "release-sections-root",
    name: "Release Wasm binary",
    kind: "root",
    bytes: 120,
    children: [
      { id: "section-0", name: "Code", kind: "section", bytes: 80, gzipBytes: 40 },
      { id: "section-1", name: "Data", kind: "section", bytes: 20, gzipBytes: 12 },
      {
        id: "section-header",
        name: "Wasm header",
        kind: "section",
        bytes: 20,
        gzipBytes: null,
      },
    ],
  });
});

test("ownership models aggregate symbols and connect runnable-surface declarations", () => {
  const tree = buildOwnershipTree({
    codeDataBytes: 100,
    symbols: [
      symbol({ rawBytes: 30, name: "lean_alloc", displayName: "lean_alloc" }),
      symbol({ rawBytes: 5, name: "lean_alloc", displayName: "lean::alloc" }),
      symbol({ rawBytes: 20, name: "lean_free", displayName: "lean::free" }),
      symbol({
        area: "VIR JS/WASM ABI",
        input: "build/wasm_upstream_shim_abi_call_abi.cpp.o",
        object: "wasm_upstream_shim_abi_call_abi.cpp.o",
        rawBytes: 25,
        name: "vir_call",
        displayName: "vir_call",
      }),
      symbol({ rawBytes: 0, name: "discarded", displayName: "discarded" }),
    ],
  });

  assert.equal(tree.bytes, 100);
  assert.deepEqual(tree.children.map((child) => [child.name, child.bytes]), [
    ["Lean C runtime", 55],
    ["VIR JS/WASM ABI", 25],
    ["Unattributed Code+Data", 20],
  ]);
  const runtimeObject = tree.children[0].children[0];
  assert.equal(runtimeObject.name, "Lean/runtime/alloc.cpp");
  assert.deepEqual(runtimeObject.children.map((child) => [child.name, child.bytes]), [
    ["lean::alloc", 35],
    ["lean::free", 20],
  ]);
  assert.equal(countKind(tree, "area"), 3);
  assert.equal(countKind(tree, "object"), 2);
  assert.equal(countKind(tree, "symbol"), 3);

  const links = indexSurfaceLinks({
    externs: [
      {
        name: "Lean.alloc",
        module: "Lean.Runtime",
        status: "native",
        targets: ["lean_alloc"],
        primaryRoots: 2,
        primaryPublicRoots: 1,
      },
      {
        name: "Lean.missing",
        module: "Lean.Runtime",
        status: "missing",
        targets: ["lean_missing"],
      },
    ],
  });
  assert.equal(connectSurfaceLinks(tree, links), 1);
  annotateSurfaceSummaries(tree);
  assert.deepEqual(tree.meta.surfaceSummary, {
    entries: 1,
    nativeEntries: 1,
    missingEntries: 0,
    primaryRoots: 2,
    primaryPublicRoots: 1,
  });
  assert.deepEqual(runtimeObject.meta.surfaceDeclarations.map((entry) => entry.name), [
    "Lean.alloc",
  ]);
});

test("runtime context annotation summarizes functions, boundaries, and frontier pressure", () => {
  const nativeDeclaration = surfaceDeclaration({
    name: "Lean.alloc",
    status: "native",
    primaryRoots: 2,
    primaryPublicRoots: 1,
  });
  const missingDeclaration = surfaceDeclaration({
    name: "Lean.missing",
    status: "missing",
    primaryRoots: 1,
  });
  const tree = {
    id: "runtime-root",
    name: "Runtime",
    kind: "root",
    bytes: 200,
    children: [
      {
        id: "member",
        name: "alloc.o",
        kind: "runtimeMember",
        bytes: 150,
        meta: { zeroFillBytes: 10 },
        children: [
          {
            id: "function-a",
            name: "lean_alloc",
            kind: "runtimeFunction",
            bytes: 100,
            meta: {
              inVirBoundary: true,
              retainedWasmBytes: 40,
              surfaceDeclarations: [nativeDeclaration],
            },
          },
          {
            id: "overhead",
            name: "Object metadata",
            kind: "runtimeOverhead",
            bytes: 50,
            meta: { inVirBoundary: false },
          },
        ],
      },
      {
        id: "function-b",
        name: "lean_missing",
        kind: "runtimeFunction",
        bytes: 50,
        meta: {
          inVirBoundary: false,
          retainedWasmBytes: 0,
          surfaceDeclarations: [missingDeclaration],
        },
      },
    ],
  };

  const annotations = annotateRuntimeContextTree(tree);
  assert.deepEqual(annotations.surfaceSummary, {
    entries: 2,
    nativeEntries: 1,
    missingEntries: 1,
    primaryRoots: 3,
    primaryPublicRoots: 1,
  });
  assert.deepEqual(
    {
      functionCount: tree.meta.functionCount,
      functionBytes: tree.meta.functionBytes,
      overheadBytes: tree.meta.overheadBytes,
      retainedFunctionCount: tree.meta.retainedFunctionCount,
      retainedNativeFunctionBytes: tree.meta.retainedNativeFunctionBytes,
      retainedWasmFunctionBytes: tree.meta.retainedWasmFunctionBytes,
      zeroFillBytes: tree.meta.zeroFillBytes,
    },
    {
      functionCount: 2,
      functionBytes: 150,
      overheadBytes: 50,
      retainedFunctionCount: 1,
      retainedNativeFunctionBytes: 100,
      retainedWasmFunctionBytes: 40,
      zeroFillBytes: 10,
    },
  );
  assert.equal(tree.meta.boundaryDensity, 0.5);
  assert.equal(tree.meta.frontierDensity, 3 * (1024 ** 2) / 200);
  assert.equal(annotations.maxFrontierDensity, 2 * (1024 ** 2) / 100);
});

function symbol(overrides = {}) {
  return {
    area: "Lean C runtime",
    input: "build/_home_user_third_party_lean4-src_src_runtime_alloc.cpp.o",
    object: "_home_user_third_party_lean4-src_src_runtime_alloc.cpp.o",
    section: "CODE",
    name: "lean_alloc",
    displayName: "lean_alloc",
    rawBytes: 1,
    ...overrides,
  };
}

function surfaceDeclaration(overrides = {}) {
  return {
    name: "Lean.entry",
    module: "Lean.Runtime",
    status: "native",
    target: "lean_entry",
    primaryRoots: 0,
    primaryPublicRoots: 0,
    frontierCosts: [],
    ...overrides,
  };
}
