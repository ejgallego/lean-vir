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
  assert.equal(info.manifest.version, 9);
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
        assert.equal(runtime.call(entry, 10), String(10 + increment));
      }
    } finally { runtime.dispose(); }
    const renamed = structuredClone(info.manifest);
    renamed.exports.find(value => value.entry === "café").entry = "a client-selected alias";
    renamed.exports.find(value => value.entry === "boxedIdentity").entry = "boxed alias";
    const aliased = await factory.createRuntime({ irPackageSet: [replaceIrPackageManifest(bytes, renamed)] });
    try {
      assert.equal(aliased.call("a client-selected alias", 10), "13");
      assert.equal(aliased.call("boxed alias", "18446744073709551615"), "18446744073709551615");
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
      assert.equal(runtime.call("café", 10), "13");
    } finally { runtime.dispose(); }
  });
  await test("legacy manifest 6–8 name contracts remain readable", async () => {
    for (const version of [6, 7, 8]) {
      const legacy = structuredClone(info.manifest);
      legacy.version = legacy.metadata.manifestVersion = version;
      for (const entry of legacy.exports) {
        delete entry.nameKey;
        if (version === 6) delete entry.startup;
      }
      const runtime = await factory.createRuntime({ irPackageSet: [replaceIrPackageManifest(bytes, legacy)] });
      try { for (const [entry, , increment] of cases) assert.equal(runtime.call(entry, 10), String(10 + increment)); }
      finally { runtime.dispose(); }
    }
  });
  await test("package numeral components above the binary u32 domain reject explicitly", () => {
    const result = project.runVirIrpkg([join(directory, "large.irpkg"), join(directory, "large.report.md"), "--target-marked-module", "TooLargeName"]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /package format stores this field as u32, but got 4294967296/);
  });
} finally { await rm(directory, { recursive: true, force: true }); }
