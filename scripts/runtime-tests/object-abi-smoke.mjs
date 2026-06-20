/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntime, createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { defaultPackageFile, publicArtifactPath } from "../browser-package-config.mjs";
import { PACKAGE_FORMAT_VERSION } from "../package-versions.mjs";
import {
  createHostResource,
  ExternrefResourceRoots,
  releaseHostResource,
} from "../../web/src/host-resource.js";
import {
  createHostResourceState,
} from "../../web/src/host/vir-host-resources.js";
import { WIRE } from "../../web/src/runtime/wire-tags.js";
import { assert, manifestEntry, readRuntimeArtifacts, spawnSync } from "./shared.mjs";

const { wasmBytes, irPackageBytes, prettyPackageBytes, leanPackageBytes } = await readRuntimeArtifacts();
const defaultPackagePath = publicArtifactPath(defaultPackageFile);
const runtime = await createVirRuntime({ wasmBytes, irPackageBytes });
const prettyRuntime = await createVirRuntime({ wasmBytes, irPackageBytes: prettyPackageBytes });
const leanRuntime = await createVirRuntime({ wasmBytes, irPackageBytes: leanPackageBytes });
function makeObjectString(runtime, input) {
  const bytes = new TextEncoder().encode(input);
  const ptr = runtime.allocBytes(bytes);
  try {
    return runtime.exports.vir_obj_string(ptr, bytes.byteLength);
  } finally {
    runtime.freeBytes(ptr);
  }
}
function withObjectString(runtime, input, body) {
  let obj = makeObjectString(runtime, input);
  try {
    return body(obj);
  } finally {
    if (obj !== 0) {
      runtime.exports.vir_obj_dec(obj);
    }
  }
}

function withObjectByteArray(runtime, bytes, body) {
  const view = Uint8Array.from(bytes);
  const ptr = runtime.allocBytes(view);
  let obj = 0;
  try {
    obj = runtime.exports.vir_obj_byte_array(ptr, view.byteLength);
    return body(obj);
  } finally {
    runtime.freeBytes(ptr);
    if (obj !== 0) {
      runtime.exports.vir_obj_dec(obj);
    }
  }
}

function resolveEntrySlot(runtime, name) {
  const entry = runtime.findManifestEntry(name);
  assert.ok(entry, `missing manifest entry ${name}`);
  return runtime.resolveCallSlot(entry, runtime.callCacheFor(entry));
}

function callResolvedObjects(runtime, name, args) {
  const argvPtr = runtime.allocBytes(new Uint8Array(args.length * 4));
  try {
    const view = new DataView(runtime.exports.memory.buffer, argvPtr, args.length * 4);
    args.forEach((arg, index) => view.setUint32(index * 4, arg, true));
    const result = runtime.exports.vir_call_resolved_objects(
      resolveEntrySlot(runtime, name),
      argvPtr,
      args.length,
    );
    const error = runtime.lastCallError();
    if (error !== "") {
      throw new Error(error);
    }
    return result;
  } finally {
    runtime.freeBytes(argvPtr);
  }
}

function withCallLaneCounters(runtime, body) {
  const originalExports = runtime.exports;
  const counters = { objectCalls: 0, bytePayloadCalls: 0 };
  runtime.exports = Object.fromEntries(
    Reflect.ownKeys(originalExports).map((key) => [key, originalExports[key]]),
  );
  runtime.exports.vir_call_resolved_objects = (...args) => {
    counters.objectCalls++;
    return originalExports.vir_call_resolved_objects(...args);
  };
  runtime.exports.vir_call_resolved = (...args) => {
    counters.bytePayloadCalls++;
    throw new Error(`unexpected byte-payload call with ${args.length} arguments`);
  };
  try {
    body(counters);
    return counters;
  } finally {
    runtime.exports = originalExports;
  }
}

const resourceType = { type: "Resource", wireTag: WIRE.RESOURCE };
assert.equal(typeof runtime.exports.vir_call_resolved, "undefined");
assert.equal(typeof runtime.exports.vir_call_result_size, "undefined");
const resourceValue = { name: "resource" };
const resourceArg = createHostResource(resourceValue);
assert.deepEqual(Object.keys(resourceArg), []);
assert.equal(Object.hasOwn(resourceArg, "handle"), false);
assert.equal("handle" in resourceArg, false);
assert.equal(Object.hasOwn(resourceArg, "value"), false);
assert.equal("value" in resourceArg, false);
let resourceObj = runtime.makeObjectValue(resourceType, resourceArg, "resource argument");
try {
  assert.equal(runtime.liftObjectValue(resourceType, resourceObj, "resource result"), resourceArg);
} finally {
  runtime.exports.vir_obj_dec(resourceObj);
  resourceObj = 0;
}
assert.throws(() => runtime.makeObjectValue(resourceType, { handle: 1 }, "resource argument"), /resource argument must be a live host resource/);
releaseHostResource(resourceArg);
assert.throws(() => runtime.makeObjectValue(resourceType, resourceArg, "resource argument"), /resource argument must be a live host resource/);
const resourceStore = createHostResourceState();
const staleStoreResource = resourceStore.resourceForValue({ name: "stale" });
resourceStore.dispose();
assert.throws(
  () => runtime.makeObjectValue(resourceType, staleStoreResource, "resource argument"),
  /resource argument must be a live host resource/,
);
const roots = new ExternrefResourceRoots();
const firstRootResource = createHostResource({ name: "first" });
const firstRootId = roots.root(firstRootResource);
assert.equal(firstRootId, 1);
assert.equal(roots.get(firstRootId), firstRootResource);
roots.release(firstRootId);
assert.equal(roots.get(firstRootId), null);
const secondRootResource = createHostResource({ name: "second" });
const secondRootId = roots.root(secondRootResource);
assert.equal(secondRootId, firstRootId);
assert.equal(roots.get(secondRootId), secondRootResource);
roots.clear();
assert.equal(roots.get(secondRootId), null);
releaseHostResource(secondRootResource);
assert.equal(roots.root(secondRootResource), 0);
const inspected = spawnSync("node", ["scripts/inspect-irpkg.mjs", defaultPackagePath], {
  encoding: "utf8",
});
assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
assert.ok(inspected.stdout.includes(`package: ${defaultPackagePath}`));
assert.match(inspected.stdout, new RegExp(`exports: ${runtime.interfaceManifest.exports.length}`));
assert.match(inspected.stdout, /host imports: 0/);
assert.match(inspected.stdout, /fib\(arg1: Nat\) -> Nat \[fib\]/);
assert.match(inspected.stdout, /arg tree descriptor: customInductive Vir\.Fixtures\.RecursiveTypes\.Tree/);
assert.match(inspected.stdout, /branch\(left: recursiveSelf Vir\.Fixtures\.RecursiveTypes\.Tree, right: recursiveSelf Vir\.Fixtures\.RecursiveTypes\.Tree\)/);
assert.match(inspected.stdout, /arg chain descriptor: structure Vir\.Fixtures\.RecursiveTypes\.Chain/);
assert.match(inspected.stdout, /next: Option<recursiveSelf Vir\.Fixtures\.RecursiveTypes\.Chain>/);
assert.match(inspected.stdout, /arg json descriptor: customInductive Vir\.Fixtures\.RecursiveTypes\.MiniJson/);
assert.match(inspected.stdout, /array\(items: List<recursiveSelf Vir\.Fixtures\.RecursiveTypes\.MiniJson>\)/);

const inspectedJson = spawnSync("node", ["scripts/inspect-irpkg.mjs", "--json", defaultPackagePath], {
  encoding: "utf8",
});
assert.equal(inspectedJson.status, 0, inspectedJson.stderr || inspectedJson.stdout);
const inspectedInfo = JSON.parse(inspectedJson.stdout);
assert.equal(inspectedInfo.package.version, PACKAGE_FORMAT_VERSION);
assert.equal(inspectedInfo.package.declarationCount, runtime.packageInfo.count);
assert.equal(inspectedInfo.manifest.exports.length, runtime.interfaceManifest.exports.length);
assert.equal(inspectedInfo.manifest.hostImports.length, 0);
assert.equal(runtime.exportsByName.SortDemo_demo(), "192");
assert.equal(runtime.call("SortDemo.demo"), "192");
assert.equal(runtime.call("fib", 12), "144");
const stringCallResult = callResolvedObjects(runtime, "Vir.Fixtures.InterfaceShapes.baseStringRoundtrip", [
  makeObjectString(runtime, "object-call"),
]);
try {
  const len = runtime.exports.vir_obj_string_size(stringCallResult);
  const data = runtime.exports.vir_obj_string_data(stringCallResult);
  assert.equal(runtime.readWasmString(data, len), "object-call");
} finally {
  runtime.exports.vir_obj_dec(stringCallResult);
}
withObjectString(runtime, "Aé∀Z", (obj) => {
  runtime.exports.vir_obj_inc(obj);
  runtime.exports.vir_obj_dec(obj);
  const len = runtime.exports.vir_obj_string_size(obj);
  const data = runtime.exports.vir_obj_string_data(obj);
  assert.equal(runtime.readWasmString(data, len), "Aé∀Z");
});
withObjectByteArray(runtime, [0, 65, 255, 17], (obj) => {
  const len = runtime.exports.vir_obj_byte_array_size(obj);
  const data = runtime.exports.vir_obj_byte_array_data(obj);
  assert.deepEqual([...runtime.readWasmBytes(data, len)], [0, 65, 255, 17]);
});
const objectCounters = withCallLaneCounters(runtime, () => {
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseNatBump", 41), "42");
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseIntNegate", -41), "41");
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.uint64Bump", "18446744073709551615"), "0");
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseUSizeBump", "41"), "42");
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseArrayNatSum", [4, 5, 6]), "15");
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.arrayStringTotalLength", ["a", "bc"]), "3");
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.listUInt32Sum", [1, 2, 3]), "6");
  assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.arrayNatBumpAll", [4, 5]), ["5", "6"]);
  assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.listStringBangAll", ["a", "bc"]), ["a!", "bc!"]);
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionNatBump", { some: 41 }), "42");
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionStringBang", null), "empty");
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionArrayNatSum", [4, 5, 6]), "15");
  assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.prodNatNatSwap", { fst: 2, snd: 9 }), {
    fst: "9",
    snd: "2",
  });
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.prodNatNatSum", [4, 5]), "9");
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.listProdNatStringScore", [
    { fst: 4, snd: "ab" },
    [5, "c"],
  ]), "12");
  assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.prodStringNatSwap", { fst: "ok", snd: 6 }), {
    fst: "7",
    snd: "ok!",
  });
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.profileScore", {
    nickname: "lean",
    points: 4,
    tags: ["ir", "wasm"],
  }), "14");
  assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.profileBump", {
    nickname: "lean",
    points: 4,
    tags: ["ir", "wasm"],
  }), {
    nickname: "lean!",
    points: "6",
    tags: ["ir", "wasm"],
  });
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
  assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.profileStatsBump", {
    enabled: true,
    level: 2,
    score16: 30,
    visits: 400,
    quota: 5,
    checksum: 6000,
    tier: "pro",
    note: "ok",
  }), {
    enabled: false,
    level: 3,
    score16: 32,
    visits: 403,
    quota: "9",
    checksum: "6005",
    tier: "elite",
    note: "ok!",
  });
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.profileStatsScore", {
    enabled: true,
    level: 2,
    score16: 30,
    visits: 400,
    quota: 5,
    checksum: 6000,
    tier: "pro",
    note: "ok",
  }), "6549");
  assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.boxNatBump", { value: 41 }), {
    value: "42",
  });
  assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.uint32BoxBump", { value: 41 }), {
    value: 42,
  });
  assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.uint64BoxBump", {
    value: "18446744073709551615",
  }), {
    value: "0",
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
  assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.extendedProfileBump", {
    nickname: "lean",
    active: true,
    visits: 5,
    score: 7,
    tags: ["ir"],
  }), {
    nickname: "lean!",
    active: false,
    visits: 6,
    score: "8",
    tags: ["ir", "extended"],
  });
  assert.equal(runtime.call("Vir.Fixtures.RecursiveTypes.treeRootScore", {
    kind: "branch",
    fields: {
      left: { kind: "leaf", value: 4 },
      right: {
        kind: "branch",
        fields: {
          left: { kind: "leaf", value: 5 },
          right: { kind: "leaf", value: 6 },
        },
      },
    },
  }), "515");
  assert.equal(runtime.call("Vir.Fixtures.RecursiveTypes.chainRootScore", {
    label: "browser",
    next: {
      label: "leaf",
      next: null,
    },
  }), "211");
  assert.equal(runtime.call("Vir.Fixtures.RecursiveTypes.jsonRootScore", {
    kind: "object",
    value: [
      { fst: "flag", snd: { kind: "bool", value: true } },
      { fst: "empty", snd: { kind: "null" } },
    ],
  }), "22");
  assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifySum", 0), {
    kind: "inl",
    value: "10",
  });
  assert.equal(runtime.call("Vir.Fixtures.ListOption.sumScore", { kind: "inr", value: 7 }), "70");
  assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifyExcept", 5), {
    kind: "ok",
    value: {
      kind: "inr",
      value: "5",
    },
  });
  assert.deepEqual(
    runtime.call("Vir.Fixtures.InterfaceShapes.baseByteArrayRoundtrip", [65, 66, 67]),
    Uint8Array.from([65, 66, 67]),
  );
});
assert.equal(objectCounters.objectCalls, 36);
assert.equal(objectCounters.bytePayloadCalls, 0);

const prettyCounters = withCallLaneCounters(prettyRuntime, () => {
  assert.match(
    prettyRuntime.call("Vir.Fixtures.FormatPretty.formatPrettyPreview"),
    /^wide group:\nhello world/,
  );
  assert.match(
    prettyRuntime.call("Vir.Fixtures.FormatPretty.formatPrettyAtWidth", 8),
    /group:\nhello\nworld/,
  );
  assert.equal(
    prettyRuntime.call("Vir.Fixtures.FormatPretty.formatPrettyCaseAtWidth", "list", 12),
    "[alpha,\n beta,\n gamma]",
  );
});
assert.equal(prettyCounters.objectCalls, 3);
assert.equal(prettyCounters.bytePayloadCalls, 0);
assert.equal(runtime.call("SortDemo.demoFromArray", [4, 1, 3, 2]), "30");
assert.equal(runtime.call("Vir.Fixtures.Basic.stringUtf8RoundtripScore", "Aé∀Z"), "1381");
assert.equal(runtime.call("Vir.Fixtures.Basic.byteArrayInputScore", [65, 66, 67]), "136");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseStringRoundtrip", "Aé∀Z"), "Aé∀Z");
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
const exprObjectCounters = withCallLaneCounters(leanRuntime, () => {
  assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.constNatExpr"), {
    kind: "const",
    name: "Nat",
    levels: [],
  });
  assert.equal(
    leanRuntime.call("Vir.Fixtures.ExprPrinter.exprKindScore", { kind: "bvar", index: 4 }),
    "5",
  );
});
assert.equal(exprObjectCounters.objectCalls, 2);
assert.equal(exprObjectCounters.bytePayloadCalls, 0);
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
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseUnitRoundtrip", undefined), undefined);
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseBoolFlip", true), false);
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseNatBump", 41), "42");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseIntNegate", -41), "41");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseStringRoundtrip", "ok"), "ok");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseUInt8Bump", 41), 42);
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseUInt16Bump", 41), 42);
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.arrayStringTotalLength", ["a", "bc"]), "3");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseArrayNatSum", [4, 5, 6]), "15");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.listUInt32Sum", [1, 2, 3]), "6");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.arrayNatBumpAll", [4, 5]), ["5", "6"]);
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.listStringBangAll", ["a", "bc"]), ["a!", "bc!"]);
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.uint32Bump", 41), 42);
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.uint64Bump", "18446744073709551615"), "0");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseUSizeBump", "41"), "42");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.floatScale", 1.5), 6);
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.floatScore", 3.25), "4");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.float32Roundtrip", 1.25), 1.25);
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.baseByteArrayRoundtrip", [65, 66, 67]), Uint8Array.from([65, 66, 67]));
const floatScaleEntry = manifestEntry(runtime.interfaceManifest, "Vir.Fixtures.InterfaceShapes.floatScale");
assert.equal(floatScaleEntry.args[0].type.wireTag, WIRE.FLOAT);
assert.equal(floatScaleEntry.result.wireTag, WIRE.FLOAT);
const float32Entry = manifestEntry(runtime.interfaceManifest, "Vir.Fixtures.InterfaceShapes.float32Roundtrip");
assert.equal(float32Entry.args[0].type.wireTag, WIRE.FLOAT32);
assert.equal(float32Entry.result.wireTag, WIRE.FLOAT32);
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
const profileStatsEntry = manifestEntry(runtime.interfaceManifest, "Vir.Fixtures.InterfaceShapes.profileStatsBump");
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
const boxNatEntry = manifestEntry(runtime.interfaceManifest, "Vir.Fixtures.InterfaceShapes.boxNatBump");
assert.equal(boxNatEntry.args[0].type.type, "Vir.Fixtures.InterfaceShapes.Box Nat");
assert.equal(boxNatEntry.args[0].type.trivialFieldIndex, 0);
const boxUInt32Entry = manifestEntry(runtime.interfaceManifest, "Vir.Fixtures.InterfaceShapes.boxUInt32Bump");
assert.equal(boxUInt32Entry.args[0].type.type, "Vir.Fixtures.InterfaceShapes.Box UInt32");
assert.equal(boxUInt32Entry.args[0].type.trivialFieldIndex, 0);
assert.equal(boxUInt32Entry.args[0].type.fields[0].type.wireTag, WIRE.UINT32);
assert.equal(boxUInt32Entry.args[0].type.fields[0].layout.kind, "object");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.boxUInt32Bump", {
  value: 41,
}), {
  value: 42,
});
const boxUInt64Entry = manifestEntry(runtime.interfaceManifest, "Vir.Fixtures.InterfaceShapes.boxUInt64Bump");
assert.equal(boxUInt64Entry.args[0].type.type, "Vir.Fixtures.InterfaceShapes.Box UInt64");
assert.equal(boxUInt64Entry.args[0].type.trivialFieldIndex, 0);
assert.equal(boxUInt64Entry.args[0].type.fields[0].type.wireTag, WIRE.UINT64);
assert.equal(boxUInt64Entry.args[0].type.fields[0].layout.kind, "object");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.boxUInt64Bump", {
  value: "18446744073709551615",
}), {
  value: "0",
});
const uint32BoxEntry = manifestEntry(runtime.interfaceManifest, "Vir.Fixtures.InterfaceShapes.uint32BoxBump");
assert.equal(uint32BoxEntry.args[0].type.type, "Vir.Fixtures.InterfaceShapes.UInt32Box");
assert.equal(uint32BoxEntry.args[0].type.trivialFieldIndex, 0);
assert.equal(uint32BoxEntry.args[0].type.fields[0].type.wireTag, WIRE.UINT32);
assert.equal(uint32BoxEntry.args[0].type.fields[0].layout.kind, "scalar");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.uint32BoxBump", {
  value: 41,
}), {
  value: 42,
});
const uint64BoxEntry = manifestEntry(runtime.interfaceManifest, "Vir.Fixtures.InterfaceShapes.uint64BoxBump");
assert.equal(uint64BoxEntry.args[0].type.type, "Vir.Fixtures.InterfaceShapes.UInt64Box");
assert.equal(uint64BoxEntry.args[0].type.trivialFieldIndex, 0);
assert.equal(uint64BoxEntry.args[0].type.fields[0].type.wireTag, WIRE.UINT64);
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
const extendedProfileEntry = manifestEntry(runtime.interfaceManifest, "Vir.Fixtures.InterfaceShapes.extendedProfileBump");
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
first.dispose();
second.dispose();
badPackageRuntime.dispose();
unloaded.dispose();
runtime.dispose();
prettyRuntime.dispose();
leanRuntime.dispose();

console.log("vir runtime object ABI smoke ok");
