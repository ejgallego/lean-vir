/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

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
  generateIrPackage,
  join,
  readFile,
  runVirIrpkg,
  spawnSync,
  writeRuntimeFixture,
} from "./shared.mjs";

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

  const builtHost = spawnSync("lake", ["build", "+fixtures.HostInterop"], { encoding: "utf8" });
  assert.equal(builtHost.status, 0, builtHost.stderr || builtHost.stdout);

  const generatedFirst = runVirIrpkg([
    firstPackage,
    firstReport,
    "--target-module",
    "HostInterop",
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
    "--target-module",
    "fixtures.HostInterop",
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
  const hostFactory = createVirRuntimeFactory({
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
  });
  const compiledModule = await hostFactory.module();
  const hostRuntime = await hostFactory.createRuntime({
    irPackageSet: [await readFile(firstPackage)],
  });
  assert.equal(
    hostRuntime.module,
    compiledModule,
    "the first runtime uses the factory's compiled module",
  );
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
  await assert.rejects(
    () => hostFactory.createRuntime({ irPackageSet: [secondPackageBytes] }),
    /replacement import construction failed/,
  );
  const failedGenerationLifecycle = bindingGenerations[1];
  assert.equal(
    failedGenerationLifecycle.phase,
    "disposed",
    "failed generation must dispose its fresh active-resource lifecycle",
  );
  assert.equal(firstGenerationLifecycle.phase, "active");
  assert.equal(
    sharedBindingDisposals,
    0,
    "failed replacement must preserve a binding map leased by the live runtime",
  );

  const secondRuntime = await hostFactory.createRuntime({
    irPackageSet: [secondPackageBytes],
  });
  assert.equal(
    secondRuntime.module,
    compiledModule,
    "fresh generations reuse the compiled module",
  );
  const secondGenerationLifecycle = bindingGenerations[2];
  assert.notEqual(
    secondGenerationLifecycle,
    firstGenerationLifecycle,
    "a fresh runtime should install a fresh active-resource lifecycle",
  );
  assert.equal(firstGenerationLifecycle.phase, "active");
  assert.equal(secondGenerationLifecycle.phase, "active");
  assert.deepEqual(
    ordinaryValue,
    { generation: "first" },
    "a new runtime must not invalidate ordinary JavaScript values",
  );
  const secondImport = secondRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.name === sharedStringImportName,
  );
  assert.ok(
    secondImport,
    `${sharedStringImportName} missing from second generation package`,
  );
  assert.notEqual(
    secondImport.slot,
    firstImport.slot,
    `${sharedStringImportName} must use its own generation slot`,
  );
  assert.equal(
    secondRuntime.call("HostInterop.titleHandshake", "second"),
    "Lean VIR host: second",
  );
  hostRuntime.dispose();
  assert.equal(firstGenerationLifecycle.phase, "disposed");
  assert.equal(sharedBindingDisposals, 0);
  secondRuntime.dispose();
  assert.equal(sharedBindingDisposals, 1);

  const initializerFactory = createVirRuntimeFactory({
    wasmBytes,
  });
  const initializerRuntime = await initializerFactory.createRuntime({
    irPackageSet: [leanPackageBytes],
  });
  assert.equal(initializerRuntime.call(parserScoreEntry), "1123");
  const secondInitializerRuntime = await initializerFactory.createRuntime({
    irPackageSet: [leanPackageBytes],
  });
  assert.equal(secondInitializerRuntime.call(parserScoreEntry), "1123");
  initializerRuntime.dispose();
  secondInitializerRuntime.dispose();

  const fallbackSource = join(freshDir, "ExternFallback.lean");
  const fallbackPackage = join(freshDir, "extern-fallback-runtime.irpkg");
  await writeRuntimeFixture(fallbackSource, "ExternFallback.lean");
  await generateIrPackage("ExternFallback", fallbackSource, fallbackPackage, "marked");
  const fallbackRuntime = await createVirRuntimeFactory({
    wasmBytes,
  }).createRuntime({ irPackageSet: [await readFile(fallbackPackage)] });
  assert.equal(fallbackRuntime.call("callExternIncrement", 41), "42");
  const fallbackBytes = new Uint8Array([0, 1, 2, 255]);
  assert.deepEqual(
    fallbackRuntime.call("callExternBorrowedIdentity", fallbackBytes),
    fallbackBytes,
  );
  assert.equal(fallbackRuntime.call("callExternOwnedSize", fallbackBytes), "4");
  fallbackRuntime.dispose();
}
