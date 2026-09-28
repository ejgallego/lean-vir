/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import {
  IR_PACKAGE_SECTION as SECTION,
  readIrPackageInfo,
  replaceIrPackageManifest,
} from "../../scripts/packages/irpkg-format.mjs";
import { assert, createRuntimeModuleProject, join, readFile } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-call-preparation-"));
try {
  const project = await createRuntimeModuleProject(join(directory, "modules"), {
    CallPreparation: `module
public def CallPreparation.nat (value : Nat) : Nat := value
public def CallPreparation.wide (value : UInt64) : UInt64 := value
`,
  });
  const built = project.build();
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const path = join(directory, "calls.irpkg");
  const generated = project.runVirIrpkg([
    path, join(directory, "calls.report.md"),
    "--target-all-module", "CallPreparation",
  ]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const bytes = await readFile(path);
  const info = readIrPackageInfo(bytes);
  const factory = createVirRuntimeFactory({
    wasmBytes: await readFile(new URL("../../web/public/vir-upstream.wasm", import.meta.url)),
  });

  // Both metadata copies agree, but neither establishes that the export has
  // an executable declaration. This must fail at prepare, not the first call.
  const renamedManifest = structuredClone(info.manifest);
  renamedManifest.exports.find(entry => entry.entry === "CallPreparation.nat").entry =
    "CallPreparation.bad";
  renamedManifest.exports.find(entry => entry.entry === "CallPreparation.bad").nameKey =
    "s43616c6c5072657061726174696f6e/s626164/";
  const missingExport = replaceIrPackageManifest(
    replaceSectionBytes(bytes, SECTION.EXPORT_SUMMARIES,
      encodeName("CallPreparation.nat"), encodeName("CallPreparation.bad")),
    renamedManifest,
  );
  await test("unbound exports are rejected before finalization", () =>
    assertRejectedBeforeFinish(missingExport,
      /interface export `CallPreparation.bad` has no IR declaration/));

  // Keep the 64-bit base and wrapper body intact, but remove the wrapper's
  // association with this export. A base cannot satisfy a boxed boundary.
  const boxedHeader = Uint8Array.from([
    ...encodeName("CallPreparation.wide._boxed"), 1,
    ...encodeName("CallPreparation.wide"),
  ]);
  const unrelatedBoxedHeader = Uint8Array.from([
    ...encodeName("CallPreparation.wide._boxed"), 1,
    ...encodeName("CallPreparation.lost"),
  ]);
  const missingBoxed = replaceSectionBytes(bytes, SECTION.DECLARATIONS,
    boxedHeader, unrelatedBoxedHeader);
  await test("64-bit exports require their boxed declaration before finalization", () =>
    assertRejectedBeforeFinish(missingBoxed,
      /interface export `CallPreparation.wide` requires a boxed IR declaration/));

  // Declarations may be in a dependency while the root owns their public
  // summaries. Resolving separately within each decoded member loses them.
  const dependencyManifest = structuredClone(info.manifest);
  dependencyManifest.exports = [];
  dependencyManifest.metadata.targets = [];
  dependencyManifest.metadata.packageSetMember = {
    module: "CallPreparation.Declarations", role: "dependency",
  };
  const dependency = replaceIrPackageManifest(
    emptySection(bytes, SECTION.EXPORT_SUMMARIES), dependencyManifest,
  );
  const rootManifest = structuredClone(info.manifest);
  rootManifest.metadata.packageSetMember = {
    module: "CallPreparation.Exports", role: "root",
  };
  rootManifest.metadata.targets = [{
    module: "CallPreparation.Exports", mode: "markedModule", roots: [],
    resolvedRoots: info.manifest.metadata.targets.flatMap(target => target.resolvedRoots),
  }];
  const root = replaceIrPackageManifest(
    emptySection(bytes, SECTION.DECLARATIONS), rootManifest,
  );
  await test("root exports resolve base and boxed declarations in another member", async () => {
    const splitRuntime = await factory.createRuntime({ irPackageSet: [dependency, root] });
    try {
      assert.equal(splitRuntime.packageInfo.packageCount, 2);
      assert.equal(splitRuntime.packageDeclCount(), info.package.declarationCount);
      assertCallable(splitRuntime);
    } finally {
      splitRuntime.dispose();
    }
  });

  async function assertRejectedBeforeFinish(packageBytes, pattern) {
    const runtime = await factory.createRuntime();
    let finishes = 0;
    const exports = runtime.exports;
    runtime.exports = {
      ...exports,
      vir_finish_ir_package_set() {
        finishes += 1;
        return exports.vir_finish_ir_package_set();
      },
    };
    try {
      assert.throws(() => runtime.loadIrPackageSetBytes([packageBytes]), pattern);
      assert.equal(finishes, 0, "invalid exports must fail before initializers can run");
      assert.equal(runtime.packageDeclCount(), 0);
      assert.equal(runtime.packageInfo, null);
      assert.equal(runtime.interfaceManifest, null);
      assert.equal(runtime.exports.vir_package_interface_manifest_size(), 0);
      // Failed preparation/abort must leave the initial-install path reusable.
      runtime.loadIrPackageSetBytes([bytes]);
      assert.equal(finishes, 1);
      assertCallable(runtime);
    } finally {
      runtime.dispose();
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

function assertCallable(runtime) {
  assert.equal(runtime.call("CallPreparation.nat", "12345678901234567890"), "12345678901234567890");
  assert.equal(runtime.call("CallPreparation.wide", "18446744073709551615"), "18446744073709551615");
}

// This fixture uses only string-component names; these helpers edit selected
// record headers/sections without duplicating the IR body decoder.
function encodeName(value) {
  let name = Uint8Array.of(0);
  for (const part of value.split(".")) {
    const text = new TextEncoder().encode(part);
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, text.length, true);
    name = Uint8Array.from([1, ...name, ...length, ...text]);
  }
  return name;
}

function replaceSectionBytes(input, kind, before, after) {
  assert.equal(before.length, after.length);
  const section = readIrPackageInfo(input).package.sections.find(s => s.kind === kind);
  const bytes = Buffer.from(input);
  const contents = bytes.subarray(section.offset, section.offset + section.byteLength);
  const offset = contents.indexOf(before);
  assert.ok(offset >= 0, "fixture record header must exist");
  assert.equal(contents.indexOf(before, offset + 1), -1, "fixture record header must be unique");
  contents.set(after, offset);
  return bytes;
}

function emptySection(input, kind) {
  const bytes = Uint8Array.from(input);
  const view = new DataView(bytes.buffer);
  const sections = readIrPackageInfo(bytes).package.sections;
  const index = sections.findIndex(section => section.kind === kind);
  const section = sections[index];
  const declarationCountOffset = 4 + view.getUint32(0, true) + 4;
  const directoryEntry = declarationCountOffset + 8 + 12 * index;
  assert.equal(view.getUint32(directoryEntry, true), kind);
  view.setUint32(directoryEntry + 8, kind === SECTION.DECLARATIONS ? 0 : 4, true);
  view.setUint32(kind === SECTION.DECLARATIONS ? declarationCountOffset : section.offset, 0, true);
  return bytes;
}
