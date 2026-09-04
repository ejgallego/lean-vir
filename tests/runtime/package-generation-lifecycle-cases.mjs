/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { fileURLToPath } from "node:url";

import {
  createVirImports,
  createVirRuntimeFactory,
} from "../../web/src/vir-runtime.js";
import { VIR_HOST_DISPOSE } from "../../web/src/host-boundary.js";
import {
  createCommonHostBindings,
  createHostLifecycle,
} from "../../web/src/vir-host-bindings.js";
import {
  assert,
  join,
  readFile,
  runVirIrpkg,
  writeRuntimeFixture,
} from "./shared.mjs";

const hostInteropSource = fileURLToPath(
  new URL("../../examples/HostInterop.lean", import.meta.url),
);
const sharedStringImportName = "Lean.Vir.JsValue.ofString";
const parserScoreEntry =
  "Vir.Fixtures.LeanParser.upstreamParserInputContextScore";

export async function runIrPackageLifecycleSmoke({
  freshDir,
  wasmBytes,
  leanPackageBytes,
}) {
  const firstPackage = join(freshDir, "reload-host-first.irpkg");
  const firstReport = join(freshDir, "reload-host-first.report.md");
  const secondPackage = join(freshDir, "reload-host-second.irpkg");
  const secondReport = join(freshDir, "reload-host-second.report.md");

  const generatedFirst = runVirIrpkg([
    firstPackage,
    firstReport,
    "--target",
    hostInteropSource,
    "HostInterop.titleHandshake",
  ]);
  assert.equal(
    generatedFirst.status,
    0,
    generatedFirst.stderr || generatedFirst.stdout,
  );
  const generatedSecond = runVirIrpkg([
    secondPackage,
    secondReport,
    "--target",
    hostInteropSource,
    "HostInterop.callbackRoundTrip",
    "HostInterop.titleHandshake",
  ]);
  assert.equal(
    generatedSecond.status,
    0,
    generatedSecond.stderr || generatedSecond.stdout,
  );

  const bindingGenerations = [];
  let failNextInstantiation = false;
  let sharedBindingDisposals = 0;
  const hostRuntime = await createVirRuntimeFactory({
    wasmBytes,
    imports: (module, hostState) => {
      if (failNextInstantiation) {
        failNextInstantiation = false;
        throw new Error("replacement import construction failed");
      }
      return createVirImports(module, {}, hostState);
    },
    hostBindings: {
      [VIR_HOST_DISPOSE]: () => {
        sharedBindingDisposals += 1;
      },
    },
    defaultHostBindings: () => {
      const lifecycle = createHostLifecycle();
      const documentValue = { title: "" };
      bindingGenerations.push(lifecycle);
      return {
        ...createCommonHostBindings(),
        "browser.document.current": () => documentValue,
        "browser.document.getTitle": (document) => document.title,
        "browser.document.setTitle": (document, title) => {
          document.title = title;
          return undefined;
        },
        [VIR_HOST_DISPOSE]: () => lifecycle.dispose(),
      };
    },
  }).createRuntime({ irPackageSetBytes: [await readFile(firstPackage)] });
  const firstGenerationLifecycle = bindingGenerations[0];
  const ordinaryValue = { generation: "first" };
  const firstImport = hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.name === sharedStringImportName,
  );
  assert.ok(
    firstImport,
    `${sharedStringImportName} missing from first reload package`,
  );
  assert.equal(
    hostRuntime.call("HostInterop.titleHandshake", "first"),
    "Lean VIR host: first",
  );

  const secondPackageBytes = await readFile(secondPackage);
  failNextInstantiation = true;
  assert.throws(
    () => hostRuntime.loadIrPackageSetBytes([secondPackageBytes]),
    /replacement import construction failed/,
  );
  const failedGenerationLifecycle = bindingGenerations[1];
  assert.equal(
    failedGenerationLifecycle.phase,
    "disposed",
    "failed replacement must dispose its fresh active-resource lifecycle",
  );
  assert.equal(firstGenerationLifecycle.phase, "active");
  assert.equal(
    sharedBindingDisposals,
    0,
    "failed replacement must preserve a binding map leased by the live runtime",
  );

  hostRuntime.loadIrPackageSetBytes([secondPackageBytes]);
  const secondGenerationLifecycle = bindingGenerations[2];
  assert.notEqual(
    secondGenerationLifecycle,
    firstGenerationLifecycle,
    "package replacement should install a fresh active-resource lifecycle",
  );
  assert.equal(firstGenerationLifecycle.phase, "disposed");
  assert.equal(secondGenerationLifecycle.phase, "active");
  assert.deepEqual(
    ordinaryValue,
    { generation: "first" },
    "package replacement must not invalidate ordinary JavaScript values",
  );
  let rolledBack = 0;
  assert.throws(
    () => firstGenerationLifecycle.addDisposable({}, () => rolledBack++),
    /cannot register active resources/,
  );
  assert.equal(rolledBack, 1);
  const secondImport = hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.name === sharedStringImportName,
  );
  assert.ok(
    secondImport,
    `${sharedStringImportName} missing from second reload package`,
  );
  assert.notEqual(
    secondImport.slot,
    firstImport.slot,
    `${sharedStringImportName} must move slots for the reload regression`,
  );
  assert.equal(
    hostRuntime.call("HostInterop.titleHandshake", "second"),
    "Lean VIR host: second",
  );
  hostRuntime.dispose();
  assert.equal(sharedBindingDisposals, 1);

  const initializerRuntime = await createVirRuntimeFactory({
    wasmBytes,
  }).createRuntime({ irPackageSetBytes: [leanPackageBytes] });
  assert.equal(initializerRuntime.call(parserScoreEntry), "1123");
  initializerRuntime.loadIrPackageSetBytes([leanPackageBytes]);
  assert.equal(initializerRuntime.call(parserScoreEntry), "1123");
  const replacementPages = [];
  for (let iteration = 0; iteration < 12; iteration += 1) {
    initializerRuntime.loadIrPackageSetBytes([leanPackageBytes]);
    assert.equal(initializerRuntime.call(parserScoreEntry), "1123");
    replacementPages.push(
      initializerRuntime.exports.memory.buffer.byteLength / 65536,
    );
  }
  const warmedReplacementPages = replacementPages.slice(2);
  assert.ok(
    Math.max(...warmedReplacementPages) - Math.min(...warmedReplacementPages) <=
      1,
    `package replacement should keep active Wasm memory bounded; pages: ${replacementPages.join(", ")}`,
  );
  initializerRuntime.dispose();

  const fallbackSource = join(freshDir, "ExternFallback.lean");
  const fallbackPackage = join(freshDir, "extern-fallback-runtime.irpkg");
  const fallbackReport = join(freshDir, "extern-fallback-runtime.report.md");
  await writeRuntimeFixture(fallbackSource, "ExternFallback.lean");
  const generatedFallback = runVirIrpkg([
    fallbackPackage,
    fallbackReport,
    "--target-marked",
    fallbackSource,
  ]);
  assert.equal(
    generatedFallback.status,
    0,
    generatedFallback.stderr || generatedFallback.stdout,
  );
  const fallbackRuntime = await createVirRuntimeFactory({
    wasmBytes,
  }).createRuntime({ irPackageSetBytes: [await readFile(fallbackPackage)] });
  assert.equal(fallbackRuntime.call("callExternIncrement", 41), "42");
  const fallbackBytes = new Uint8Array([0, 1, 2, 255]);
  assert.deepEqual(
    fallbackRuntime.call("callExternBorrowedIdentity", fallbackBytes),
    fallbackBytes,
  );
  assert.equal(fallbackRuntime.call("callExternOwnedSize", fallbackBytes), "4");
  fallbackRuntime.dispose();
}
