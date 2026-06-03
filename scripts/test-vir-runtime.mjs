/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createVirRuntime as createExportedBrowserVirRuntime } from "lean-vir";
import { createVirRuntime as createExportedNodeVirRuntime } from "lean-vir/vir-runtime-node";
import {
  createVirImports,
  createVirRuntime as createBrowserVirRuntime,
  roundTripInterfaceTypeDescriptor,
  sameInterfaceWireType,
} from "../web/src/vir-runtime.js";
import {
  createVirRuntime,
  createVirRuntimeFactory,
  createVirtualDocumentState,
} from "../web/src/vir-runtime-node.js";
import {
  INTERFACE_MANIFEST_ARTIFACT,
  validateInterfaceManifest,
} from "../web/src/interface-manifest.js";

function assertManifestTypeDescriptorsRoundTrip(manifest) {
  const entries = [
    ...manifest.exports,
    ...(manifest.hostImports ?? []).map((entry) => ({
      ...entry,
      entry: entry.name,
    })),
  ];
  for (const entry of entries) {
    for (const arg of entry.args) {
      const decoded = roundTripInterfaceTypeDescriptor(arg.type, `${entry.entry} argument ${arg.name}`);
      assert.ok(
        sameInterfaceWireType(arg.type, decoded),
        `${entry.entry} argument ${arg.name} descriptor should round-trip`,
      );
    }
    const decoded = roundTripInterfaceTypeDescriptor(entry.result, `${entry.entry} result`);
    assert.ok(
      sameInterfaceWireType(entry.result, decoded),
      `${entry.entry} result descriptor should round-trip`,
    );
  }
}

const validManifestShape = {
  artifact: INTERFACE_MANIFEST_ARTIFACT,
  version: 1,
  metadata: {},
  exports: [
    {
      id: "ok",
      jsName: "ok",
      entry: "ok",
      source: "Ok.lean",
      args: [{ name: "arg1", type: { type: "Nat", wireTag: 0 } }],
      result: { type: "Nat", wireTag: 0 },
    },
  ],
};

function assertInvalidManifest(mutator, pattern) {
  const manifest = structuredClone(validManifestShape);
  mutator(manifest);
  assert.throws(() => validateInterfaceManifest(manifest), pattern);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertUnsupportedInterfaceSource(dir, stem, lines, patterns) {
  const source = join(dir, `${stem}.lean`);
  const packagePath = join(dir, `${stem}.irpkg`);
  const reportPath = join(dir, `${stem}.report.md`);
  await writeFile(source, lines.join("\n"));
  const generated = spawnSync(
    "lean",
    [
      "--run",
      "tools/GeneratePackage.lean",
      packagePath,
      reportPath,
      "--target-all",
      source,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(generated.status, 0, `${stem} unexpectedly generated successfully`);
  assert.match(generated.stderr, /unsupported interface exports/);
  const report = await readFile(reportPath, "utf8");
  for (const pattern of patterns) {
    assert.match(generated.stderr, pattern);
    assert.match(report, pattern);
  }
}

const wasmBytes = await readFile(new URL("../web/public/vir-upstream.wasm", import.meta.url));
const irPackageBytes = await readFile(new URL("../web/public/fixtures-basic.irpkg", import.meta.url));
const hostPackageBytes = await readFile(new URL("../web/public/demo-host.irpkg", import.meta.url));
const prettyPackageBytes = await readFile(new URL("../web/public/pretty-printer.irpkg", import.meta.url));
const leanPackageBytes = await readFile(new URL("../web/public/fixtures-lean.irpkg", import.meta.url));
const hostlessImports = createVirImports(new WebAssembly.Module(wasmBytes));
assert.throws(
  () => hostlessImports.env.vir_js_call(0, 0, 0),
  /without an attached host state/,
);

const runtime = await createVirRuntime({ wasmBytes, irPackageBytes });
const callbackRecords = [];
const virtualDocumentState = createVirtualDocumentState();
const hostRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  virtualDocumentState,
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      try {
        return callback(input);
      } finally {
        callback.release();
      }
    },
    "test.recordNat": (value) => {
      callbackRecords.push(Number(value));
      return undefined;
    },
  },
});
const prettyRuntime = await createVirRuntime({ wasmBytes, irPackageBytes: prettyPackageBytes });
const leanRuntime = await createVirRuntime({ wasmBytes, irPackageBytes: leanPackageBytes });
assert.equal(createExportedBrowserVirRuntime, createBrowserVirRuntime);
assert.equal(createExportedNodeVirRuntime, createVirRuntime);
assert.equal(runtime.targetPointerBytes(), 4);
assert.ok(runtime.packageInfo.count > 0, "expected IR package to load declarations");
assert.equal(runtime.packageDeclCount(), runtime.packageInfo.count);
assert.equal(runtime.packageInfo.byteLength, irPackageBytes.byteLength);
assert.ok(runtime.packageInfo.interfaceExports > 0, "expected embedded interface exports");
assert.equal(runtime.packageInfo.hostImports, 0);
assert.equal(hostRuntime.packageInfo.hostImports, 19);
assert.equal(runtime.packageInfo.metadata, runtime.packageMetadata);
assert.equal(runtime.packageMetadata.packageFormatVersion, 5);
assert.equal(runtime.packageMetadata.manifestVersion, 1);
assert.match(runtime.packageMetadata.leanToolchain, /leanprover\/lean4/);
assert.ok(runtime.packageMetadata.generatedAt.length > 0);
assert.ok(runtime.packageMetadata.targets.some((target) => target.source === "examples/Fib.lean"));
assert.ok(runtime.interfaceManifest.exports.some((entry) => entry.entry === "fib"));
assertManifestTypeDescriptorsRoundTrip(runtime.interfaceManifest);
assertManifestTypeDescriptorsRoundTrip(hostRuntime.interfaceManifest);
assertManifestTypeDescriptorsRoundTrip(prettyRuntime.interfaceManifest);
assertManifestTypeDescriptorsRoundTrip(leanRuntime.interfaceManifest);
assert.equal(validateInterfaceManifest(structuredClone(validManifestShape)).exports[0].entry, "ok");
assertInvalidManifest((manifest) => {
  manifest.exports[0].result = { type: "UnsupportedTag13", wireTag: 13 };
}, /result\.wireTag is not supported/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].args[0].type = { type: "Array Nat", wireTag: 16 };
}, /args\[0\]\.type\.element must be an object/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].result = {
    type: "Mode",
    wireTag: 14,
    kind: "simpleEnum",
    constructors: [
      { name: "Mode.cold", jsName: "cold", tag: 0 },
      { name: "Mode.hot", jsName: "hot", tag: 2 },
    ],
  };
}, /constructors\[1\]\.tag must be 1/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].result = {
    type: "Sum Nat Nat",
    wireTag: 21,
    kind: "taggedUnion",
    name: "Sum",
    constructors: [],
  };
}, /constructors must be a non-empty array/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].result = {
    type: "Box Nat",
    wireTag: 20,
    kind: "structure",
    name: "Box",
    objectFieldCount: 1,
    usizeFieldCount: 0,
    scalarByteSize: 0,
    trivialFieldIndex: 1,
    fields: [
      {
        name: "value",
        type: { type: "Nat", wireTag: 0 },
        layout: { kind: "object", index: 0 },
      },
    ],
  };
}, /trivialFieldIndex is out of range/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].result = {
    type: "Box Nat",
    wireTag: 20,
    kind: "structure",
    name: "Box",
    objectFieldCount: 0,
    usizeFieldCount: 0,
    scalarByteSize: 0,
    fields: [
      {
        name: "value",
        type: { type: "Nat", wireTag: 0 },
        layout: { kind: "object", index: 0 },
      },
    ],
  };
}, /layout\.index is outside objectFieldCount/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].result = {
    type: "ScalarBox",
    wireTag: 20,
    kind: "structure",
    name: "ScalarBox",
    objectFieldCount: 0,
    usizeFieldCount: 0,
    scalarByteSize: 1,
    fields: [
      {
        name: "flag",
        type: { type: "Bool", wireTag: 2 },
        layout: { kind: "scalar", size: 1, offset: 1 },
      },
    ],
  };
}, /layout is outside scalarByteSize/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].args[0].type.type = "";
}, /args\[0\]\.type\.type must be a non-empty string/);
assertInvalidManifest((manifest) => {
  manifest.exports.push(structuredClone(manifest.exports[0]));
}, /entry duplicates another interface export/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].result = {
    type: "Child",
    wireTag: 20,
    kind: "structure",
    name: "Child",
    objectFieldCount: 2,
    usizeFieldCount: 0,
    scalarByteSize: 0,
    fields: [
      {
        name: "toParent",
        subobject: true,
        type: {
          type: "Parent",
          wireTag: 20,
          kind: "structure",
          name: "Parent",
          objectFieldCount: 1,
          usizeFieldCount: 0,
          scalarByteSize: 0,
          fields: [
            {
              name: "value",
              type: { type: "Nat", wireTag: 0 },
              layout: { kind: "object", index: 0 },
            },
          ],
        },
        layout: { kind: "object", index: 0 },
      },
      {
        name: "value",
        type: { type: "Nat", wireTag: 0 },
        layout: { kind: "object", index: 1 },
      },
    ],
  };
}, /fields\[1\]\.name duplicates another flattened structure field/);
assert.deepEqual(hostRuntime.interfaceManifest.hostImports.map((entry) => entry.target).sort(), [
  "browser.animation.cancelAnimationFrame",
  "browser.animation.requestAnimationFrame",
  "browser.document.getTitle",
  "browser.document.querySelector",
  "browser.document.setTitle",
  "browser.element.addEventListener",
  "browser.element.getAttribute",
  "browser.element.removeEventListener",
  "browser.element.setAttribute",
  "browser.element.setTextContent",
  "browser.htmlInputElement.fromElement",
  "browser.htmlInputElement.getChecked",
  "browser.htmlInputElement.getValue",
  "browser.htmlInputElement.setChecked",
  "browser.htmlInputElement.setValue",
  "browser.timer.clearTimeout",
  "browser.timer.setTimeout",
  "test.callNatCallback",
  "test.recordNat",
]);
const browserRuntime = await createBrowserVirRuntime({ wasmBytes, irPackageBytes: hostPackageBytes });
assert.throws(
  () => browserRuntime.call("HostInterop.titleHandshake", "node"),
  /browser\.document host binding requires globalThis\.document/,
);
assert.equal(runtime.call("fib", 12), "144");
assert.equal(runtime.exportsByName.fib(12), "144");
assert.equal(hostRuntime.call("HostInterop.titleHandshake", "runtime smoke"), "Lean VIR host: runtime smoke");
assert.equal(hostRuntime.call("HostInterop.callbackRoundTrip", 5), "12");
assert.equal(hostRuntime.liveCallbacks.size, 0);

let retainedCallback = null;
const retainedCallbackRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      retainedCallback = callback;
      return callback(input);
    },
    "test.recordNat": () => undefined,
  },
});
assert.equal(retainedCallbackRuntime.call("HostInterop.callbackRoundTrip", 3), "10");
assert.equal(retainedCallbackRuntime.liveCallbacks.size, 1);
assert.equal(retainedCallback(4), "11");
const staleCallbackHandle = retainedCallback.handle;
const staleCallbackType = retainedCallback.type;
assert.equal(retainedCallback.release(), true);
assert.equal(retainedCallback.release(), false);
assert.equal(retainedCallback.released, true);
assert.equal(retainedCallbackRuntime.liveCallbacks.size, 0);
assert.throws(() => retainedCallback(4), /released/);
assert.throws(
  () => retainedCallbackRuntime.callClosure(staleCallbackHandle, staleCallbackType, [4]),
  /closure handle is not live/,
);
retainedCallbackRuntime.dispose();

const nestedCallbackErrorRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      try {
        return callback(input, input);
      } finally {
        callback.release();
      }
    },
    "test.recordNat": () => undefined,
  },
});
assert.throws(
  () => nestedCallbackErrorRuntime.call("HostInterop.callbackRoundTrip", 1),
  /callback expects 1 arguments, got 2/,
);
assert.equal(nestedCallbackErrorRuntime.liveCallbacks.size, 0);
nestedCallbackErrorRuntime.dispose();

const lifecycleDocumentState = createVirtualDocumentState();
const lifecycleRecords = [];
const lifecycleRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  virtualDocumentState: lifecycleDocumentState,
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      try {
        return callback(input);
      } finally {
        callback.release();
      }
    },
    "test.recordNat": (value) => {
      lifecycleRecords.push(Number(value));
      return undefined;
    },
  },
});
assert.equal(lifecycleRuntime.call("HostInterop.mountCallbackEvent", "#callback"), "1");
lifecycleDocumentState.elements.get("#callback").listeners.get("click")[0].dispatch({});
assert.deepEqual(lifecycleRecords.splice(0), [101]);
lifecycleRuntime.dispose();
assert.equal(lifecycleRuntime.liveCallbacks.size, 0);
lifecycleDocumentState.elements.get("#callback").listeners.get("click")?.[0]?.dispatch({});
assert.deepEqual(lifecycleRecords.splice(0), []);

const lifecycleDocumentState2 = createVirtualDocumentState();
const lifecycleRecords2 = [];
const lifecycleRuntime2 = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  virtualDocumentState: lifecycleDocumentState2,
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      try {
        return callback(input);
      } finally {
        callback.release();
      }
    },
    "test.recordNat": (value) => {
      lifecycleRecords2.push(Number(value));
      return undefined;
    },
  },
});
assert.equal(lifecycleRuntime2.call("HostInterop.mountAndRemoveCallbackEvent", "#callback"), "1");
assert.equal(lifecycleRuntime2.liveCallbacks.size, 0);
lifecycleDocumentState2.elements.get("#callback").listeners.get("click")?.[0]?.dispatch({});
assert.deepEqual(lifecycleRecords2.splice(0), []);
assert.equal(lifecycleRuntime2.call("HostInterop.timeoutRecord", 40), "1");
await wait(10);
assert.deepEqual(lifecycleRecords2.splice(0), [41]);
assert.equal(lifecycleRuntime2.liveCallbacks.size, 0);
assert.equal(lifecycleRuntime2.call("HostInterop.clearTimeoutRecord", 40), "1");
await wait(30);
assert.deepEqual(lifecycleRecords2.splice(0), []);
assert.equal(lifecycleRuntime2.call("HostInterop.startTimeoutLoop", 2), "1");
await wait(30);
assert.deepEqual(lifecycleRecords2.splice(0), [2, 1, 0]);
assert.equal(lifecycleRuntime2.call("HostInterop.animationRecord", 50), "1");
await wait(30);
assert.deepEqual(lifecycleRecords2.splice(0), [52]);
assert.equal(lifecycleRuntime2.call("HostInterop.cancelAnimationRecord", 50), "1");
await wait(30);
assert.deepEqual(lifecycleRecords2.splice(0), []);
assert.equal(lifecycleRuntime2.call("HostInterop.startAnimationLoop", 2), "1");
await wait(80);
assert.deepEqual(lifecycleRecords2.splice(0), [2, 1, 0]);
lifecycleRuntime2.dispose();
assert.throws(() => lifecycleRuntime2.call("HostInterop.callbackRoundTrip", 1), /disposed/);

const pendingDocumentState = createVirtualDocumentState();
const pendingRecords = [];
const pendingRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  virtualDocumentState: pendingDocumentState,
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      try {
        return callback(input);
      } finally {
        callback.release();
      }
    },
    "test.recordNat": (value) => {
      pendingRecords.push(Number(value));
      return undefined;
    },
  },
});
assert.equal(pendingRuntime.call("HostInterop.mountCallbackEvent", "#pending"), "1");
assert.equal(pendingRuntime.call("HostInterop.timeoutRecord", 70), "1");
assert.equal(pendingRuntime.call("HostInterop.animationRecord", 80), "1");
assert.equal(pendingRuntime.liveCallbacks.size, 3);
pendingRuntime.dispose();
assert.equal(pendingRuntime.liveCallbacks.size, 0);
pendingDocumentState.elements.get("#pending").listeners.get("click")?.[0]?.dispatch({});
await wait(40);
assert.deepEqual(pendingRecords.splice(0), []);

const reloadDocumentState = createVirtualDocumentState();
const reloadRecords = [];
const reloadRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  virtualDocumentState: reloadDocumentState,
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      try {
        return callback(input);
      } finally {
        callback.release();
      }
    },
    "test.recordNat": (value) => {
      reloadRecords.push(Number(value));
      return undefined;
    },
  },
});
assert.equal(reloadRuntime.call("HostInterop.mountCallbackEvent", "#reload"), "1");
assert.equal(reloadRuntime.call("HostInterop.timeoutRecord", 90), "1");
assert.equal(reloadRuntime.call("HostInterop.animationRecord", 100), "1");
assert.equal(reloadRuntime.liveCallbacks.size, 3);
reloadRuntime.loadIrPackageBytes(irPackageBytes);
assert.equal(reloadRuntime.packageInfo.hostImports, 0);
assert.equal(reloadRuntime.liveCallbacks.size, 0);
assert.throws(() => reloadRuntime.call("HostInterop.callbackRoundTrip", 1), /interface entry not found/);
assert.equal(reloadRuntime.call("fib", 12), "144");
reloadDocumentState.elements.get("#reload").listeners.get("click")?.[0]?.dispatch({});
await wait(40);
assert.deepEqual(reloadRecords.splice(0), []);
reloadRuntime.dispose();

assert.equal(hostRuntime.call("Tamagotchi.uiMountFromDom"), "8");
assert.equal(hostRuntime.liveCallbacks.size, 8);
const petReset = hostRuntime.call("Tamagotchi.uiReset", "Mochi", "pet");
assert.deepEqual(petReset, {
  name: "Mochi",
  mood: "happy",
  trace: ["happy"],
  artwork: "pet",
  turns: "0",
  care: "3",
});
assert.deepEqual(hostRuntime.call("Tamagotchi.uiStep", petReset, "ignore"), {
  name: "Mochi",
  mood: "hungry",
  trace: ["happy", "hungry"],
  artwork: "pet",
  turns: "1",
  care: "2",
});
assert.deepEqual(hostRuntime.call("Tamagotchi.uiResetFromDom"), {
  name: "Mochi",
  mood: "happy",
  trace: ["happy"],
  artwork: "pet",
  turns: "0",
  care: "3",
});
assert.deepEqual(hostRuntime.call("Tamagotchi.uiRenameFromDom"), {
  name: "Mochi",
  mood: "happy",
  trace: ["happy"],
  artwork: "pet",
  turns: "0",
  care: "3",
});
assert.deepEqual(hostRuntime.call("Tamagotchi.uiStepFromDom", "ignore"), {
  name: "Mochi",
  mood: "hungry",
  trace: ["happy", "hungry"],
  artwork: "pet",
  turns: "1",
  care: "2",
});
virtualDocumentState.elements.get("[data-action='ignore']").listeners.get("click")?.[0]?.dispatch({});
assert.equal(virtualDocumentState.elements.get("#pet-device").attributes.get("data-mood"), "angry");
assert.equal(virtualDocumentState.elements.get("#pet-device").attributes.get("data-trace"), "happy,hungry,angry");
virtualDocumentState.elements.get("#pet-reset-button").listeners.get("click")?.[0]?.dispatch({});
assert.equal(virtualDocumentState.elements.get("#pet-device").attributes.get("data-mood"), "happy");
assert.equal(virtualDocumentState.elements.get("#pet-device").attributes.get("data-trace"), "happy");
virtualDocumentState.elements.get("#pet-name-input").value = "Ada";
virtualDocumentState.elements.get("#pet-name-input").listeners.get("change")?.[0]?.dispatch({});
assert.equal(virtualDocumentState.elements.get("#pet-device").attributes.get("data-name"), "Ada");
hostRuntime.dispose();
assert.equal(hostRuntime.liveCallbacks.size, 0);

const inspected = spawnSync("node", ["scripts/inspect-irpkg.mjs", "build/generated/fixtures-basic.irpkg"], {
  encoding: "utf8",
});
assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
assert.match(inspected.stdout, /package: build\/generated\/fixtures-basic\.irpkg/);
assert.match(inspected.stdout, new RegExp(`exports: ${runtime.interfaceManifest.exports.length}`));
assert.match(inspected.stdout, /host imports: 0/);
assert.match(inspected.stdout, /fib\(arg1: Nat\) -> Nat \[fib\]/);

const inspectedJson = spawnSync("node", ["scripts/inspect-irpkg.mjs", "--json", "build/generated/fixtures-basic.irpkg"], {
  encoding: "utf8",
});
assert.equal(inspectedJson.status, 0, inspectedJson.stderr || inspectedJson.stdout);
const inspectedInfo = JSON.parse(inspectedJson.stdout);
assert.equal(inspectedInfo.package.version, 5);
assert.equal(inspectedInfo.package.declarationCount, runtime.packageInfo.count);
assert.equal(inspectedInfo.manifest.exports.length, runtime.interfaceManifest.exports.length);
assert.equal(inspectedInfo.manifest.hostImports.length, 0);
assert.equal(runtime.exportsByName.SortDemo_demo(), "192");
assert.equal(runtime.call("SortDemo.demo"), "192");
assert.equal(runtime.call("fib", 12), "144");
assert.equal(runtime.call("SortDemo.demoFromArray", [4, 1, 3, 2]), "30");
assert.equal(runtime.call("Vir.Fixtures.Basic.stringUtf8RoundtripScore", "Aé∀Z"), "1381");
assert.equal(runtime.call("Vir.Fixtures.Basic.byteArrayInputScore", [65, 66, 67]), "136");
assert.equal(prettyRuntime.call("Vir.Fixtures.FormatPretty.formatPrettyCaseAtWidth", "list", 12), "[alpha,\n beta,\n gamma]");
assert.equal(
  prettyRuntime.call("Vir.Fixtures.FormatPretty.formatPrettyCaseAtWidth", "fill", 28),
  "lean ir runs format.pretty\ninside wasm",
);
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.constNatExpr"), {
  kind: "const",
  name: "Nat",
  levels: [],
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.twoLitExpr"), {
  kind: "lit",
  literal: { kind: "nat", value: "2" },
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.appExpr"), {
  kind: "app",
  fn: { kind: "const", name: "Nat.succ", levels: [] },
  arg: { kind: "lit", literal: { kind: "nat", value: "2" } },
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.sortParamExpr"), {
  kind: "sort",
  level: { kind: "succ", of: { kind: "param", name: "u" } },
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.fvarExpr"), {
  kind: "fvar",
  name: "x",
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.mvarExpr"), {
  kind: "mvar",
  name: "m",
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.lambdaExpr"), {
  kind: "lam",
  name: "x",
  type: { kind: "const", name: "Nat", levels: [] },
  body: { kind: "bvar", index: "0" },
  binderInfo: "default",
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.forallExpr"), {
  kind: "forall",
  name: "x",
  type: { kind: "const", name: "Nat", levels: [] },
  body: { kind: "bvar", index: "0" },
  binderInfo: "implicit",
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.letExpr"), {
  kind: "let",
  name: "x",
  type: { kind: "const", name: "Nat", levels: [] },
  value: { kind: "lit", literal: { kind: "nat", value: "2" } },
  body: { kind: "bvar", index: "0" },
  nondep: false,
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.stringLitExpr"), {
  kind: "lit",
  literal: { kind: "string", value: "hi" },
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.mdataExpr"), {
  kind: "mdata",
  expr: { kind: "bvar", index: "0" },
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.projExpr"), {
  kind: "proj",
  typeName: "Prod",
  index: "1",
  struct: { kind: "const", name: "p", levels: [] },
});
assert.equal(leanRuntime.call("Vir.Fixtures.ExprPrinter.exprCoverageScore"), "1232");
assert.equal(leanRuntime.call("Vir.Fixtures.ExprPrinter.exprKindScore", { kind: "bvar", index: 4 }), "5");
assert.equal(leanRuntime.call("Vir.Fixtures.ExprPrinter.exprKindScore", { kind: "lit", literal: { kind: "nat", value: 2 } }), "102");
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.bumpBVar", { kind: "bvar", index: 4 }), {
  kind: "bvar",
  index: "5",
});
assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifySum", 0), {
  kind: "inl",
  value: "10",
});
assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifySum", 4), {
  kind: "inr",
  value: "4",
});
assert.equal(runtime.call("Vir.Fixtures.ListOption.sumScore", { kind: "inr", value: 7 }), "70");
assert.equal(runtime.call("Vir.Fixtures.ListOption.sumScore", { inl: 12 }), "12");
assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifyExcept", 0), {
  kind: "error",
  value: "90",
});
assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifyExcept", 5), {
  kind: "ok",
  value: {
    kind: "inr",
    value: "5",
  },
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.arrayStringTotalLength", ["a", "bc"]), "3");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.listUInt32Sum", [1, 2, 3]), "6");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.uint32Bump", 41), 42);
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.uint64Bump", "18446744073709551615"), "0");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.floatScale", 1.5), 6);
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.floatScore", 3.25), "4");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.float32Roundtrip", 1.25), 1.25);
const floatScaleEntry = runtime.interfaceManifest.exports.find(
  (entry) => entry.entry === "Vir.Fixtures.InterfaceShapes.floatScale",
);
assert.equal(floatScaleEntry.args[0].type.wireTag, 10);
assert.equal(floatScaleEntry.result.wireTag, 10);
const float32Entry = runtime.interfaceManifest.exports.find(
  (entry) => entry.entry === "Vir.Fixtures.InterfaceShapes.float32Roundtrip",
);
assert.equal(float32Entry.args[0].type.wireTag, 11);
assert.equal(float32Entry.result.wireTag, 11);
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionNatBump", null), "0");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionNatBump", { kind: "some", value: 41 }), "42");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionStringBang", null), "empty");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionStringBang", "ok"), "ok!");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionNatScore", { some: 6 }), "17");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.prodNatNatSwap", { fst: 2, snd: 9 }), {
  fst: "9",
  snd: "2",
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.prodNatNatSum", [4, 5]), "9");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionArrayNatSum", [4, 5, 6]), "15");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionArrayNatSum", null), "0");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.listProdNatStringScore", [
  { fst: 4, snd: "ab" },
  [5, "c"],
]), "12");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.prodStringNatSwap", { fst: "ok", snd: 6 }), {
  fst: "7",
  snd: "ok!",
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.arrayExprKindScore", [
  { kind: "const", name: "Nat", levels: [] },
  { kind: "bvar", index: 2 },
]), "13");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.optionExprBump", { kind: "bvar", index: 6 }), {
  kind: "bvar",
  index: "7",
});
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.profileBump", {
  nickname: "lean",
  points: 4,
  tags: ["ir", "wasm"],
}), {
  nickname: "lean!",
  points: "6",
  tags: ["ir", "wasm"],
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.profileScore", {
  nickname: "lean",
  points: 4,
  tags: ["ir", "wasm"],
}), "14");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.profileSummary", {
  nickname: "lean",
  points: 4,
  tags: ["ir", "wasm"],
}), {
  label: "lean:2",
  total: "14",
  bonus: "14",
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.profileEnvelopeScore", {
  profile: {
    nickname: "lean",
    points: 4,
    tags: ["ir", "wasm"],
  },
  summary: {
    label: "lean:2",
    total: 14,
    bonus: 14,
  },
}), "48");
const profileStatsInput = {
  enabled: true,
  level: 2,
  score16: 30,
  visits: 400,
  quota: 5,
  checksum: 6000,
  tier: "pro",
  note: "ok",
};
const profileStatsEntry = runtime.interfaceManifest.exports.find(
  (entry) => entry.entry === "Vir.Fixtures.InterfaceShapes.profileStatsBump",
);
assert.equal(profileStatsEntry.args[0].type.objectFieldCount, 1);
assert.equal(profileStatsEntry.args[0].type.usizeFieldCount, 1);
assert.equal(profileStatsEntry.args[0].type.scalarByteSize, 17);
assert.deepEqual(
  profileStatsEntry.args[0].type.fields.map((field) => [field.name, field.layout.kind]),
  [
    ["enabled", "scalar"],
    ["level", "scalar"],
    ["score16", "scalar"],
    ["visits", "scalar"],
    ["quota", "usize"],
    ["checksum", "scalar"],
    ["tier", "scalar"],
    ["note", "object"],
  ],
);
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.profileStatsBump", profileStatsInput), {
  enabled: false,
  level: 3,
  score16: 32,
  visits: 403,
  quota: "9",
  checksum: "6005",
  tier: "elite",
  note: "ok!",
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.profileStatsScore", profileStatsInput), "6549");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.boxNatBump", { value: 41 }), {
  value: "42",
});
const boxNatEntry = runtime.interfaceManifest.exports.find(
  (entry) => entry.entry === "Vir.Fixtures.InterfaceShapes.boxNatBump",
);
assert.equal(boxNatEntry.args[0].type.type, "Vir.Fixtures.InterfaceShapes.Box Nat");
assert.equal(boxNatEntry.args[0].type.trivialFieldIndex, 0);
const boxUInt32Entry = runtime.interfaceManifest.exports.find(
  (entry) => entry.entry === "Vir.Fixtures.InterfaceShapes.boxUInt32Bump",
);
assert.equal(boxUInt32Entry.args[0].type.type, "Vir.Fixtures.InterfaceShapes.Box UInt32");
assert.equal(boxUInt32Entry.args[0].type.trivialFieldIndex, 0);
assert.equal(boxUInt32Entry.args[0].type.fields[0].type.wireTag, 6);
assert.equal(boxUInt32Entry.args[0].type.fields[0].layout.kind, "object");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.boxUInt32Bump", {
  value: 41,
}), {
  value: 42,
});
const boxUInt64Entry = runtime.interfaceManifest.exports.find(
  (entry) => entry.entry === "Vir.Fixtures.InterfaceShapes.boxUInt64Bump",
);
assert.equal(boxUInt64Entry.args[0].type.type, "Vir.Fixtures.InterfaceShapes.Box UInt64");
assert.equal(boxUInt64Entry.args[0].type.trivialFieldIndex, 0);
assert.equal(boxUInt64Entry.args[0].type.fields[0].type.wireTag, 7);
assert.equal(boxUInt64Entry.args[0].type.fields[0].layout.kind, "object");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.boxUInt64Bump", {
  value: "18446744073709551615",
}), {
  value: "0",
});
const uint32BoxEntry = runtime.interfaceManifest.exports.find(
  (entry) => entry.entry === "Vir.Fixtures.InterfaceShapes.uint32BoxBump",
);
assert.equal(uint32BoxEntry.args[0].type.type, "Vir.Fixtures.InterfaceShapes.UInt32Box");
assert.equal(uint32BoxEntry.args[0].type.trivialFieldIndex, 0);
assert.equal(uint32BoxEntry.args[0].type.fields[0].type.wireTag, 6);
assert.equal(uint32BoxEntry.args[0].type.fields[0].layout.kind, "scalar");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.uint32BoxBump", {
  value: 41,
}), {
  value: 42,
});
const uint64BoxEntry = runtime.interfaceManifest.exports.find(
  (entry) => entry.entry === "Vir.Fixtures.InterfaceShapes.uint64BoxBump",
);
assert.equal(uint64BoxEntry.args[0].type.type, "Vir.Fixtures.InterfaceShapes.UInt64Box");
assert.equal(uint64BoxEntry.args[0].type.trivialFieldIndex, 0);
assert.equal(uint64BoxEntry.args[0].type.fields[0].type.wireTag, 7);
assert.equal(uint64BoxEntry.args[0].type.fields[0].layout.kind, "scalar");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.uint64BoxBump", {
  value: "18446744073709551615",
}), {
  value: "0",
});
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.nestedBoxNatBump", {
  value: { value: 4 },
}), {
  value: { value: "5" },
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.taggedArrayScore", {
  label: "ab",
  payload: ["x", "yz"],
}), "5");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.taggedProfileBump", {
  label: "profile",
  payload: {
    nickname: "lean",
    points: 4,
    tags: ["ir", "wasm"],
  },
}), {
  label: "profile!",
  payload: {
    nickname: "lean!",
    points: "6",
    tags: ["ir", "wasm"],
  },
});
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.meteredBoxBump", {
  active: false,
  count: 3,
  payload: { value: 4 },
}), {
  active: true,
  count: 4,
  payload: { value: "7" },
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.boxExprKindScore", {
  value: { kind: "const", name: "Nat", levels: [] },
}), "10");
const extendedProfileInput = {
  nickname: "lean",
  active: true,
  visits: 5,
  score: 7,
  tags: ["ir"],
};
const extendedProfileEntry = runtime.interfaceManifest.exports.find(
  (entry) => entry.entry === "Vir.Fixtures.InterfaceShapes.extendedProfileBump",
);
assert.deepEqual(
  extendedProfileEntry.args[0].type.fields.map((field) => [field.name, field.subobject === true]),
  [["toProfileBase", true], ["score", false], ["tags", false]],
);
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.extendedProfileBump", extendedProfileInput), {
  nickname: "lean!",
  active: false,
  visits: 6,
  score: "8",
  tags: ["ir", "extended"],
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.extendedProfileScore", extendedProfileInput), "118");
assert.throws(
  () => runtime.call("Vir.Fixtures.InterfaceShapes.extendedProfileScore", {
    toProfileBase: { nickname: "nested", active: true, visits: 1 },
    ...extendedProfileInput,
  }),
  /mixes toProfileBase with flattened inherited fields/,
);
assert.throws(
  () => runtime.call("Vir.Fixtures.InterfaceShapes.profileScore", {
    nickname: "lean",
    points: 4,
  }),
  /profileScore argument profile is missing field tags/,
);

const factory = createVirRuntimeFactory({ wasmBytes });
const unloaded = await factory.createRuntime();
assert.equal(unloaded.packageInfo, null);
assert.equal(unloaded.packageDeclCount(), 0);
assert.throws(
  () => unloaded.call("fib", 8),
  /interface entry not found: fib/,
);
const first = await factory.createRuntime({ irPackageBytes });
const second = await factory.createRuntime({ irPackageBytes });
assert.equal(first.call("SortDemo.demo"), "192");
assert.equal(second.call("fib", 8), "21");

const badPackageRuntime = await factory.createRuntime();
const badPackage = Uint8Array.from([
  3, 0, 0, 0, 98, 97, 100,
  1, 0, 0, 0,
  0, 0, 0, 0,
]);
assert.throws(
  () => badPackageRuntime.loadIrPackageBytes(badPackage),
  /invalid IR package magic/,
);
assert.equal(badPackageRuntime.packageInfo, null);
assert.equal(badPackageRuntime.interfaceManifest, null);
assert.equal(badPackageRuntime.packageMetadata, null);
assert.equal(badPackageRuntime.packageDeclCount(), 0);

assert.throws(
  () => first.loadIrPackageBytes(badPackage),
  /invalid IR package magic/,
);
assert.equal(first.packageInfo, null);
assert.equal(first.interfaceManifest, null);
assert.equal(first.packageMetadata, null);
assert.equal(first.packageDeclCount(), 0);
assert.throws(
  () => first.call("fib", 8),
  /interface entry not found: fib/,
);

assert.throws(
  () => runtime.call("fib", -1),
  /fib argument arg1 must be non-negative/,
);

const freshDir = await mkdtemp(join(tmpdir(), "lean-vir-fresh-"));
try {
  const freshSource = join(freshDir, "FreshUser.lean");
  const freshPackage = join(freshDir, "fresh.irpkg");
  await writeFile(freshSource, [
    "inductive FreshMode where",
    "  | cold",
    "  | hot",
    "",
    "structure FreshBox where",
    "  label : String",
    "  value : Nat",
    "  enabled : Bool",
    "  hits : UInt32",
    "  quota : USize",
    "  mode : FreshMode",
    "",
    "structure FreshWrap (α : Type) where",
    "  label : String",
    "  payload : α",
    "",
    "structure FreshScalarBox where",
    "  value : UInt32",
    "",
    "structure FreshUInt64Box where",
    "  value : UInt64",
    "",
    "def freshBump (n : Nat) : Nat := n + 7",
    "def freshSum (xs : Array Nat) : Nat := xs.foldl (fun acc n => acc + n) 0",
    "def freshPairSum (p : Nat × Nat) : Nat := p.fst + p.snd",
    "def freshUInt64Bump (n : UInt64) : UInt64 := n + 1",
    "def freshFloatScale (n : Float) : Float := Float.scaleB n (1 : Int)",
    "def freshFloat32Roundtrip (n : Float32) : Float32 := n",
    "def freshClassifySum (n : Nat) : Sum Nat String :=",
    "  if n < 3 then .inl (n + 10) else .inr (toString n)",
    "",
    "def freshSumScore : Sum Nat String → Nat",
    "  | .inl n => n",
    "  | .inr text => text.length + 20",
    "",
    "def freshClassifyExcept (n : Nat) : Except String Nat :=",
    "  if n = 0 then .error \"zero\" else .ok (n + 1)",
    "",
    "def freshBoxBump (box : FreshBox) : FreshBox :=",
    "  { box with",
    "    value := box.value + box.label.length",
    "    enabled := !box.enabled",
    "    hits := box.hits + 1",
    "    quota := box.quota + 2",
    "    mode := .hot }",
    "",
    "def freshWrapBoxBump (wrap : FreshWrap FreshBox) : FreshWrap FreshBox :=",
    "  { label := wrap.label ++ \"!\", payload := freshBoxBump wrap.payload }",
    "",
    "def freshWrapUInt32Bump (wrap : FreshWrap UInt32) : FreshWrap UInt32 :=",
    "  { label := wrap.label ++ \"!\", payload := wrap.payload + 1 }",
    "",
    "def freshScalarBoxBump (box : FreshScalarBox) : FreshScalarBox :=",
    "  { value := box.value + 1 }",
    "",
    "def freshUInt64BoxBump (box : FreshUInt64Box) : FreshUInt64Box :=",
    "  { value := box.value + 1 }",
    "",
  ].join("\n"));

  const generated = spawnSync(
    "bash",
    ["scripts/lean-to-irpkg.sh", freshSource, freshPackage],
    { encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  assert.match(generated.stdout, /mode:\s+auto-discover public definitions/);
  assert.match(generated.stdout, /local package ready/);

  const freshRuntime = await factory.createRuntime({ irPackageBytes: await readFile(freshPackage) });
  const freshManifest = freshRuntime.interfaceManifest;
  assert.equal(freshManifest.metadata.packageFormatVersion, 5);
  assert.equal(freshManifest.metadata.manifestVersion, 1);
  assert.match(freshManifest.metadata.leanToolchain, /leanprover\/lean4/);
  assert.ok(freshManifest.metadata.generatedAt.length > 0);
  assert.equal(freshManifest.metadata.targets.length, 1);
  assert.equal(freshManifest.metadata.targets[0].source, freshSource);
  assert.equal(freshManifest.metadata.targets[0].mode, "all");
  assert.deepEqual(freshManifest.metadata.targets[0].roots, []);
  assert.ok(freshManifest.metadata.targets[0].resolvedRoots.includes("freshBump"));
  assertManifestTypeDescriptorsRoundTrip(freshManifest);

  const freshEntries = freshManifest.exports.map((entry) => entry.entry).sort();
  assert.deepEqual(freshEntries, [
    "freshBoxBump",
    "freshBump",
    "freshClassifyExcept",
    "freshClassifySum",
    "freshFloat32Roundtrip",
    "freshFloatScale",
    "freshPairSum",
    "freshScalarBoxBump",
    "freshSum",
    "freshSumScore",
    "freshUInt64BoxBump",
    "freshUInt64Bump",
    "freshWrapBoxBump",
    "freshWrapUInt32Bump",
  ]);
  assert.ok(freshManifest.metadata.targets[0].resolvedRoots.includes("freshUInt64Bump._boxed"));
  assert.ok(freshManifest.metadata.targets[0].resolvedRoots.includes("freshFloatScale._boxed"));
  const freshInspect = spawnSync("node", ["scripts/inspect-irpkg.mjs", "--json", freshPackage], {
    encoding: "utf8",
  });
  assert.equal(freshInspect.status, 0, freshInspect.stderr || freshInspect.stdout);
  const freshInfo = JSON.parse(freshInspect.stdout);
  assert.equal(freshInfo.manifest.metadata.targets[0].source, freshSource);
  assert.deepEqual(freshInfo.manifest.exports.map((entry) => entry.entry).sort(), freshEntries);
  assert.equal(freshRuntime.call("freshBump", 35), "42");
  assert.equal(freshRuntime.exportsByName.freshBump(1), "8");
  assert.equal(freshRuntime.call("freshSum", [4, 5, 6]), "15");
  assert.equal(freshRuntime.call("freshPairSum", { fst: 7, snd: 8 }), "15");
  assert.equal(freshRuntime.call("freshUInt64Bump", "18446744073709551615"), "0");
  assert.equal(freshRuntime.call("freshFloatScale", 2.5), 5);
  assert.equal(freshRuntime.call("freshFloat32Roundtrip", 1.25), 1.25);
  assert.deepEqual(freshRuntime.call("freshClassifySum", 2), {
    kind: "inl",
    value: "12",
  });
  assert.deepEqual(freshRuntime.call("freshClassifySum", 5), {
    kind: "inr",
    value: "5",
  });
  assert.equal(freshRuntime.call("freshSumScore", { kind: "inr", value: "lean" }), "24");
  assert.deepEqual(freshRuntime.call("freshClassifyExcept", 0), {
    kind: "error",
    value: "zero",
  });
  assert.deepEqual(freshRuntime.call("freshClassifyExcept", 6), {
    kind: "ok",
    value: "7",
  });
  assert.deepEqual(freshRuntime.call("freshBoxBump", {
    label: "abc",
    value: 4,
    enabled: false,
    hits: 7,
    quota: 8,
    mode: "cold",
  }), {
    label: "abc",
    value: "7",
    enabled: true,
    hits: 8,
    quota: "10",
    mode: "hot",
  });
  const freshWrapUInt32Entry = freshManifest.exports.find((entry) => entry.entry === "freshWrapUInt32Bump");
  assert.equal(freshWrapUInt32Entry.args[0].type.type, "FreshWrap UInt32");
  assert.equal(freshWrapUInt32Entry.args[0].type.fields[1].type.wireTag, 6);
  assert.equal(freshWrapUInt32Entry.args[0].type.fields[1].layout.kind, "object");
  assert.deepEqual(freshRuntime.call("freshWrapUInt32Bump", {
    label: "u",
    payload: 9,
  }), {
    label: "u!",
    payload: 10,
  });
  const freshScalarBoxEntry = freshManifest.exports.find((entry) => entry.entry === "freshScalarBoxBump");
  assert.equal(freshScalarBoxEntry.args[0].type.trivialFieldIndex, 0);
  assert.equal(freshScalarBoxEntry.args[0].type.fields[0].layout.kind, "scalar");
  assert.deepEqual(freshRuntime.call("freshScalarBoxBump", {
    value: 9,
  }), {
    value: 10,
  });
  const freshUInt64BoxEntry = freshManifest.exports.find((entry) => entry.entry === "freshUInt64BoxBump");
  assert.equal(freshUInt64BoxEntry.args[0].type.trivialFieldIndex, 0);
  assert.equal(freshUInt64BoxEntry.args[0].type.fields[0].type.wireTag, 7);
  assert.equal(freshUInt64BoxEntry.args[0].type.fields[0].layout.kind, "scalar");
  assert.deepEqual(freshRuntime.call("freshUInt64BoxBump", {
    value: "18446744073709551615",
  }), {
    value: "0",
  });
  assert.deepEqual(freshRuntime.call("freshWrapBoxBump", {
    label: "box",
    payload: {
      label: "abc",
      value: 4,
      enabled: false,
      hits: 7,
      quota: 8,
      mode: "cold",
    },
  }), {
    label: "box!",
    payload: {
      label: "abc",
      value: "7",
      enabled: true,
      hits: 8,
      quota: "10",
      mode: "hot",
    },
  });

  await assertUnsupportedInterfaceSource(freshDir, "UnsupportedInterfaces", [
    "structure RecursiveBox where",
    "  next : Option RecursiveBox",
    "",
    "inductive IndexedBox : Nat → Type where",
    "  | mk {n : Nat} (value : Nat) : IndexedBox n",
    "",
    "def recursiveBoxIdentity (box : RecursiveBox) : RecursiveBox := box",
    "def indexedBoxIdentity (box : IndexedBox 3) : IndexedBox 3 := box",
    "def implicitBump {offset : Nat} (n : Nat) : Nat := n + offset",
    "",
  ], [
    /recursiveBoxIdentity/,
    /recursive structure `RecursiveBox` is not supported/,
    /indexedBoxIdentity/,
    /unsupported type `IndexedBox/,
    /implicitBump/,
    /unsupported implicit\/instance argument `offset`/,
  ]);

  const hostSource = join(freshDir, "FreshHost.lean");
  const hostPackage = join(freshDir, "host.irpkg");
  await writeFile(hostSource, [
    "import Lean.Vir.Browser",
    "",
    "def freshEchoBang (s : String) : String :=",
    "  Lean.Vir.Common.echoString (s ++ \"!\")",
    "",
    "def freshTitleRoundtrip (s : String) : IO String := do",
    "  Lean.Vir.Browser.Document.setTitle s",
    "  Lean.Vir.Browser.Document.getTitle",
    "",
    "def freshElementRoundtrip (s : String) : IO (String × Option String) := do",
    "  match ← Lean.Vir.Browser.Document.querySelector \"#fresh\" with",
    "  | none => pure (\"\", none)",
    "  | some fresh =>",
    "      Lean.Vir.Browser.Element.setTextContent fresh s",
    "      Lean.Vir.Browser.Element.setAttribute fresh \"data-fresh\" (s ++ \"!\")",
    "      let text ← Lean.Vir.Browser.Element.getTextContent fresh",
    "      let attr ← Lean.Vir.Browser.Element.getAttribute fresh \"data-fresh\"",
    "      pure (text, attr)",
    "",
  ].join("\n"));

  const hostGenerated = spawnSync(
    "bash",
    ["scripts/lean-to-irpkg.sh", hostSource, hostPackage],
    { encoding: "utf8" },
  );
  assert.equal(hostGenerated.status, 0, hostGenerated.stderr || hostGenerated.stdout);
  const hostRuntime = await factory.createRuntime({ irPackageBytes: await readFile(hostPackage) });
  assert.equal(hostRuntime.interfaceManifest.hostImports.length, 8);
  assert.equal(hostRuntime.call("freshEchoBang", "ok"), "ok!");
  assert.equal(hostRuntime.call("freshTitleRoundtrip", "Lean.Vir"), "Lean.Vir");
  assert.deepEqual(hostRuntime.call("freshElementRoundtrip", "element"), {
    fst: "element",
    snd: "element!",
  });

  const customHostSource = join(freshDir, "FreshCustomHost.lean");
  const customHostPackage = join(freshDir, "custom-host.irpkg");
  await writeFile(customHostSource, [
    "import Lean.Vir.Host",
    "",
    "structure HostCounter where",
    "  label : String",
    "  value : Nat",
    "  enabled : Bool",
    "deriving Inhabited",
    "",
    "@[vir_js \"test.bumpNat\"]",
    "opaque jsBumpNat (n : Nat) : Nat",
    "",
    "@[vir_js \"test.bumpCounter\"]",
    "opaque jsBumpCounter (counter : HostCounter) : HostCounter",
    "",
    "def freshCustomBump (n : Nat) : Nat :=",
    "  jsBumpNat n",
    "",
    "def freshCustomCounter (counter : HostCounter) : HostCounter :=",
    "  jsBumpCounter counter",
    "",
  ].join("\n"));
  const customGenerated = spawnSync(
    "bash",
    ["scripts/lean-to-irpkg.sh", customHostSource, customHostPackage],
    { encoding: "utf8" },
  );
  assert.equal(customGenerated.status, 0, customGenerated.stderr || customGenerated.stdout);
  const customFactory = createVirRuntimeFactory({
    wasmBytes,
    hostBindings: {
      "test.bumpCounter": (counter) => ({
        label: `${counter.label}!`,
        value: (BigInt(counter.value) + 1n).toString(),
        enabled: !counter.enabled,
      }),
      "test.bumpNat": (n) => (BigInt(n) + 1n).toString(),
    },
  });
  const customRuntime = await customFactory.createRuntime({ irPackageBytes: await readFile(customHostPackage) });
  assert.deepEqual(customRuntime.interfaceManifest.hostImports.map((entry) => entry.target).sort(), [
    "test.bumpCounter",
    "test.bumpNat",
  ]);
  assert.equal(customRuntime.call("freshCustomBump", 41), "42");
  assert.deepEqual(customRuntime.call("freshCustomCounter", {
    label: "count",
    value: 4,
    enabled: true,
  }), {
    label: "count!",
    value: "5",
    enabled: false,
  });

  const objectImportFactory = createVirRuntimeFactory({
    wasmBytes,
    imports: {},
    hostBindings: {
      "test.bumpCounter": (counter) => counter,
      "test.bumpNat": (n) => (BigInt(n) + 2n).toString(),
    },
  });
  const objectImportRuntime = await objectImportFactory.createRuntime({ irPackageBytes: await readFile(customHostPackage) });
  assert.equal(objectImportRuntime.call("freshCustomBump", 40), "42");
} finally {
  await rm(freshDir, { recursive: true, force: true });
}

console.log(
  `vir runtime smoke ok: ${runtime.packageInfo.count} declarations, SortDemo.demo = 192, fib 12 = 144`,
);
