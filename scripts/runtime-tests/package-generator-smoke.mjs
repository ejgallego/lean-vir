/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  assert,
  join,
  manifestEntry,
  readFile,
  runVirIrpkg,
  spawnSync,
  writeFile,
  writeRuntimeFixture,
} from "./shared.mjs";

const freshDir = await mkdtemp(join(tmpdir(), "lean-vir-generator-"));
try {
  const runtimeSource = join(freshDir, "RuntimeEffect.lean");
  const runtimePackage = join(freshDir, "runtime-effect.irpkg");
  const runtimeReport = join(freshDir, "runtime-effect.report.md");
  await writeRuntimeFixture(runtimeSource, "RuntimeEffect.lean");

  const generated = runVirIrpkg([runtimePackage, runtimeReport, "--target-all", runtimeSource]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);

  const inspected = spawnSync("node", ["scripts/inspect-irpkg.mjs", "--json", runtimePackage], {
    encoding: "utf8",
  });
  assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
  const manifest = JSON.parse(inspected.stdout).manifest;
  assert.deepEqual(manifest.diagnostics, []);

  const runtimeExport = manifestEntry(manifest, "runtimeValue");
  assert.equal(runtimeExport.effect, "runtime");
  assert.equal(runtimeExport.result.type, "Nat");

  const runtimeImport = manifest.hostImports.find((entry) => entry.target === "test.runtime.value");
  assert.ok(runtimeImport, "runtime host import missing");
  assert.equal(runtimeImport.effect, "runtime");
  assert.equal(runtimeImport.arity, 1);
  assert.equal(runtimeImport.erasedPrefixArgs, 0);
  assert.equal(runtimeImport.result.type, "Js");

  const report = await readFile(runtimeReport, "utf8");
  assert.match(report, /runtimeValue/);
  assert.match(report, /test\.runtime\.value/);

  const hostSlotSource = join(freshDir, "HostImportSlots.lean");
  const hostSlotPackage = join(freshDir, "host-import-slots.irpkg");
  const hostSlotReport = join(freshDir, "host-import-slots.report.md");
  const hostSlotNames = Array.from({ length: 128 }, (_, slot) => `hostSlot${slot}`);
  const hostSlotLines = hostSlotNames.flatMap((name, slot) => [
    `@[vir_js "test.slot.${slot}"]`,
    `private opaque ${name} : Lean.Vir.RuntimeM (Lean.Vir.Js Unit)`,
    "",
  ]);
  await writeFile(hostSlotSource, [
    "import Vir.Js",
    "set_option maxRecDepth 1024",
    "",
    ...hostSlotLines,
    "def hostSlotTotal : Lean.Vir.RuntimeM (Lean.Vir.Js Unit) := do",
    ...hostSlotNames.slice(0, -1).map((name) => `  let _ ← ${name}`),
    `  ${hostSlotNames.at(-1)}`,
    "",
  ].join("\n"));

  const generatedHostSlots = runVirIrpkg([hostSlotPackage, hostSlotReport, "--target-all", hostSlotSource]);
  assert.equal(generatedHostSlots.status, 0, generatedHostSlots.stderr || generatedHostSlots.stdout);

  const inspectedHostSlots = spawnSync("node", ["scripts/inspect-irpkg.mjs", "--json", hostSlotPackage], {
    encoding: "utf8",
  });
  assert.equal(inspectedHostSlots.status, 0, inspectedHostSlots.stderr || inspectedHostSlots.stdout);
  const hostSlotManifest = JSON.parse(inspectedHostSlots.stdout).manifest;
  assert.deepEqual(hostSlotManifest.diagnostics, []);
  assert.equal(hostSlotManifest.hostImports.length, 128);
  assert.deepEqual(
    hostSlotManifest.hostImports.map((entry) => entry.slot).sort((a, b) => a - b),
    Array.from({ length: 128 }, (_, slot) => slot),
  );
  const lastHostSlot = hostSlotManifest.hostImports.find((entry) => entry.slot === 127);
  assert.equal(lastHostSlot?.symbol, "vir_js_import_127_1");
  assert.equal(lastHostSlot?.arity, 1);
} finally {
  await rm(freshDir, { recursive: true, force: true });
}

console.log("vir package generator smoke ok");
