/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { readIrPackageInfo, replaceIrPackageManifest } from "../../scripts/packages/irpkg-format.mjs";
import { IR_PACKAGE_SECTION, irPackageManifestChecksum } from "../../web/src/runtime/ir-package.js";
import { assert, createRuntimeModuleProject, join, readFile } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-name-identity-"));
try {
  const source = await readFile(new URL("../../fixtures/runtime/EscapedCallNames.lean", import.meta.url), "utf8");
  const project = await createRuntimeModuleProject(join(directory, "modules"), {
    NameIdentity: (source + '\n@[vir_export] def boxedIdentity (n : UInt64) : UInt64 := n\n').replace("Lean.Name.num `Numeral 1,", "Lean.Name.num `Numeral 1, Lean.Name.num `Large 4294967295,"),
    TooLargeName: source.replace("Lean.Name.num `Numeral 1,", "Lean.Name.num `Numeral 1, Lean.Name.num `TooLarge 4294967296,"),
  });
  const built = project.build();
  assert.equal(built.status, 0, `${built.stderr}\n${built.stdout}`);
  const path = join(directory, "names.irpkg");
  const generated = project.runVirIrpkg([path, join(directory, "names.report.md"), "--target-marked-module", "NameIdentity"]);
  assert.equal(generated.status, 0, `${generated.stderr}\n${generated.stdout}`);
  const bytes = await readFile(path);
  const info = readIrPackageInfo(bytes);
  assert.equal(info.manifest.version, 10);
  const factory = createVirRuntimeFactory({ wasmBytes: await readFile(new URL("../../web/public/vir-upstream.wasm", import.meta.url)) });
  const key = parts => parts.map(part => typeof part === "string"
    ? `s${Buffer.from(part, "utf8").toString("hex")}/` : `n${part.num}/`).join("");
  const cases = [
    ["«foo.bar»", ["foo.bar"], 1],
    ["Numeric.«1»", ["Numeric", "1"], 2],
    ["Numeral.1", ["Numeral", { num: "1" }], 2],
    ["Large.4294967295", ["Large", { num: "4294967295" }], 2],
    ["café", ["café"], 3],
    ["αβ₁", ["αβ₁"], 4],
    ["Empty.«»", ["Empty", ""], 2],
    ["Closing.»", ["Closing", "»"], 2],
    ["#meta.part.with.dot", ["#meta", "part.with.dot"], 5],
    ["Hygienic.part.with.dot._hyg", ["Hygienic", "part.with.dot", "_hyg"], 2],
  ];
  await test("structural keys preserve exotic exported names independently of display aliases", async () => {
    const runtime = await factory.createRuntime({ irPackageSet: [bytes] });
    try {
      for (const [entry, parts, increment] of cases) {
        assert.equal(info.manifest.exports.find(value => value.entry === entry)?.nameKey, key(parts), entry);
        assert.equal(runtime.call(entry, 10), BigInt(10 + increment));
      }
    } finally { runtime.dispose(); }
    const renamed = structuredClone(info.manifest);
    renamed.exports.find(value => value.entry === "café").entry = "a client-selected alias";
    renamed.exports.find(value => value.entry === "boxedIdentity").entry = "boxed alias";
    const aliased = await factory.createRuntime({ irPackageSet: [replaceIrPackageManifest(bytes, renamed)] });
    try {
      assert.equal(aliased.call("a client-selected alias", 10), 13n);
      assert.equal(aliased.call("boxed alias", "18446744073709551615"), 18446744073709551615n);
    }
    finally { aliased.dispose(); }
  });
  await test("checksum-consistent structural identity mismatch rejects before finish and permits retry", async () => {
    const renamed = structuredClone(info.manifest);
    renamed.exports[0].nameKey = key(["missing"]);
    const runtime = await factory.createRuntime();
    let finishes = 0;
    const original = runtime.exports;
    runtime.exports = { ...original, vir_finish_ir_package_set() { finishes++; return original.vir_finish_ir_package_set(); } };
    try {
      assert.throws(() => runtime.loadIrPackageSetBytes([replaceIrPackageManifest(bytes, renamed)]), /manifest\/binary contract mismatch:.*entry/);
      assert.equal(finishes, 0);
      assert.equal(runtime.packageDeclCount(), 0);
      runtime.loadIrPackageSetBytes([bytes]);
      assert.equal(runtime.call("café", 10), 13n);
    } finally { runtime.dispose(); }
  });
  await test("cross-field aliases reject before initialization and same-export aliases agree", async () => {
    const aliases = structuredClone(info.manifest);
    Object.assign(aliases.exports.find(entry => entry.entry === "café"), {
      entry: "sharedName", id: "sharedName", jsName: "sharedName",
    });
    Object.assign(aliases.exports.find(entry => entry.entry === "αβ₁"), {
      entry: "otherName_", id: "otherName_", jsName: "otherName_",
    });
    const validPackage = replaceIrPackageManifest(bytes, aliases);
    aliases.exports.find(entry => entry.entry === "otherName_").jsName = "sharedName";
    // Bypass writer validation so the runtime receives checksum-valid bytes.
    const ambiguousPackage = rewriteSameLengthManifest(validPackage, aliases);
    const runtime = await factory.createRuntime();
    const original = runtime.exports;
    let begins = 0;
    let finishes = 0;
    runtime.exports = { ...original,
      vir_begin_ir_package_set() { begins++; return original.vir_begin_ir_package_set(); },
      vir_finish_ir_package_set() { finishes++; return original.vir_finish_ir_package_set(); },
    };
    try {
      assert.throws(() => runtime.loadIrPackageSetBytes([ambiguousPackage]), /duplicates another interface export alias "sharedName"/);
      assert.equal(begins, 0);
      assert.equal(finishes, 0);
      assert.equal(runtime.packageDeclCount(), 0);
      assert.equal(runtime.interfaceManifest, null);
      assert.equal(runtime.failure, null);
      runtime.loadIrPackageSetBytes([validPackage]);
      assert.equal(begins, 1);
      assert.equal(finishes, 1);
      assert.equal(runtime.call("sharedName", 10), 13n);
      assert.equal(runtime.exportsByName.sharedName(10), 13n);
      assert.equal(runtime.call("otherName_", 10), 14n);
      assert.equal(runtime.exportsByName.otherName_(10), 14n);
    } finally { runtime.dispose(); }
  });
  await test("old manifests reject before initialization and permit a current-package retry", async () => {
    const canonical = replaceIrPackageManifest(bytes, info.manifest);
    for (const version of [6, 7, 8, 9]) {
      const legacy = structuredClone(info.manifest);
      legacy.version = legacy.metadata.manifestVersion = version;
      // Bypass the writer's current-schema validation. Changing only the two
      // versions plus JSON whitespace preserves offsets and isolates admission.
      const oldPackage = rewriteSameLengthManifest(canonical, legacy);
      const runtime = await factory.createRuntime();
      let finishes = 0;
      const original = runtime.exports;
      runtime.exports = { ...original, vir_finish_ir_package_set() {
        finishes++;
        return original.vir_finish_ir_package_set();
      } };
      try {
        assert.throws(
          () => runtime.loadIrPackageSetBytes([oldPackage]),
          /version: 10.*regenerate packages with the matching SDK/,
        );
        assert.equal(finishes, 0);
        assert.equal(runtime.packageDeclCount(), 0);
        assert.equal(runtime.interfaceManifest, null);
        assert.equal(runtime.failure, null);
        runtime.loadIrPackageSetBytes([bytes]);
        assert.equal(finishes, 1);
        assert.equal(runtime.call("café", 10), 13n);
      } finally { runtime.dispose(); }
    }
  });
  await test("package numeral components above the binary u32 domain reject explicitly", () => {
    const result = project.runVirIrpkg([join(directory, "large.irpkg"), join(directory, "large.report.md"), "--target-marked-module", "TooLargeName"]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /package format stores this field as u32, but got 4294967296/);
  });
} finally { await rm(directory, { recursive: true, force: true }); }

function rewriteSameLengthManifest(bytes, manifest) {
  const section = readIrPackageInfo(bytes).package.sections.find(
    value => value.kind === IR_PACKAGE_SECTION.INTERFACE_MANIFEST,
  );
  assert.ok(section, "fixture must contain an interface manifest");
  const text = JSON.stringify(manifest);
  const missingBytes = section.byteLength - 12 - Buffer.byteLength(text);
  assert.ok(missingBytes >= 0, "version fixture must fit the existing section");
  const manifestBytes = new TextEncoder().encode(text + " ".repeat(missingBytes));
  assert.equal(manifestBytes.byteLength, section.byteLength - 12);
  const output = Uint8Array.from(bytes);
  output.set(manifestBytes, section.offset + 12);
  new DataView(output.buffer).setBigUint64(section.offset, irPackageManifestChecksum(manifestBytes), true);
  return output;
}
