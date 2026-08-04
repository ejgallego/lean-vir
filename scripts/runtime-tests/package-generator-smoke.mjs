/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  assert,
  ensureVirIrpkgBuilt,
  join,
  manifestEntry,
  readFile,
  runVirIrpkg,
  spawnSync,
  virIrpkgEnv,
  writeFile,
  writeRuntimeFixture,
} from "./shared.mjs";

const freshDir = await mkdtemp(join(tmpdir(), "lean-vir-generator-"));
try {
  ensureVirIrpkgBuilt();

  const jsonProbeSource = join(freshDir, "JsonControls.lean");
  await writeFile(jsonProbeSource, [
    "import Vir.GeneratePackage.Json",
    "",
    "open Vir.GeneratePackage",
    "",
    "def allJsonControlChars : String :=",
    "  String.ofList ((List.range 32).map Char.ofNat)",
    "",
    "#eval IO.println (jsonString allJsonControlChars)",
    "",
  ].join("\n"));

  const encodedControls = spawnSync("lake", ["env", "lean", jsonProbeSource], {
    encoding: "utf8",
  });
  assert.equal(encodedControls.status, 0, encodedControls.stderr || encodedControls.stdout);
  const controlChars = Array.from({ length: 32 }, (_, codePoint) =>
    String.fromCodePoint(codePoint)).join("");
  assert.equal(JSON.parse(encodedControls.stdout), controlChars);

  const evalSource = join(freshDir, "EvalSourceHandling.lean");
  const evalPackage = join(freshDir, "eval-source-handling.irpkg");
  const evalReport = join(freshDir, "eval-source-handling.report.md");
  const evalSentinel = "VIR_GENERATOR_EVAL";
  await writeRuntimeFixture(evalSource, "EvalSourceHandling.lean");

  const generatedEvalSource = runVirIrpkg([
    evalPackage,
    evalReport,
    "--target-all",
    evalSource,
  ]);
  assert.equal(
    generatedEvalSource.status,
    0,
    generatedEvalSource.stderr || generatedEvalSource.stdout,
  );
  for (const suffix of ["SINGLE", "BANG", "MULTILINE", "NESTED"]) {
    assert.match(generatedEvalSource.stdout, new RegExp(`${evalSentinel}_${suffix}`));
  }
  assert.doesNotMatch(generatedEvalSource.stdout, new RegExp(`${evalSentinel}_(COMMENT|STRING)`));

  const inspectedEvalSource = spawnSync(
    "node",
    ["scripts/inspect-irpkg.mjs", "--json", evalPackage],
    { encoding: "utf8" },
  );
  assert.equal(
    inspectedEvalSource.status,
    0,
    inspectedEvalSource.stderr || inspectedEvalSource.stdout,
  );
  const evalSourceManifest = JSON.parse(inspectedEvalSource.stdout).manifest;
  manifestEntry(evalSourceManifest, "evalSourceValue");

  const markedSource = join(freshDir, "MarkedExports.lean");
  const markedPackage = join(freshDir, "marked-exports.irpkg");
  const markedReport = join(freshDir, "marked-exports.report.md");
  await writeFile(markedSource, [
    "import Vir",
    "",
    "example : Lean.LabelExtension := vir_export",
    "",
    "@[vir_export]",
    "def markedValue (n : Nat) : Nat := n + 1",
    "",
    "@[vir_export]",
    "opaque markedOpaque : Nat := 40",
    "",
    "def markedLater : Nat := 41",
    "attribute [vir_export] markedLater",
    "",
    "def removedMark : Nat := 42",
    "attribute [vir_export] removedMark",
    "attribute [-vir_export] removedMark",
    "",
    "@[vir_startup]",
    "def markedStartup : Lean.Vir.Browser.DomM Unit := pure ()",
    "",
    "def notMarked : Nat := 37",
    "",
  ].join("\n"));
  const generatedMarked = runVirIrpkg([
    markedPackage,
    markedReport,
    "--target-marked",
    markedSource,
  ]);
  assert.equal(generatedMarked.status, 0, generatedMarked.stderr || generatedMarked.stdout);
  const inspectedMarked = spawnSync(
    "node",
    ["scripts/inspect-irpkg.mjs", "--json", markedPackage],
    { encoding: "utf8" },
  );
  assert.equal(inspectedMarked.status, 0, inspectedMarked.stderr || inspectedMarked.stdout);
  const markedManifest = JSON.parse(inspectedMarked.stdout).manifest;
  assert.deepEqual(
    markedManifest.exports.map((entry) => entry.entry).sort(),
    ["markedLater", "markedOpaque", "markedStartup", "markedValue"],
  );
  assert.equal(markedManifest.exports.some((entry) => entry.entry === "removedMark"), false);
  assert.equal(manifestEntry(markedManifest, "markedValue").startup, false);
  assert.equal(manifestEntry(markedManifest, "markedOpaque").startup, false);
  assert.equal(manifestEntry(markedManifest, "markedLater").startup, false);
  assert.equal(manifestEntry(markedManifest, "markedStartup").startup, true);

  const markedUnsupportedSignatureSource = join(freshDir, "MarkedUnsupportedSignature.lean");
  await writeFile(markedUnsupportedSignatureSource, [
    "import Vir",
    "",
    "namespace MarkedUnsupportedSignature",
    "",
    "@[vir_export]",
    "def implicitBump {offset : Nat} (n : Nat) : Nat := n + offset",
    "",
    "@[vir_export]",
    "def polymorphicIdentity {α : Type} (value : α) : α := value",
    "",
    "@[vir_export]",
    "theorem proofIsNotExecutable : True := trivial",
    "",
    "@[vir_export]",
    "axiom axiomIsNotExecutable : Nat",
    "",
    "@[vir_export]",
    "private def hidden : Nat := 42",
    "",
    "end MarkedUnsupportedSignature",
    "",
  ].join("\n"));
  const checkedMarkedUnsupportedSignature = spawnSync(
    "lean",
    [markedUnsupportedSignatureSource],
    { encoding: "utf8", env: virIrpkgEnv() },
  );
  assert.notEqual(
    checkedMarkedUnsupportedSignature.status,
    0,
    "unsupported marked export signatures unexpectedly elaborated successfully",
  );
  const markedUnsupportedSignatureOutput =
    `${checkedMarkedUnsupportedSignature.stderr}${checkedMarkedUnsupportedSignature.stdout}`;
  assert.match(
    markedUnsupportedSignatureOutput,
    /invalid `@\[vir_export\]` declaration `MarkedUnsupportedSignature\.implicitBump`: unsupported implicit\/instance argument `offset`/,
  );
  assert.match(
    markedUnsupportedSignatureOutput,
    /invalid `@\[vir_export\]` declaration `MarkedUnsupportedSignature\.polymorphicIdentity`: polymorphic exported entrypoints with erased type parameters are not supported; export a concrete wrapper/,
  );
  assert.match(
    markedUnsupportedSignatureOutput,
    /invalid `@\[vir_export\]` declaration `MarkedUnsupportedSignature\.proofIsNotExecutable`: theorems do not have executable IR/,
  );
  assert.match(
    markedUnsupportedSignatureOutput,
    /invalid `@\[vir_export\]` declaration `MarkedUnsupportedSignature\.axiomIsNotExecutable`: axioms do not have executable IR/,
  );
  assert.match(markedUnsupportedSignatureOutput, /private declarations are not exported/);

  const markedUnsupportedDependencySource = join(freshDir, "MarkedUnsupportedDependency.lean");
  await writeFile(markedUnsupportedDependencySource, [
    "import Vir",
    "",
    "namespace MarkedUnsupportedDependency",
    "",
    "def environmentHome : IO String := do",
    "  return (← IO.getEnv \"HOME\").getD \"\"",
    "",
    "@[vir_export]",
    "def home : IO String := environmentHome",
    "",
    "end MarkedUnsupportedDependency",
    "",
  ].join("\n"));
  const checkedMarkedUnsupportedDependency = spawnSync(
    "lean",
    [markedUnsupportedDependencySource],
    { encoding: "utf8", env: virIrpkgEnv() },
  );
  assert.notEqual(
    checkedMarkedUnsupportedDependency.status,
    0,
    "unsupported marked export dependency unexpectedly elaborated successfully",
  );
  const markedUnsupportedDependencyOutput =
    `${checkedMarkedUnsupportedDependency.stderr}${checkedMarkedUnsupportedDependency.stdout}`;
  assert.match(
    markedUnsupportedDependencyOutput,
    /invalid `@\[vir_export\]` declaration `MarkedUnsupportedDependency\.home`: compiled closure reaches missing native extern registration `IO\.getEnv` \(via MarkedUnsupportedDependency\.home[^\n]* -> MarkedUnsupportedDependency\.environmentHome[^\n]* -> IO\.getEnv\)/,
  );

  const markedPostponedSource = join(freshDir, "MarkedPostponed.lean");
  await writeFile(markedPostponedSource, [
    "module",
    "",
    "public meta import Vir.Attributes",
    "",
    "set_option compiler.postponeCompile true",
    "",
    "@[vir_export]",
    "public def MarkedPostponed.value : Nat := 42",
    "",
  ].join("\n"));
  const checkedMarkedPostponed = spawnSync(
    "lean",
    [markedPostponedSource],
    { encoding: "utf8", env: virIrpkgEnv() },
  );
  assert.equal(
    checkedMarkedPostponed.status,
    0,
    checkedMarkedPostponed.stderr || checkedMarkedPostponed.stdout,
  );
  assert.match(
    `${checkedMarkedPostponed.stderr}${checkedMarkedPostponed.stdout}`,
    /compiled closure validation is unavailable because IR compilation is postponed for `MarkedPostponed\.value`; package generation requires compiled IR for this declaration/,
  );

  const startupDependencySource = join(freshDir, "StartupDependency.lean");
  const startupDependencyPackage = join(freshDir, "startup-dependency.irpkg");
  const startupDependencyReport = join(freshDir, "startup-dependency.report.md");
  await writeFile(startupDependencySource, [
    "import Vir",
    "",
    "namespace StartupDependency",
    "",
    "@[vir_startup]",
    "def home : IO Unit := do",
    "  let _ ← IO.getEnv \"HOME\"",
    "  pure ()",
    "",
    "end StartupDependency",
    "",
  ].join("\n"));
  const generatedStartupDependency = runVirIrpkg([
    startupDependencyPackage,
    startupDependencyReport,
    "--target-marked",
    startupDependencySource,
  ]);
  assert.notEqual(
    generatedStartupDependency.status,
    0,
    "unsupported startup dependency unexpectedly generated successfully",
  );
  assert.match(generatedStartupDependency.stderr, /missing native extern registrations:/);
  assert.match(
    generatedStartupDependency.stderr,
    /IO\.getEnv \(via StartupDependency\.home[^\n]* -> IO\.getEnv\)/,
  );
  const startupDependencyReportText = await readFile(startupDependencyReport, "utf8");
  assert.match(
    startupDependencyReportText,
    /## Missing Native Extern Registrations[\s\S]*- `IO\.getEnv` \(via StartupDependency\.home[^\n]* -> IO\.getEnv\)/,
  );
  assert.doesNotMatch(startupDependencyReportText, /## Blocking Dependency Paths/);
  assert.match(
    startupDependencyReportText,
    /## Interface Exports[\s\S]*- `StartupDependency\.home` as `StartupDependency_home` \[startup\] : \(\) -> IO Unit/,
  );
  assert.match(
    startupDependencyReportText,
    /## Package Diagnostics\n\nNone\./,
  );
  await assert.rejects(readFile(startupDependencyPackage), { code: "ENOENT" });

  const slidesPackage = join(freshDir, "slides-canvas.irpkg");
  const generatedSlides = runVirIrpkg([
    slidesPackage,
    join(freshDir, "slides-canvas.report.md"),
    "--target-marked",
    "examples/SlidesCanvas.lean",
  ]);
  assert.equal(generatedSlides.status, 0, generatedSlides.stderr || generatedSlides.stdout);
  const inspectedSlides = spawnSync(
    "node",
    ["scripts/inspect-irpkg.mjs", "--json", slidesPackage],
    { encoding: "utf8" },
  );
  assert.equal(inspectedSlides.status, 0, inspectedSlides.stderr || inspectedSlides.stdout);
  const slidesManifest = JSON.parse(inspectedSlides.stdout).manifest;
  assert.equal(manifestEntry(slidesManifest, "SlidesCanvas.mount").startup, true);
  for (const target of [
    "browser.document.createElement",
    "browser.canvas2d.fillRect",
    "browser.animation.requestAnimationFrame",
  ]) {
    assert.ok(
      slidesManifest.hostImports.some((entry) => entry.target === target),
      `Slides canvas host import missing: ${target}`,
    );
  }

  const noMarkedSource = join(freshDir, "NoMarkedExports.lean");
  await writeFile(noMarkedSource, "def ordinaryValue : Nat := 1\n");
  const generatedWithoutMarks = runVirIrpkg([
    join(freshDir, "no-marked-exports.irpkg"),
    join(freshDir, "no-marked-exports.report.md"),
    "--target-marked",
    noMarkedSource,
  ]);
  assert.notEqual(generatedWithoutMarks.status, 0);
  assert.match(generatedWithoutMarks.stderr, /no declarations are marked with `@\[vir_export\]` or `@\[vir_startup\]`/);

  const badStartupSource = join(freshDir, "BadStartup.lean");
  await writeFile(badStartupSource, [
    "import Vir",
    "",
    "@[vir_startup]",
    "def badStartup (_n : Nat) : Lean.Vir.Browser.DomM Unit := pure ()",
    "",
  ].join("\n"));
  const generatedBadStartup = runVirIrpkg([
    join(freshDir, "bad-startup.irpkg"),
    join(freshDir, "bad-startup.report.md"),
    "--target-marked",
    badStartupSource,
  ]);
  assert.notEqual(generatedBadStartup.status, 0);
  assert.match(generatedBadStartup.stderr, /marked with `@\[vir_startup\]` must take no JavaScript arguments/);

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
  assert.equal(runtimeImport.boundary, "hostResource");
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
  assert.equal(lastHostSlot?.boundary, "hostResource");
  assert.equal(lastHostSlot?.arity, 1);
} finally {
  await rm(freshDir, { recursive: true, force: true });
}

console.log("vir package generator smoke ok");
