/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  assert,
  createRuntimeModuleProject,
  join,
  manifestEntry,
  readFile,
  spawnSync,
} from "./shared.mjs";

function combinedOutput(result) {
  return `${result.stderr}${result.stdout}`;
}

function assertCompiled(result) {
  assert.equal(
    result.status,
    0,
    `module compilation failed: ${result.error ?? ""}\n${combinedOutput(result)}`,
  );
  return result;
}

function readFixture(name) {
  return readFile(
    new URL(`../../fixtures/runtime/${name}.lean`, import.meta.url),
    "utf8",
  );
}

const freshDir = await mkdtemp(join(tmpdir(), "lean-vir-generator-"));

async function assertExternFallbackRejected(module, lines, message, pattern) {
  const project = await createRuntimeModuleProject(join(freshDir, module), {
    [module]: lines.join("\n"),
  });
  const checked = project.build();
  assert.notEqual(checked.status, 0, message);
  assert.match(combinedOutput(checked), pattern);
}

try {
  const jsonOutput = join(freshDir, "json-controls.json");
  const jsonProject = await createRuntimeModuleProject(join(freshDir, "json"), {
    JsonControls: [
      "module",
      "public meta import Vir.GeneratePackage.Json",
      "public meta import Lean.CoreM",
      "",
      "open Vir.GeneratePackage",
      "",
      "def allJsonControlChars : String :=",
      "  String.ofList ((List.range 32).map Char.ofNat)",
      "",
      `#eval IO.FS.writeFile ${JSON.stringify(jsonOutput)} (jsonString allJsonControlChars)`,
      "",
    ].join("\n"),
  });
  assertCompiled(jsonProject.build());
  const controlChars = Array.from({ length: 32 }, (_, codePoint) =>
    String.fromCodePoint(codePoint),
  ).join("");
  assert.equal(JSON.parse(await readFile(jsonOutput, "utf8")), controlChars);

  const evalPackage = join(freshDir, "eval-source-handling.irpkg");
  const evalReport = join(freshDir, "eval-source-handling.report.md");
  const evalSentinel = "VIR_GENERATOR_EVAL";
  const evalProject = await createRuntimeModuleProject(join(freshDir, "eval"), {
    EvalSourceHandling: await readFixture("EvalSourceHandling"),
  });
  const compiledEval = assertCompiled(evalProject.build());

  const generatedEvalSource = evalProject.runVirIrpkg([
    evalPackage,
    evalReport,
    "--target-all-module",
    "EvalSourceHandling",
  ]);
  assert.equal(
    generatedEvalSource.status,
    0,
    generatedEvalSource.stderr || generatedEvalSource.stdout,
  );
  for (const suffix of ["SINGLE", "BANG", "MULTILINE", "NESTED"]) {
    assert.match(
      combinedOutput(compiledEval),
      new RegExp(`${evalSentinel}_${suffix}`),
    );
  }
  assert.doesNotMatch(
    combinedOutput(compiledEval),
    new RegExp(`${evalSentinel}_(COMMENT|STRING)`),
  );
  assert.doesNotMatch(
    combinedOutput(generatedEvalSource),
    new RegExp(evalSentinel),
  );

  const inspectedEvalSource = spawnSync(
    "node",
    ["scripts/packages/inspect-irpkg.mjs", "--json", evalPackage],
    { encoding: "utf8" },
  );
  assert.equal(
    inspectedEvalSource.status,
    0,
    inspectedEvalSource.stderr || inspectedEvalSource.stdout,
  );
  const evalSourceManifest = JSON.parse(inspectedEvalSource.stdout).manifest;
  manifestEntry(evalSourceManifest, "evalSourceValue");

  const markedPackage = join(freshDir, "marked-exports.irpkg");
  const markedReport = join(freshDir, "marked-exports.report.md");
  const sourceElaborationSentinel = "VIR_MODULE_COMPILED_ONCE";
  const markedProject = await createRuntimeModuleProject(
    join(freshDir, "marked"),
    {
      MarkedExports: [
        "module",
        "public import Vir",
        "public meta import Lean.CoreM",
        "public section",
        "",
        `#eval IO.println "${sourceElaborationSentinel}"`,
        "",
        "example : Lean.LabelExtension := vir_export",
        "example : Lean.LabelExtension := vir_startup",
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
        "run_meta do",
        "  if (vir_export.getState (← Lean.getEnv)).contains `removedMark then",
        '    throwError "local export label removal did not take effect"',
        "",
        "@[vir_startup]",
        "def markedStartup : Lean.Vir.Browser.DomM Unit := pure ()",
        "",
        "abbrev StartupResult := Unit",
        "abbrev StartupAction := IO StartupResult",
        "",
        "@[vir_startup]",
        "def markedAliasStartup : StartupAction := pure ()",
        "",
        "@[vir_startup]",
        "def markedRuntimeStartup : Lean.Vir.RuntimeM Unit := pure ()",
        "",
        "@[vir_startup]",
        "def markedReactStartup : Lean.Vir.React.ReactM Unit := pure ()",
        "",
        "def markedLaterStartup : Unit := ()",
        "attribute [vir_startup] markedLaterStartup",
        "",
        "def removedStartup : Unit := ()",
        "attribute [vir_startup] removedStartup",
        "attribute [-vir_startup] removedStartup",
        "run_meta do",
        "  if (vir_startup.getState (← Lean.getEnv)).contains `removedStartup then",
        '    throwError "local startup label removal did not take effect"',
        "",
        "def notMarked : Nat := 37",
        "",
      ].join("\n"),
    },
  );
  const compiledMarked = assertCompiled(markedProject.build());
  assert.equal(
    combinedOutput(compiledMarked).match(
      new RegExp(sourceElaborationSentinel, "g"),
    )?.length,
    1,
  );
  const generatedMarked = markedProject.runVirIrpkg([
    markedPackage,
    markedReport,
    "--target-marked-module",
    "MarkedExports",
  ]);
  assert.equal(
    generatedMarked.status,
    0,
    generatedMarked.stderr || generatedMarked.stdout,
  );
  const inspectedMarked = spawnSync(
    "node",
    ["scripts/packages/inspect-irpkg.mjs", "--json", markedPackage],
    { encoding: "utf8" },
  );
  assert.equal(
    inspectedMarked.status,
    0,
    inspectedMarked.stderr || inspectedMarked.stdout,
  );
  const markedManifest = JSON.parse(inspectedMarked.stdout).manifest;
  assert.equal(markedManifest.metadata.targets[0].mode, "markedModule");
  assert.equal(markedManifest.metadata.targets[0].module, "MarkedExports");
  assert.doesNotMatch(
    combinedOutput(generatedMarked),
    new RegExp(sourceElaborationSentinel),
  );
  assert.deepEqual(markedManifest.exports.map((entry) => entry.entry).sort(), [
    "markedAliasStartup",
    "markedLater",
    "markedLaterStartup",
    "markedOpaque",
    "markedReactStartup",
    "markedRuntimeStartup",
    "markedStartup",
    "markedValue",
    "removedMark",
    "removedStartup",
  ]);
  // Lean label erasure changes local state, not the additions saved in the
  // compiled module. The run_meta checks above cover the local side.
  assert.equal(manifestEntry(markedManifest, "removedMark").startup, false);
  assert.equal(
    markedManifest.exports.some((entry) => entry.entry === "notMarked"),
    false,
  );
  assert.equal(manifestEntry(markedManifest, "markedValue").startup, false);
  assert.equal(manifestEntry(markedManifest, "markedOpaque").startup, false);
  assert.equal(manifestEntry(markedManifest, "markedLater").startup, false);
  for (const [entryName, effect] of [
    ["markedAliasStartup", "io"],
    ["markedLaterStartup", "pure"],
    ["markedReactStartup", "react"],
    ["markedRuntimeStartup", "runtime"],
    ["markedStartup", "dom"],
    ["removedStartup", "pure"],
  ]) {
    const entry = manifestEntry(markedManifest, entryName);
    assert.equal(entry.startup, true);
    assert.equal(entry.effect, effect);
  }

  const selectionModesPackage = join(freshDir, "selection-modes.irpkg");
  const selectionModesReport = join(freshDir, "selection-modes.report.md");
  const generatedSelectionModes = markedProject.runVirIrpkg([
    selectionModesPackage,
    selectionModesReport,
    "--target-module",
    "MarkedExports",
    "markedValue",
    "--package-module",
    "MarkedExports",
    "notMarked",
  ]);
  assert.equal(
    generatedSelectionModes.status,
    0,
    generatedSelectionModes.stderr || generatedSelectionModes.stdout,
  );
  assert.doesNotMatch(
    combinedOutput(generatedSelectionModes),
    new RegExp(sourceElaborationSentinel),
    "reusing a module across selection modes must not elaborate it again",
  );
  const inspectedSelectionModes = spawnSync(
    "node",
    ["scripts/packages/inspect-irpkg.mjs", "--json", selectionModesPackage],
    { encoding: "utf8" },
  );
  assert.equal(
    inspectedSelectionModes.status,
    0,
    inspectedSelectionModes.stderr || inspectedSelectionModes.stdout,
  );
  const selectionModesManifest = JSON.parse(
    inspectedSelectionModes.stdout,
  ).manifest;
  assert.deepEqual(
    selectionModesManifest.metadata.targets.map(({ mode, roots }) => ({
      mode,
      roots,
    })),
    [
      { mode: "explicit", roots: ["markedValue"] },
      { mode: "packageOnly", roots: ["notMarked"] },
    ],
  );
  assert.deepEqual(
    selectionModesManifest.exports.map((entry) => entry.entry),
    ["markedValue"],
  );

  const malformedRoot = markedProject.runVirIrpkg([
    join(freshDir, "malformed-root.irpkg"),
    join(freshDir, "malformed-root.report.md"),
    "--target-module",
    "MarkedExports",
    "markedValue.",
  ]);
  assert.equal(malformedRoot.status, 2);
  assert.match(malformedRoot.stderr, /is not a valid Lean name/);

  const unknownTargetOption = markedProject.runVirIrpkg([
    join(freshDir, "unknown-target-option.irpkg"),
    join(freshDir, "unknown-target-option.report.md"),
    "--target-module",
    "MarkedExports",
    "markedValue",
    "--typo",
  ]);
  assert.equal(unknownTargetOption.status, 2);
  assert.match(unknownTargetOption.stderr, /got `--typo`/);

  const externFallbackPackage = join(freshDir, "extern-fallback.irpkg");
  const externFallbackReport = join(freshDir, "extern-fallback.report.md");
  const externProject = await createRuntimeModuleProject(
    join(freshDir, "extern"),
    {
      ExternFallback: await readFixture("ExternFallback"),
    },
  );
  assertCompiled(externProject.build());
  const generatedExternFallback = externProject.runVirIrpkg([
    externFallbackPackage,
    externFallbackReport,
    "--target-marked-module",
    "ExternFallback",
  ]);
  assert.equal(
    generatedExternFallback.status,
    0,
    generatedExternFallback.stderr || generatedExternFallback.stdout,
  );
  const inspectedExternFallback = spawnSync(
    "node",
    ["scripts/packages/inspect-irpkg.mjs", "--json", externFallbackPackage],
    { encoding: "utf8" },
  );
  assert.equal(
    inspectedExternFallback.status,
    0,
    inspectedExternFallback.stderr || inspectedExternFallback.stdout,
  );
  const externFallbackManifest = JSON.parse(
    inspectedExternFallback.stdout,
  ).manifest;
  for (const entry of [
    "callExternIncrement",
    "callExternBorrowedIdentity",
    "callExternOwnedSize",
  ]) {
    manifestEntry(externFallbackManifest, entry);
  }

  await assertExternFallbackRejected(
    "BodylessExternFallback",
    [
      "module",
      "public import Vir",
      "public section",
      "",
      '@[extern "vir_test_bodyless"]',
      "opaque bodylessExtern (n : Nat) : Nat",
      "",
      "vir_extern_fallback bodylessExtern",
      "",
    ],
    "a bodyless extern unexpectedly accepted a VIR reference-body fallback",
    /extern `bodylessExtern` has no transparent Lean definition body/,
  );
  await assertExternFallbackRejected(
    "OrdinaryExternFallback",
    [
      "module",
      "public import Vir",
      "public section",
      "",
      "def ordinaryDefinition (n : Nat) : Nat := n + 1",
      "",
      "vir_extern_fallback ordinaryDefinition",
      "",
    ],
    "a non-extern definition unexpectedly accepted a VIR reference-body fallback",
    /`ordinaryDefinition` is not an `@\[extern\]` declaration/,
  );
  await assertExternFallbackRejected(
    "DuplicateExternFallback",
    [
      "module",
      "public import Vir",
      "public section",
      "",
      '@[extern "vir_test_duplicate"]',
      "def duplicateExtern (n : Nat) : Nat := n + 1",
      "",
      "vir_extern_fallback duplicateExtern",
      "vir_extern_fallback duplicateExtern",
      "",
    ],
    "a duplicate VIR reference-body fallback unexpectedly elaborated",
    /extern `duplicateExtern` already has a VIR reference-body fallback/,
  );
  await assertExternFallbackRejected(
    "RecursiveExternFallback",
    [
      "module",
      "public import Vir",
      "public section",
      "",
      '@[extern "vir_test_recursive"]',
      "unsafe def recursiveExtern (n : Nat) : Nat := recursiveExtern n",
      "",
      "vir_extern_fallback recursiveExtern",
      "",
    ],
    "a directly recursive extern unexpectedly accepted a VIR reference-body fallback",
    /extern `recursiveExtern` has a recursive reference body/,
  );

  const spoofedExternFallbackPackage = join(
    freshDir,
    "spoofed-extern-fallback.irpkg",
  );
  const spoofedExternFallbackReport = join(
    freshDir,
    "spoofed-extern-fallback.report.md",
  );
  const spoofedProject = await createRuntimeModuleProject(
    join(freshDir, "spoofed"),
    {
      SpoofedExternFallback: [
        "module",
        "public import Vir",
        "public section",
        "",
        "namespace _virExternFallback",
        "def spoofedExtern (input : String) : String := input",
        "end _virExternFallback",
        "",
        '@[extern "vir_test_spoofed"]',
        "def spoofedExtern (n : Nat) : Nat := n + 1",
        "",
        "@[vir_export]",
        "def callSpoofedExtern (n : Nat) : Nat := spoofedExtern n",
        "",
      ].join("\n"),
    },
  );
  assertCompiled(spoofedProject.build());
  const generatedSpoofedExternFallback = spoofedProject.runVirIrpkg([
    spoofedExternFallbackPackage,
    spoofedExternFallbackReport,
    "--target-marked-module",
    "SpoofedExternFallback",
  ]);
  assert.equal(
    generatedSpoofedExternFallback.status,
    0,
    generatedSpoofedExternFallback.stderr ||
      generatedSpoofedExternFallback.stdout,
  );
  assert.match(
    await readFile(spoofedExternFallbackReport, "utf8"),
    /- `spoofedExtern` from/,
  );

  const signatureProject = await createRuntimeModuleProject(
    join(freshDir, "signature"),
    {
      MarkedUnsupportedSignature: [
        "module",
        "public import Vir",
        "public section",
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
      ].join("\n"),
    },
  );
  const checkedMarkedUnsupportedSignature = signatureProject.build();
  assert.notEqual(
    checkedMarkedUnsupportedSignature.status,
    0,
    "unsupported marked export signatures unexpectedly elaborated successfully",
  );
  const markedUnsupportedSignatureOutput = combinedOutput(
    checkedMarkedUnsupportedSignature,
  );
  assert.match(
    markedUnsupportedSignatureOutput,
    /invalid `@\[vir_export\]` declaration `MarkedUnsupportedSignature\.implicitBump`: VIR exports cannot have implicit or instance arguments \(`offset`\); export a wrapper with only explicit arguments/,
  );
  assert.match(
    markedUnsupportedSignatureOutput,
    /invalid `@\[vir_export\]` declaration `MarkedUnsupportedSignature\.polymorphicIdentity`: VIR exports must use concrete runtime types; type parameter `α` is erased; export a concrete wrapper instead/,
  );
  assert.match(
    markedUnsupportedSignatureOutput,
    /invalid `@\[vir_export\]` declaration `MarkedUnsupportedSignature\.proofIsNotExecutable`: theorems do not have executable IR; mark a definition instead/,
  );
  assert.match(
    markedUnsupportedSignatureOutput,
    /invalid `@\[vir_export\]` declaration `MarkedUnsupportedSignature\.axiomIsNotExecutable`: axioms do not have executable IR; mark an implemented definition instead/,
  );
  assert.match(
    markedUnsupportedSignatureOutput,
    /private declarations cannot be VIR exports; remove `private` or export a public wrapper/,
  );

  const dependencyProject = await createRuntimeModuleProject(
    join(freshDir, "dependency"),
    {
      MarkedUnsupportedDependency: [
        "module",
        "public import Vir",
        "public section",
        "",
        "namespace MarkedUnsupportedDependency",
        "",
        "def environmentHome : IO String := do",
        '  return (← IO.getEnv "HOME").getD ""',
        "",
        "@[vir_export]",
        "def home : IO String := environmentHome",
        "",
        "end MarkedUnsupportedDependency",
        "",
      ].join("\n"),
    },
  );
  const checkedMarkedUnsupportedDependency = dependencyProject.build();
  assert.notEqual(
    checkedMarkedUnsupportedDependency.status,
    0,
    "unsupported marked export dependency unexpectedly elaborated successfully",
  );
  const markedUnsupportedDependencyOutput = combinedOutput(
    checkedMarkedUnsupportedDependency,
  );
  assert.match(
    markedUnsupportedDependencyOutput,
    /invalid `@\[vir_export\]` declaration `MarkedUnsupportedDependency\.home`: compiled closure reaches unsupported runtime dependency `IO\.getEnv`: no native extern implementation is registered \(via MarkedUnsupportedDependency\.home[^\n]* -> MarkedUnsupportedDependency\.environmentHome[^\n]* -> IO\.getEnv\)/,
  );

  const postponedProject = await createRuntimeModuleProject(
    join(freshDir, "postponed"),
    {
      MarkedPostponed: [
        "module",
        "",
        "public meta import Vir.Attributes",
        "",
        "set_option compiler.postponeCompile true",
        "",
        "@[vir_export]",
        "public def MarkedPostponed.value : Nat := 42",
        "",
      ].join("\n"),
    },
  );
  // This deliberately disables IR production, so only check elaboration. A
  // Lake artifact build would fail looking for the intentionally absent .ir.
  const checkedMarkedPostponed = spawnSync(
    "lean",
    [postponedProject.sourcePath("MarkedPostponed")],
    {
      cwd: postponedProject.directory,
      env: postponedProject.env(),
      encoding: "utf8",
    },
  );
  assert.equal(
    checkedMarkedPostponed.status,
    0,
    combinedOutput(checkedMarkedPostponed),
  );
  assert.match(
    combinedOutput(checkedMarkedPostponed),
    /could not validate `MarkedPostponed\.value` because `compiler\.postponeCompile` is enabled; disable it for modules built with `:vir`/,
  );

  const startupProject = await createRuntimeModuleProject(
    join(freshDir, "startup"),
    {
      StartupDependency: [
        "module",
        "public import Vir",
        "public section",
        "",
        "namespace StartupDependency",
        "",
        "@[vir_startup]",
        "def home : IO Unit := do",
        '  let _ ← IO.getEnv "HOME"',
        "  pure ()",
        "",
        "end StartupDependency",
        "",
      ].join("\n"),
    },
  );
  const checkedStartupDependency = startupProject.build();
  assert.notEqual(
    checkedStartupDependency.status,
    0,
    "unsupported startup dependency unexpectedly elaborated successfully",
  );
  const startupDependencyOutput = combinedOutput(checkedStartupDependency);
  assert.match(
    startupDependencyOutput,
    /invalid `@\[vir_startup\]` declaration `StartupDependency\.home`: compiled closure reaches unsupported runtime dependency `IO\.getEnv`: no native extern implementation is registered \(via StartupDependency\.home[^\n]* -> IO\.getEnv\)/,
  );

  const slidesPackage = join(freshDir, "slides-canvas.irpkg");
  const slidesProject = await createRuntimeModuleProject(
    join(freshDir, "slides"),
    {
      SlidesInput: "module\npublic import SlidesCanvas\n",
    },
  );
  assertCompiled(slidesProject.build());
  const generatedSlides = slidesProject.runVirIrpkg([
    slidesPackage,
    join(freshDir, "slides-canvas.report.md"),
    "--target-marked-module",
    "SlidesCanvas",
  ]);
  assert.equal(
    generatedSlides.status,
    0,
    generatedSlides.stderr || generatedSlides.stdout,
  );
  const inspectedSlides = spawnSync(
    "node",
    ["scripts/packages/inspect-irpkg.mjs", "--json", slidesPackage],
    { encoding: "utf8" },
  );
  assert.equal(
    inspectedSlides.status,
    0,
    inspectedSlides.stderr || inspectedSlides.stdout,
  );
  const slidesManifest = JSON.parse(inspectedSlides.stdout).manifest;
  assert.equal(
    manifestEntry(slidesManifest, "SlidesCanvas.mount").startup,
    true,
  );
  for (const target of [
    "browser.document.current",
    "browser.document.createElement",
    "browser.canvas2d.fillRect",
    "browser.canvas2d.setFillStyleValue",
    "browser.animation.requestAnimationFrame",
    "js.value.browser.canvasStyle.string",
  ]) {
    assert.ok(
      slidesManifest.hostImports.some((entry) => entry.target === target),
      `Slides canvas host import missing: ${target}`,
    );
  }

  const noMarkedProject = await createRuntimeModuleProject(
    join(freshDir, "no-marked"),
    {
      NoMarkedExports: "module\npublic def ordinaryValue : Nat := 1\n",
    },
  );
  assertCompiled(noMarkedProject.build());
  const generatedWithoutMarks = noMarkedProject.runVirIrpkg([
    join(freshDir, "no-marked-exports.irpkg"),
    join(freshDir, "no-marked-exports.report.md"),
    "--target-marked-module",
    "NoMarkedExports",
  ]);
  assert.notEqual(generatedWithoutMarks.status, 0);
  assert.match(
    generatedWithoutMarks.stderr,
    /no declarations are marked with `@\[vir_export\]` or `@\[vir_startup\]`/,
  );

  const badStartupProject = await createRuntimeModuleProject(
    join(freshDir, "bad-startup"),
    {
      BadStartup: [
        "module",
        "public import Vir",
        "public section",
        "",
        "@[vir_startup]",
        "def badStartup (_n : Nat) : Lean.Vir.Browser.DomM Unit := pure ()",
        "",
        "@[vir_startup]",
        "def badStartupResult : IO Nat := pure 1",
        "",
        "@[vir_startup]",
        "def badPureStartupResult : Nat := 1",
        "",
        "@[vir_startup]",
        "def unsupportedStartupEffect : Option Unit := some ()",
        "",
        "@[vir_startup]",
        "theorem startupProof : True := trivial",
        "",
        "@[vir_startup]",
        "private def privateStartup : Unit := ()",
        "",
      ].join("\n"),
    },
  );
  const checkedBadStartup = badStartupProject.build();
  assert.notEqual(checkedBadStartup.status, 0);
  const badStartupOutput = combinedOutput(checkedBadStartup);
  assert.match(
    badStartupOutput,
    /invalid `@\[vir_startup\]` declaration `badStartup`: VIR startup hooks cannot declare parameters \(`_n`\); define a zero-argument wrapper instead/,
  );
  assert.match(
    badStartupOutput,
    /invalid `@\[vir_startup\]` declaration `badStartupResult`: VIR startup hooks using `IO` must return `Unit`; got `Nat`/,
  );
  assert.match(
    badStartupOutput,
    /invalid `@\[vir_startup\]` declaration `badPureStartupResult`: VIR startup hooks must return `Unit`; got `Nat`/,
  );
  assert.match(
    badStartupOutput,
    /invalid `@\[vir_startup\]` declaration `unsupportedStartupEffect`: `Option` is not a supported VIR startup effect; use `RuntimeM`, `IO`, `DomM`, or `ReactM`, each returning `Unit`/,
  );
  assert.match(
    badStartupOutput,
    /invalid `@\[vir_startup\]` declaration `startupProof`: theorems do not have executable IR; mark a definition instead/,
  );
  assert.match(
    badStartupOutput,
    /private declarations cannot be VIR startup hooks; remove `private` or use a public wrapper/,
  );

  const runtimePackage = join(freshDir, "runtime-effect.irpkg");
  const runtimeReport = join(freshDir, "runtime-effect.report.md");
  const runtimeProject = await createRuntimeModuleProject(
    join(freshDir, "runtime"),
    {
      RuntimeEffect: await readFixture("RuntimeEffect"),
    },
  );
  assertCompiled(runtimeProject.build());

  const generated = runtimeProject.runVirIrpkg([
    runtimePackage,
    runtimeReport,
    "--target-all-module",
    "RuntimeEffect",
  ]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);

  const inspected = spawnSync(
    "node",
    ["scripts/packages/inspect-irpkg.mjs", "--json", runtimePackage],
    {
      encoding: "utf8",
    },
  );
  assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
  const manifest = JSON.parse(inspected.stdout).manifest;
  assert.deepEqual(manifest.diagnostics, []);

  const runtimeExport = manifestEntry(manifest, "runtimeValue");
  assert.equal(runtimeExport.effect, "runtime");
  assert.equal(runtimeExport.result.type, "Nat");

  const runtimeImport = manifest.hostImports.find(
    (entry) => entry.target === "test.runtime.value",
  );
  assert.ok(runtimeImport, "runtime host import missing");
  assert.equal(runtimeImport.effect, "runtime");
  assert.equal(runtimeImport.boundary, "hostResource");
  assert.equal(runtimeImport.arity, 1);
  assert.equal(runtimeImport.erasedPrefixArgs, 0);
  assert.equal(runtimeImport.result.type, "Js");

  const report = await readFile(runtimeReport, "utf8");
  assert.match(report, /runtimeValue/);
  assert.match(report, /test\.runtime\.value/);

  const hostSlotPackage = join(freshDir, "host-import-slots.irpkg");
  const hostSlotReport = join(freshDir, "host-import-slots.report.md");
  const hostSlotNames = Array.from(
    { length: 128 },
    (_, slot) => `hostSlot${slot}`,
  );
  const hostSlotLines = hostSlotNames.flatMap((name, slot) => [
    `@[vir_js "test.slot.${slot}"]`,
    `private opaque ${name} : Lean.Vir.RuntimeM (Lean.Vir.Js Unit)`,
    "",
  ]);
  const hostSlotProject = await createRuntimeModuleProject(
    join(freshDir, "slots"),
    {
      HostImportSlots: [
        "module",
        "public import Vir.Js",
        "public section",
        "set_option maxRecDepth 1024",
        "",
        ...hostSlotLines,
        "def hostSlotTotal : Lean.Vir.RuntimeM (Lean.Vir.Js Unit) := do",
        ...hostSlotNames.slice(0, -1).map((name) => `  let _ ← ${name}`),
        `  ${hostSlotNames.at(-1)}`,
        "",
      ].join("\n"),
    },
  );
  assertCompiled(hostSlotProject.build());

  const generatedHostSlots = hostSlotProject.runVirIrpkg([
    hostSlotPackage,
    hostSlotReport,
    "--target-all-module",
    "HostImportSlots",
  ]);
  assert.equal(
    generatedHostSlots.status,
    0,
    generatedHostSlots.stderr || generatedHostSlots.stdout,
  );

  const inspectedHostSlots = spawnSync(
    "node",
    ["scripts/packages/inspect-irpkg.mjs", "--json", hostSlotPackage],
    {
      encoding: "utf8",
    },
  );
  assert.equal(
    inspectedHostSlots.status,
    0,
    inspectedHostSlots.stderr || inspectedHostSlots.stdout,
  );
  const hostSlotManifest = JSON.parse(inspectedHostSlots.stdout).manifest;
  assert.deepEqual(hostSlotManifest.diagnostics, []);
  assert.equal(hostSlotManifest.hostImports.length, 128);
  assert.deepEqual(
    hostSlotManifest.hostImports
      .map((entry) => entry.slot)
      .sort((a, b) => a - b),
    Array.from({ length: 128 }, (_, slot) => slot),
  );
  const lastHostSlot = hostSlotManifest.hostImports.find(
    (entry) => entry.slot === 127,
  );
  assert.equal(lastHostSlot?.symbol, "vir_js_import_127_1");
  assert.equal(lastHostSlot?.boundary, "hostResource");
  assert.equal(lastHostSlot?.arity, 1);
} finally {
  await rm(freshDir, { recursive: true, force: true });
}

console.log("vir package generator smoke ok");
