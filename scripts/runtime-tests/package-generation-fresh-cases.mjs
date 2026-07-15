/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";
import { PACKAGE_FORMAT_VERSION, INTERFACE_MANIFEST_VERSION } from "../package-versions.mjs";
import {
  assert,
  assertManifestTypeDescriptorsRoundTrip,
  generateIrPackage,
  join,
  manifestEntry,
  readFile,
  runVirIrpkg,
  spawnSync,
  writeRuntimeFixture,
} from "./shared.mjs";

export async function runFreshPackageSmoke({ freshDir, wasmBytes }) {
  const factory = createVirRuntimeFactory({ wasmBytes });
  const freshSource = join(freshDir, "FreshUser.lean");
  const freshPackage = join(freshDir, "fresh.irpkg");
  await writeRuntimeFixture(freshSource, "FreshUser.lean");

  const generated = generateIrPackage(freshSource, freshPackage);
  assert.match(generated.stdout, /mode:\s+auto-discover public definitions/);
  assert.match(generated.stdout, /local package ready/);

  const freshRuntime = await factory.createRuntime({ irPackageBytes: await readFile(freshPackage) });
  const freshManifest = freshRuntime.interfaceManifest;
  assert.equal(freshManifest.metadata.packageFormatVersion, PACKAGE_FORMAT_VERSION);
  assert.equal(freshManifest.metadata.manifestVersion, INTERFACE_MANIFEST_VERSION);
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
    "freshAliasBump",
    "freshBoxBump",
    "freshBump",
    "freshChainDepth",
    "freshChainIdentity",
    "freshChainLabelScore",
    "freshChainPush",
    "freshChainScore",
    "freshClassifyExcept",
    "freshClassifySum",
    "freshFloat32Roundtrip",
    "freshFloatScale",
    "freshJsonWeight",
    "freshJsonWrap",
    "freshPairSum",
    "freshScalarBoxBump",
    "freshSum",
    "freshSumScore",
    "freshTermSize",
    "freshTermWrap",
    "freshTreeIdentity",
    "freshTreeRootScore",
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

  const aliasSource = join(freshDir, "AliasEdges.lean");
  const aliasPackage = join(freshDir, "alias-edges.irpkg");
  const aliasReport = join(freshDir, "alias-edges.report.md");
  await writeRuntimeFixture(aliasSource, "AliasEdges.lean");
  const aliasGenerated = runVirIrpkg([aliasPackage, aliasReport, "--target-all", aliasSource]);
  assert.equal(aliasGenerated.status, 0, aliasGenerated.stderr || aliasGenerated.stdout);
  const aliasInspect = spawnSync("node", ["scripts/inspect-irpkg.mjs", "--json", aliasPackage], {
    encoding: "utf8",
  });
  assert.equal(aliasInspect.status, 0, aliasInspect.stderr || aliasInspect.stdout);
  const aliasManifest = JSON.parse(aliasInspect.stdout).manifest;
  const aliasArrayEntry = manifestEntry(aliasManifest, "aliasArraySum");
  assert.equal(aliasArrayEntry.args[0].type.kind, "array");
  assert.equal(aliasArrayEntry.args[0].type.element.type, "Nat");
  assert.equal(aliasArrayEntry.result.type, "Nat");
  const aliasCallbackEntry = manifestEntry(aliasManifest, "aliasCallbackApply");
  assert.equal(aliasCallbackEntry.args[0].type.kind, "function");
  assert.equal(aliasCallbackEntry.args[0].type.args[0].type.type, "Nat");
  assert.equal(aliasCallbackEntry.args[0].type.result.type, "Nat");
  const aliasIoEntry = manifestEntry(aliasManifest, "aliasIoBump");
  assert.equal(aliasIoEntry.effect, "io");
  assert.equal(aliasIoEntry.result.type, "Nat");

  const escapedSource = join(freshDir, "EscapedCallNames.lean");
  const escapedPackage = join(freshDir, "escaped-call-names.irpkg");
  const escapedReport = join(freshDir, "escaped-call-names.report.md");
  await writeRuntimeFixture(escapedSource, "EscapedCallNames.lean");
  const escapedGenerated = runVirIrpkg([
    escapedPackage,
    escapedReport,
    "--target-all",
    escapedSource,
  ]);
  assert.equal(escapedGenerated.status, 0, escapedGenerated.stderr || escapedGenerated.stdout);
  const escapedRuntime = await factory.createRuntime({
    irPackageBytes: await readFile(escapedPackage),
  });
  const dottedEntry = manifestEntry(escapedRuntime.interfaceManifest, "«foo.bar»");
  assert.equal(dottedEntry.id, "_foo_bar_");
  assert.equal(dottedEntry.jsName, "_foo_bar_");
  assert.equal(escapedRuntime.call(dottedEntry.entry, 3), "4");
  assert.equal(escapedRuntime.call(dottedEntry.id, 4), "5");
  assert.equal(escapedRuntime.call(dottedEntry.jsName, 5), "6");
  assert.equal(escapedRuntime.exportsByName[dottedEntry.jsName](6), "7");
  const numericTextEntry = manifestEntry(escapedRuntime.interfaceManifest, "Numeric.«1»");
  assert.equal(escapedRuntime.call(numericTextEntry.entry, 7), "9");
  assert.equal(escapedRuntime.call(numericTextEntry.id, 8), "10");
  assert.equal(escapedRuntime.call(numericTextEntry.jsName, 9), "11");
  escapedRuntime.dispose();

  const freshAliasEntry = manifestEntry(freshManifest, "freshAliasBump");
  assert.equal(freshAliasEntry.args[0].type.type, "Nat");
  assert.equal(freshAliasEntry.result.type, "Nat");
  assert.equal(freshRuntime.call("freshAliasBump", 3), "12");
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

  const freshWrapUInt32Entry = manifestEntry(freshManifest, "freshWrapUInt32Bump");
  assert.equal(freshWrapUInt32Entry.args[0].type.type, "FreshWrap UInt32");
  assert.equal(freshWrapUInt32Entry.args[0].type.fields[1].type.interfaceTag, INTERFACE_TAG.UINT32);
  assert.equal(freshWrapUInt32Entry.args[0].type.fields[1].layout.kind, "object");
  assert.deepEqual(freshRuntime.call("freshWrapUInt32Bump", {
    label: "u",
    payload: 9,
  }), {
    label: "u!",
    payload: 10,
  });

  const freshScalarBoxEntry = manifestEntry(freshManifest, "freshScalarBoxBump");
  assert.equal(freshScalarBoxEntry.args[0].type.trivialFieldIndex, 0);
  assert.equal(freshScalarBoxEntry.args[0].type.fields[0].layout.kind, "scalar");
  assert.deepEqual(freshRuntime.call("freshScalarBoxBump", {
    value: 9,
  }), {
    value: 10,
  });

  const freshUInt64BoxEntry = manifestEntry(freshManifest, "freshUInt64BoxBump");
  assert.equal(freshUInt64BoxEntry.args[0].type.trivialFieldIndex, 0);
  assert.equal(freshUInt64BoxEntry.args[0].type.fields[0].type.interfaceTag, INTERFACE_TAG.UINT64);
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

  const freshChain = {
    label: "root",
    next: {
      label: "leaf",
      next: null,
    },
  };
  assert.deepEqual(freshRuntime.call("freshChainIdentity", freshChain), freshChain);
  assert.equal(freshRuntime.call("freshChainScore", freshChain), "208");
  assert.deepEqual(freshRuntime.call("freshChainPush", "new", freshChain), {
    label: "new",
    next: freshChain,
  });
  const freshChainEntry = manifestEntry(freshManifest, "freshChainIdentity");
  assert.equal(freshChainEntry.args[0].type.interfaceTag, INTERFACE_TAG.STRUCTURE);
  assert.equal(freshChainEntry.args[0].type.fields[1].type.interfaceTag, INTERFACE_TAG.OPTION);
  assert.equal(freshChainEntry.args[0].type.fields[1].type.element.interfaceTag, INTERFACE_TAG.RECURSIVE_SELF);
  assert.equal(freshChainEntry.args[0].type.fields[1].type.element.kind, "recursiveSelf");

  const freshTree = {
    kind: "node",
    value: [
      { kind: "leaf", value: 3 },
      {
        kind: "node",
        value: [
          { kind: "leaf", value: 5 },
          { kind: "leaf", value: 8 },
        ],
      },
    ],
  };
  assert.deepEqual(freshRuntime.call("freshTreeIdentity", freshTree), {
    kind: "node",
    value: [
      { kind: "leaf", value: "3" },
      {
        kind: "node",
        value: [
          { kind: "leaf", value: "5" },
          { kind: "leaf", value: "8" },
        ],
      },
    ],
  });
  assert.equal(freshRuntime.call("freshTreeRootScore", freshTree), "12");
  const freshTreeEntry = manifestEntry(freshManifest, "freshTreeIdentity");
  assert.equal(freshTreeEntry.args[0].type.interfaceTag, INTERFACE_TAG.CUSTOM_INDUCTIVE);
  assert.equal(freshTreeEntry.args[0].type.constructors[1].fields[0].type.element.interfaceTag, INTERFACE_TAG.RECURSIVE_SELF);
  assert.equal(freshTreeEntry.args[0].type.constructors[1].fields[0].type.element.kind, "recursiveSelf");

  const term = {
    kind: "app",
    fields: {
      fn: { kind: "lam", fields: { binder: "x", body: { kind: "var", value: "x" } } },
      arg: { kind: "var", value: "y" },
    },
  };
  assert.equal(freshRuntime.call("freshTermSize", term), "4");
  assert.deepEqual(freshRuntime.call("freshTermWrap", term), {
    kind: "lam",
    fields: {
      binder: "x",
      body: {
        kind: "app",
        fields: {
          fn: {
            kind: "app",
            fields: {
              fn: { kind: "lam", fields: { binder: "x", body: { kind: "var", value: "x" } } },
              arg: { kind: "var", value: "y" },
            },
          },
          arg: { kind: "var", value: "x" },
        },
      },
    },
  });
  assert.throws(() => freshRuntime.call("freshTermSize", {
    kind: "app",
    fn: { kind: "var", value: "x" },
    arg: { kind: "var", value: "y" },
  }), /expected \{ kind: "app", fields: \{ fn, arg \} \}/);

  assert.throws(() => freshRuntime.call("freshJsonWeight", "null"), /must be a custom inductive object; expected \{ kind: "null" \}/);
  assert.equal(freshRuntime.call("freshJsonWeight", { kind: "null" }), "1");
  assert.throws(() => freshRuntime.call("freshJsonWeight", { tag: 0 }), /must specify custom inductive kind; expected \{ kind: "null" \}/);
  assert.throws(() => freshRuntime.call("freshJsonWeight", { kind: "null", value: null }), /not supported for this custom inductive constructor shape; expected \{ kind: "null" \}/);
  assert.throws(() => freshRuntime.call("freshJsonWeight", { kind: "bool" }), /freshJsonWeight argument .*\.bool is missing value; expected \{ kind: "bool", value \}/);
  assert.equal(freshRuntime.call("freshJsonWeight", { kind: "bool", value: true }), "2");
  assert.equal(freshRuntime.call("freshJsonWeight", {
    kind: "array",
    value: [
      { kind: "null" },
      { kind: "nat", value: 4 },
    ],
  }), "12");
  assert.equal(freshRuntime.call("freshJsonWeight", {
    kind: "object",
    value: [
      { fst: "ok", snd: { kind: "bool", value: false } },
      { fst: "empty", snd: { kind: "null" } },
    ],
  }), "22");
  assert.deepEqual(freshRuntime.call("freshJsonWrap", { kind: "nat", value: 4 }), {
    kind: "array",
    value: [
      { kind: "nat", value: "4" },
      { kind: "null" },
    ],
  });
  const freshJsonEntry = manifestEntry(freshManifest, "freshJsonWeight");
  assert.equal(freshJsonEntry.args[0].type.interfaceTag, INTERFACE_TAG.CUSTOM_INDUCTIVE);
  assert.equal(freshJsonEntry.args[0].type.constructors[0].fields.length, 0);
  assert.equal(freshJsonEntry.args[0].type.constructors[3].fields[0].type.element.interfaceTag, INTERFACE_TAG.RECURSIVE_SELF);
  assert.equal(freshJsonEntry.args[0].type.constructors[3].fields[0].type.element.kind, "recursiveSelf");
  assert.equal(freshJsonEntry.args[0].type.constructors[4].fields[0].type.element.snd.interfaceTag, INTERFACE_TAG.RECURSIVE_SELF);
  assert.equal(freshJsonEntry.args[0].type.constructors[4].fields[0].type.element.snd.kind, "recursiveSelf");
}
