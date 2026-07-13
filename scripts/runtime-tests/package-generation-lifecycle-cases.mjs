/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createVirRuntimeFactory,
  createVirtualDocumentState,
} from "../../web/src/vir-runtime-node.js";
import {
  assert,
  join,
  readFile,
  runVirIrpkg,
} from "./shared.mjs";

const hostInteropSource = new URL("../../examples/HostInterop.lean", import.meta.url).pathname;
const sharedStringImportName = "Lean.Vir.JsValue.ofString";
const parserScoreEntry = "Vir.Fixtures.LeanParser.upstreamParserInputContextScore";

export async function runIrPackageLifecycleSmoke({ freshDir, wasmBytes, leanPackageBytes }) {
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
  assert.equal(generatedFirst.status, 0, generatedFirst.stderr || generatedFirst.stdout);
  const generatedSecond = runVirIrpkg([
    secondPackage,
    secondReport,
    "--target",
    hostInteropSource,
    "HostInterop.callbackRoundTrip",
    "HostInterop.titleHandshake",
  ]);
  assert.equal(generatedSecond.status, 0, generatedSecond.stderr || generatedSecond.stdout);

  const documentState = createVirtualDocumentState();
  const hostRuntime = await createVirRuntimeFactory({
    wasmBytes,
    virtualDocumentState: documentState,
  }).createRuntime({ irPackageBytes: await readFile(firstPackage) });
  const firstImport = hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.name === sharedStringImportName,
  );
  assert.ok(firstImport, `${sharedStringImportName} missing from first reload package`);
  assert.equal(hostRuntime.call("HostInterop.titleHandshake", "first"), "Lean VIR host: first");

  hostRuntime.loadIrPackageBytes(await readFile(secondPackage));
  const secondImport = hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.name === sharedStringImportName,
  );
  assert.ok(secondImport, `${sharedStringImportName} missing from second reload package`);
  assert.notEqual(
    secondImport.slot,
    firstImport.slot,
    `${sharedStringImportName} must move slots for the reload regression`,
  );
  assert.equal(hostRuntime.call("HostInterop.titleHandshake", "second"), "Lean VIR host: second");
  hostRuntime.dispose();

  const initializerRuntime = await createVirRuntimeFactory({ wasmBytes })
    .createRuntime({ irPackageBytes: leanPackageBytes });
  assert.equal(initializerRuntime.call(parserScoreEntry), "1123");
  initializerRuntime.loadIrPackageBytes(leanPackageBytes);
  assert.equal(initializerRuntime.call(parserScoreEntry), "1123");
  const replacementPages = [];
  for (let iteration = 0; iteration < 12; iteration += 1) {
    initializerRuntime.loadIrPackageBytes(leanPackageBytes);
    assert.equal(initializerRuntime.call(parserScoreEntry), "1123");
    replacementPages.push(initializerRuntime.exports.memory.buffer.byteLength / 65536);
  }
  const warmedReplacementPages = replacementPages.slice(2);
  assert.ok(
    Math.max(...warmedReplacementPages) - Math.min(...warmedReplacementPages) <= 1,
    `package replacement should keep active Wasm memory bounded; pages: ${replacementPages.join(", ")}`,
  );
  initializerRuntime.dispose();
}
