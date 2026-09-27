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
  IR_PACKAGE_SECTION as SECTION, readIrPackageInfo, replaceIrPackageManifest,
} from "../../scripts/packages/irpkg-format.mjs";
import { assert, createRuntimeModuleProject, join, readFile } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-package-lifecycle-"));
try {
  const project = await createRuntimeModuleProject(join(directory, "modules"), {
    Lifecycle: `module
meta import Vir.Attributes
public import Vir.Js
public initialize Lifecycle.counter : IO.Ref Nat ← IO.mkRef 0
public initialize Lifecycle.value : Nat ← do
  Lifecycle.counter.modify (· + 1)
  Lifecycle.counter.get
@[vir_export] public def Lifecycle.read : IO Nat := Lifecycle.counter.get
@[vir_export] public def Lifecycle.answer : Nat := Lifecycle.value
@[vir_export] public def Lifecycle.failure : IO Nat := throw (IO.userError "lifecycle failure")
@[vir_js "test.lifecycle.a"] public opaque Lifecycle.hostA : Lean.Vir.RuntimeM Unit
@[vir_js "test.lifecycle.b"] public opaque Lifecycle.hostB : Lean.Vir.RuntimeM Unit
@[vir_export] public def Lifecycle.hostValue : Unit := ()
@[vir_export] public def Lifecycle.readA : IO Unit := Lifecycle.hostA.run
@[vir_export] public def Lifecycle.readB : IO Unit := Lifecycle.hostB.run
`,
  });
  const built = project.build();
  assert.equal(built.status, 0, `${built.stderr}\n${built.stdout}`);
  const path = join(directory, "lifecycle.irpkg");
  const generated = project.runVirIrpkg([
    path, join(directory, "lifecycle.report.md"), "--target-marked-module", "Lifecycle",
  ]);
  assert.equal(generated.status, 0, `${generated.stderr}\n${generated.stdout}`);
  const bytes = await readFile(path);
  const info = readIrPackageInfo(bytes);
  const hostCalls = [];
  const factory = createVirRuntimeFactory({
    hostBindings: {
      "test.lifecycle.a": () => { hostCalls.push("A"); },
      "test.lifecycle.b": () => { hostCalls.push("B"); },
    },
    wasmBytes: await readFile(process.argv[2] ??
      new URL("../../web/public/vir-upstream.wasm", import.meta.url)),
  });

  const emptyManifest = structuredClone(info.manifest);
  emptyManifest.exports = [];
  emptyManifest.hostImports = [];
  emptyManifest.metadata.targets = [];
  let empty = bytes;
  for (const kind of [SECTION.DECLARATIONS, SECTION.INIT_GLOBALS,
    SECTION.HOST_IMPORTS, SECTION.EXPORT_SUMMARIES]) {
    empty = replaceSection(empty, kind,
      kind === SECTION.DECLARATIONS ? new Uint8Array() : u32(0));
  }
  empty = replaceIrPackageManifest(empty, emptyManifest);

  await test("empty package succeeds with status 1 and declaration count 0", async () => {
    const runtime = await factory.createRuntime({ irPackageSet: [empty] });
    try {
      assert.equal(runtime.packageInfo.count, 0);
      assert.equal(runtime.packageInfo.packageCount, 1);
      assert.deepEqual(runtime.interfaceManifest.exports, []);
    } finally { runtime.dispose(); }
  });

  await test("empty dependency before nonempty root preserves count and initialization", async () => {
    const dependencyManifest = structuredClone(emptyManifest);
    dependencyManifest.metadata.packageSetMember = { module: "Lifecycle.Empty", role: "dependency" };
    const rootManifest = structuredClone(info.manifest);
    rootManifest.metadata.packageSetMember = { module: "Lifecycle", role: "root" };
    rootManifest.metadata.targets = rootManifest.metadata.targets.map(target => ({
      ...target, mode: "markedModule", roots: [],
    }));
    const runtime = await factory.createRuntime({ irPackageSet: [
      replaceIrPackageManifest(empty, dependencyManifest),
      replaceIrPackageManifest(bytes, rootManifest),
    ] });
    try {
      assert.equal(runtime.packageInfo.count, info.package.declarationCount);
      assert.equal(runtime.packageInfo.packageCount, 2);
      assert.equal(runtime.call("Lifecycle.answer"), "1");
      assert.equal(runtime.call("Lifecycle.read"), "1");
      assert.throws(() => runtime.call("Lifecycle.failure"), /IO action failed:.*lifecycle failure/);
      assert.equal(runtime.call("Lifecycle.read"), "1", "ordinary IO failure must preserve initialized globals");
      assert.equal(runtime.exports.vir_finish_ir_package_set(), 0);
      assert.match(runtime.lastPackageError(), /not prepared/);
      assert.equal(runtime.call("Lifecycle.read"), "1", "invalid finish must neither rerun nor retire initializers");
    } finally { runtime.dispose(); }
  });

  await test("raw phases, partial decoding, duplicates and abort remain transactional", async () => {
    const runtime = await factory.createRuntime();
    const e = runtime.exports;
    const append = input => withBytes(runtime, input, (ptr, size) => e.vir_append_ir_package(ptr, size));
    try {
      assert.equal(append(bytes), 0);
      assert.equal(e.vir_prepare_ir_package_set(), 0);
      assert.equal(e.vir_finish_ir_package_set(), 0);
      assert.equal(e.vir_begin_ir_package_set(), 1);
      assert.equal(e.vir_finish_ir_package_set(), 0);
      assert.equal(e.vir_prepare_ir_package_set(), 0);
      assert.match(runtime.lastPackageError(), /contains no packages/);
      assert.equal(append(empty), 1);
      assert.equal(runtime.packageDeclCount(), 0);
      assert.equal(runtime.lastPackageError(), "");
      // Truncate the declaration section after decoding has begun; the staged
      // empty member must survive cleanup of the partially decoded candidate.
      const decls = info.package.sections.find(section => section.kind === SECTION.DECLARATIONS);
      const partial = replaceSection(bytes, SECTION.DECLARATIONS,
        bytes.subarray(decls.offset, decls.offset + decls.byteLength - 1));
      assert.equal(append(partial), 0);
      assert.notEqual(runtime.lastPackageError(), "");
      assert.equal(runtime.packageDeclCount(), 0);
      assert.equal(append(bytes), 1);
      assert.equal(append(bytes), 0);
      assert.match(runtime.lastPackageError(), /duplicate IR declaration/);
      assert.equal(runtime.packageDeclCount(), info.package.declarationCount);
      assert.equal(e.vir_prepare_ir_package_set(), 1);
      assert.equal(runtime.lastPackageError(), "");
      assert.equal(e.vir_prepare_ir_package_set(), 0);
      assert.equal(append(empty), 0);
      assert.equal(e.vir_finish_ir_package_set(), 1);
      assert.equal(runtime.lastPackageError(), "");
      assert.equal(e.vir_finish_ir_package_set(), 0);
      assert.equal(runtime.packageDeclCount(), info.package.declarationCount);
      e.vir_abort_ir_package_set();
      e.vir_abort_ir_package_set();
      assert.equal(runtime.packageDeclCount(), 0);
      assert.equal(e.vir_package_interface_manifest_size(), 0);
      assert.equal(e.vir_package_format_version(), 0);
      assert.equal(e.vir_begin_ir_package_set(), 1);
      const missingExport = replaceSection(bytes, SECTION.EXPORT_SUMMARIES,
        Uint8Array.from([...u32(1), ...encodeName("Lifecycle.missing"), 0, ...u32(0), 0]));
      assert.equal(append(missingExport), 1);
      assert.equal(e.vir_prepare_ir_package_set(), 0);
      assert.match(runtime.lastPackageError(), /has no IR declaration/);
      assert.equal(append(empty), 0);
      assert.equal(e.vir_finish_ir_package_set(), 0);
      assert.equal(runtime.packageDeclCount(), info.package.declarationCount);
      assert.equal(e.vir_begin_ir_package_set(), 1);
      assert.equal(append(empty), 1);
      assert.equal(e.vir_prepare_ir_package_set(), 1);
      // Raw primitives may finish trusted bytes without a JS manifest parser.
      assert.equal(e.vir_finish_ir_package_set(), 1);
      assert.equal(runtime.packageDeclCount(), 0);
    } finally { runtime.dispose(); }
  });

  await test("initializer failure clears prepared state and permits a fresh installation", async () => {
    const section = info.package.sections.find(section => section.kind === SECTION.INIT_GLOBALS);
    const original = bytes.subarray(section.offset, section.offset + section.byteLength);
    const count = new DataView(original.buffer, original.byteOffset).getUint32(0, true);
    assert.ok(count >= 2);
    const failing = replaceSection(bytes, SECTION.INIT_GLOBALS, Uint8Array.from([
      ...u32(count + 2), ...original.subarray(4),
      ...encodeName("Lifecycle.hostValue"), ...encodeName("Lifecycle.readA"),
      ...encodeName("Lifecycle.failed"), ...encodeName("Lifecycle.failure"),
    ]));
    const runtime = await factory.createRuntime();
    try {
      assert.throws(() => runtime.loadIrPackageSetBytes([failing]),
        /initializer failed for `Lifecycle.failed` via `Lifecycle.failure`:.*lifecycle failure/);
      assert.equal(runtime.packageDeclCount(), 0);
      assert.equal(runtime.exports.vir_package_interface_manifest_size(), 0);
      assert.equal(runtime.packageInfo, null);
      assert.equal(runtime.interfaceManifest, null);
      // The failed initializer populated native lookup with a package-local host
      // trampoline. Retry with the same names at different slots to expose reuse.
      const retryManifest = structuredClone(info.manifest);
      assert.equal(retryManifest.hostImports.length, 2);
      retryManifest.hostImports.reverse().forEach((entry, slot) => { entry.slot = slot; });
      const hostRecords = retryManifest.hostImports.flatMap(entry => [
        ...encodeName(entry.name), ...encodeString(entry.target), ...encodeString(entry.symbol),
        ...u32(entry.arity), ...u32(entry.erasedPrefixArgs), entry.effect === "pure" ? 0 : 1,
      ]);
      const retry = replaceIrPackageManifest(replaceSection(bytes, SECTION.HOST_IMPORTS,
        Uint8Array.from([...u32(2), ...hostRecords])), retryManifest);
      runtime.loadIrPackageSetBytes([retry]);
      assert.equal(runtime.call("Lifecycle.answer"), "1");
      assert.equal(runtime.call("Lifecycle.read"), "1");
      assert.deepEqual(hostCalls, ["A"], "the failed initializer must have called host A");
      hostCalls.length = 0;
      runtime.call("Lifecycle.readA");
      runtime.call("Lifecycle.readB");
      assert.deepEqual(hostCalls, ["A", "B"], "retry must resolve the new host slots");
    } finally { runtime.dispose(); }
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}

function withBytes(runtime, bytes, action) {
  const ptr = runtime.allocBytes(bytes);
  try { return action(ptr, bytes.length); }
  finally { runtime.freeBytes(ptr); }
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function encodeString(value) {
  const text = new TextEncoder().encode(value);
  return Uint8Array.from([...u32(text.length), ...text]);
}

function encodeName(value) {
  let name = Uint8Array.of(0);
  for (const part of value.split(".")) {
    const text = new TextEncoder().encode(part);
    name = Uint8Array.from([1, ...name, ...u32(text.length), ...text]);
  }
  return name;
}

// Relocate only the selected section; keep the actual compiler-produced IR.
function replaceSection(input, kind, contents) {
  const sections = readIrPackageInfo(input).package.sections;
  const bytes = Uint8Array.from([...input, ...contents]);
  const view = new DataView(bytes.buffer);
  const declarationCountOffset = 4 + view.getUint32(0, true) + 4;
  const directoryEntry = declarationCountOffset + 8 + 12 * sections.findIndex(s => s.kind === kind);
  view.setUint32(directoryEntry + 4, input.length, true);
  view.setUint32(directoryEntry + 8, contents.length, true);
  if (kind === SECTION.DECLARATIONS && contents.length === 0) {
    view.setUint32(declarationCountOffset, 0, true);
  }
  return bytes;
}
