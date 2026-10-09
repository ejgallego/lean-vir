/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import {
  PACKAGE_FORMAT_VERSION,
  INTERFACE_MANIFEST_VERSION,
} from "../../scripts/packages/package-versions.mjs";
import {
  assert,
  generateIrPackage,
  join,
  manifestEntry,
  readFile,
  spawnSync,
  writeRuntimeFixture,
} from "./shared.mjs";

export async function runFreshPackageSmoke({ freshDir, wasmBytes }) {
  const factory = createVirRuntimeFactory({ wasmBytes });
  const freshSource = join(freshDir, "FreshUser.lean");
  const freshPackage = join(freshDir, "fresh.irpkg");
  await writeRuntimeFixture(freshSource, "FreshUser.lean");

  const generated = await generateIrPackage("FreshUser", freshSource, freshPackage);
  assert.match(generated.stdout, /\[all\]/);

  const freshRuntime = await factory.createRuntime({
    irPackageSet: [await readFile(freshPackage)],
  });
  const freshManifest = freshRuntime.interfaceManifest;
  assert.equal(
    freshManifest.metadata.packageFormatVersion,
    PACKAGE_FORMAT_VERSION,
  );
  assert.equal(
    freshManifest.metadata.manifestVersion,
    INTERFACE_MANIFEST_VERSION,
  );
  assert.match(freshManifest.metadata.leanToolchain, /leanprover\/lean4/);
  assert.equal(freshManifest.metadata.targets.length, 1);
  assert.equal(freshManifest.metadata.targets[0].module, "FreshUser");
  assert.equal(freshManifest.metadata.targets[0].source, undefined);
  assert.equal(freshManifest.metadata.targets[0].mode, "all");
  assert.deepEqual(freshManifest.metadata.targets[0].roots, []);
  assert.ok(
    freshManifest.metadata.targets[0].resolvedRoots.includes("freshBump"),
  );
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
  assert.ok(
    freshManifest.metadata.targets[0].resolvedRoots.includes(
      "freshUInt64Bump._boxed",
    ),
  );
  assert.ok(
    freshManifest.metadata.targets[0].resolvedRoots.includes(
      "freshFloatScale._boxed",
    ),
  );

  const freshInspect = spawnSync(
    "node",
    ["scripts/packages/inspect-irpkg.mjs", "--json", freshPackage],
    {
      encoding: "utf8",
    },
  );
  assert.equal(
    freshInspect.status,
    0,
    freshInspect.stderr || freshInspect.stdout,
  );
  const freshInfo = JSON.parse(freshInspect.stdout);
  assert.equal(freshInfo.manifest.metadata.targets[0].module, "FreshUser");
  assert.deepEqual(
    freshInfo.manifest.exports.map((entry) => entry.entry).sort(),
    freshEntries,
  );

  const aliasSource = join(freshDir, "AliasEdges.lean");
  const aliasPackage = join(freshDir, "alias-edges.irpkg");
  await writeRuntimeFixture(aliasSource, "AliasEdges.lean");
  await generateIrPackage("AliasEdges", aliasSource, aliasPackage);
  const aliasInspect = spawnSync(
    "node",
    ["scripts/packages/inspect-irpkg.mjs", "--json", aliasPackage],
    {
      encoding: "utf8",
    },
  );
  assert.equal(
    aliasInspect.status,
    0,
    aliasInspect.stderr || aliasInspect.stdout,
  );
  const aliasManifest = JSON.parse(aliasInspect.stdout).manifest;
  const aliasArrayEntry = manifestEntry(aliasManifest, "aliasArraySum");
  assert.equal(aliasArrayEntry.args[0].type.native.metadata.arrayElement.type.tag, "nat");
  assert.equal(aliasArrayEntry.args[0].type.value.tag, "sequence");
  assert.equal(aliasArrayEntry.result.native.type.tag, "nat");
  const aliasCallbackEntry = manifestEntry(aliasManifest, "aliasCallbackApply");
  assert.equal(aliasCallbackEntry.args[0].type.value.tag, "function");
  assert.equal(aliasCallbackEntry.args[0].type.native.metadata.signature.args[0].type.tag, "nat");
  assert.equal(aliasCallbackEntry.args[0].type.native.metadata.signature.result.type.tag, "nat");
  const aliasIoEntry = manifestEntry(aliasManifest, "aliasIoBump");
  assert.equal(aliasIoEntry.effect, "io");
  assert.equal(aliasIoEntry.result.native.type.tag, "nat");

  const duplicateSource = join(freshDir, "DuplicateExportNames.lean");
  const duplicatePackage = join(freshDir, "duplicate-entry-names.irpkg");
  await writeRuntimeFixture(duplicateSource, "DuplicateExportNames.lean");
  await generateIrPackage("DuplicateExportNames", duplicateSource, duplicatePackage);
  const duplicateRuntime = await factory.createRuntime({ irPackageSet: [await readFile(duplicatePackage)] });
  try {
    assert.deepEqual(new Set(duplicateRuntime.interfaceManifest.exports.map(entry => entry.entry)), new Set(["Duplicate.entry", "Duplicate_entry"]));
    assert.equal(duplicateRuntime.call("Duplicate.entry", 10), 11n);
    assert.equal(duplicateRuntime.call("Duplicate_entry", 10), 12n);
    assert.equal("exportsByName" in duplicateRuntime, false);
    assert.throws(() => duplicateRuntime.call("entry", 10), /interface entry not found/);
    assert.throws(() => duplicateRuntime.call("Duplicate__entry", 10), /interface entry not found/);
  } finally { duplicateRuntime.dispose(); }

  const escapedSource = join(freshDir, "EscapedCallNames.lean");
  const escapedPackage = join(freshDir, "escaped-call-names.irpkg");
  await writeRuntimeFixture(escapedSource, "EscapedCallNames.lean");
  await generateIrPackage("EscapedCallNames", escapedSource, escapedPackage, "marked");
  const escapedRuntime = await factory.createRuntime({
    irPackageSet: [await readFile(escapedPackage)],
  });
  const dottedEntry = manifestEntry(
    escapedRuntime.interfaceManifest,
    "«foo.bar»",
  );
  assert.equal(Object.hasOwn(dottedEntry, "id"), false);
  assert.equal(Object.hasOwn(dottedEntry, "jsName"), false);
  assert.equal(escapedRuntime.call(dottedEntry.entry, 3), 4n);
  assert.throws(() => escapedRuntime.call("_foo_bar_", 4), /interface entry not found/);
  assert.equal("exportsByName" in escapedRuntime, false);
  const numericTextEntry = manifestEntry(
    escapedRuntime.interfaceManifest,
    "Numeric.«1»",
  );
  assert.equal(escapedRuntime.call(numericTextEntry.entry, 7), 9n);
  assert.throws(() => escapedRuntime.call("Numeric__1_", 8), /interface entry not found/);
  for (const [entry, increment] of [
    ["café", 3],
    ["αβ₁", 4],
    ["#meta.part.with.dot", 5],
    ["?mvar.part.with.dot", 6],
    ["Inaccessible.part.with.dot✝", 7],
    ["Hygienic.part.with.dot._hyg", 2],
    ["Nested.«?part»", 9],
    ["Empty.«»", 2],
    ["Closing.»", 2],
    ["Numeral.1", 2],
    ["Hygienic.numeric.part._hyg.2", 2],
    ["Inaccessible.numeric.part✝.3", 2],
  ]) {
    assert.equal(escapedRuntime.call(entry, 10), BigInt(10 + increment), entry);
  }
  escapedRuntime.dispose();

  const freshAliasEntry = manifestEntry(freshManifest, "freshAliasBump");
  assert.equal(freshAliasEntry.args[0].type.native.type.tag, "nat");
  assert.equal(freshAliasEntry.result.native.type.tag, "nat");
  assert.equal(freshRuntime.call("freshAliasBump", 3), 12n);
  assert.equal(freshRuntime.call("freshBump", 35), 42n);
  assert.equal(freshRuntime.call("freshBump", 1), 8n);
  assert.equal(freshRuntime.call("freshSum", [4, 5, 6]), 15n);
  assert.equal(freshRuntime.call("freshPairSum", { fst: 7, snd: 8 }), 15n);
  assert.equal(
    freshRuntime.call("freshUInt64Bump", "18446744073709551615"),
    0n,
  );
  assert.equal(freshRuntime.call("freshFloatScale", 2.5), 5);
  assert.equal(freshRuntime.call("freshFloat32Roundtrip", 1.25), 1.25);
  assert.deepEqual(freshRuntime.call("freshClassifySum", 2), {
    kind: "inl",
    value: 12n,
  });
  assert.deepEqual(freshRuntime.call("freshClassifySum", 5), {
    kind: "inr",
    value: "5",
  });
  assert.equal(
    freshRuntime.call("freshSumScore", { kind: "inr", value: "lean" }),
    24n,
  );
  assert.deepEqual(freshRuntime.call("freshClassifyExcept", 0), {
    kind: "error",
    value: "zero",
  });
  assert.deepEqual(freshRuntime.call("freshClassifyExcept", 6), {
    kind: "ok",
    value: 7n,
  });
  assert.deepEqual(
    freshRuntime.call("freshBoxBump", {
      label: "abc",
      value: 4,
      enabled: false,
      hits: 7,
      quota: 8,
      mode: "cold",
    }),
    {
      label: "abc",
      value: 7n,
      enabled: true,
      hits: 8,
      quota: 10,
      mode: "hot",
    },
  );

  const freshWrapUInt32Entry = manifestEntry(
    freshManifest,
    "freshWrapUInt32Bump",
  );
  assert.equal(freshWrapUInt32Entry.args[0].type.native.metadata.declaration, "FreshWrap");
  const freshWrapUInt32Ctor = freshWrapUInt32Entry.args[0].type.native.metadata.constructors[0];
  assert.deepEqual(freshWrapUInt32Ctor.fields[1].type.type, { tag: "unsigned", width: 32 });
  assert.equal(freshWrapUInt32Ctor.fields[1].location.tag, "object");
  assert.deepEqual(
    freshRuntime.call("freshWrapUInt32Bump", {
      label: "u",
      payload: 9,
    }),
    {
      label: "u!",
      payload: 10,
    },
  );

  const freshScalarBoxEntry = manifestEntry(
    freshManifest,
    "freshScalarBoxBump",
  );
  const freshScalarBoxCtor = freshScalarBoxEntry.args[0].type.native.metadata.constructors[0];
  assert.equal(freshScalarBoxCtor.representation, "identity");
  assert.deepEqual(freshScalarBoxCtor.fields[0].type.type, { tag: "unsigned", width: 32 });
  assert.deepEqual(
    freshRuntime.call("freshScalarBoxBump", {
      value: 9,
    }),
    {
      value: 10,
    },
  );

  const freshUInt64BoxEntry = manifestEntry(
    freshManifest,
    "freshUInt64BoxBump",
  );
  const freshUInt64BoxCtor = freshUInt64BoxEntry.args[0].type.native.metadata.constructors[0];
  assert.equal(freshUInt64BoxCtor.representation, "identity");
  assert.deepEqual(freshUInt64BoxCtor.fields[0].type.type, { tag: "unsigned", width: 64 });
  assert.deepEqual(
    freshRuntime.call("freshUInt64BoxBump", {
      value: "18446744073709551615",
    }),
    {
      value: 0n,
    },
  );

  assert.deepEqual(
    freshRuntime.call("freshWrapBoxBump", {
      label: "box",
      payload: {
        label: "abc",
        value: 4,
        enabled: false,
        hits: 7,
        quota: 8,
        mode: "cold",
      },
    }),
    {
      label: "box!",
      payload: {
        label: "abc",
        value: 7n,
        enabled: true,
        hits: 8,
        quota: 10,
        mode: "hot",
      },
    },
  );

  const freshChain = {
    label: "root",
    next: {
      kind: "some",
      value: { label: "leaf", next: { kind: "none" } },
    },
  };
  assert.deepEqual(
    freshRuntime.call("freshChainIdentity", freshChain),
    freshChain,
  );
  assert.equal(freshRuntime.call("freshChainScore", freshChain), 208n);
  assert.deepEqual(freshRuntime.call("freshChainPush", "new", freshChain), {
    label: "new",
    next: { kind: "some", value: freshChain },
  });
  const freshChainEntry = manifestEntry(freshManifest, "freshChainIdentity");
  const freshChainFields = freshChainEntry.args[0].type.native.metadata.constructors[0].fields;
  const freshChainOption = freshChainFields[1].type;
  assert.equal(freshChainOption.type.tag, "leanObject");
  assert.deepEqual(freshChainOption.metadata.constructors[1].fields[0].type, { ref: 1 });

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
      { kind: "leaf", value: 3n },
      {
        kind: "node",
        value: [
          { kind: "leaf", value: 5n },
          { kind: "leaf", value: 8n },
        ],
      },
    ],
  });
  assert.equal(freshRuntime.call("freshTreeRootScore", freshTree), 12n);
  const freshTreeEntry = manifestEntry(freshManifest, "freshTreeIdentity");
  const freshTreeNodeFields = freshTreeEntry.args[0].type.native.metadata.constructors[1].fields;
  const freshTreeList = freshTreeNodeFields[0].type;
  assert.deepEqual(freshTreeList.metadata.constructors[1].fields[0].type, { ref: 1 });

  const term = {
    kind: "app",
    fields: {
      fn: {
        kind: "lam",
        fields: { binder: "x", body: { kind: "var", value: "x" } },
      },
      arg: { kind: "var", value: "y" },
    },
  };
  assert.equal(freshRuntime.call("freshTermSize", term), 4n);
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
              fn: {
                kind: "lam",
                fields: { binder: "x", body: { kind: "var", value: "x" } },
              },
              arg: { kind: "var", value: "y" },
            },
          },
          arg: { kind: "var", value: "x" },
        },
      },
    },
  });
  assert.throws(
    () =>
      freshRuntime.call("freshTermSize", {
        kind: "app",
        fn: { kind: "var", value: "x" },
        arg: { kind: "var", value: "y" },
      }),
    /argument arg1\.fn is not supported for "app"/,
  );

  assert.throws(
    () => freshRuntime.call("freshJsonWeight", "null"),
    /freshJsonWeight argument arg1 must be an object/,
  );
  assert.equal(freshRuntime.call("freshJsonWeight", { kind: "null" }), 1n);
  assert.throws(
    () => freshRuntime.call("freshJsonWeight", { tag: 0 }),
    /freshJsonWeight argument arg1 must specify variant kind/,
  );
  assert.throws(
    () => freshRuntime.call("freshJsonWeight", { kind: "null", value: null }),
    /argument arg1\.value is not supported for "null"/,
  );
  assert.throws(
    () => freshRuntime.call("freshJsonWeight", { kind: "bool" }),
    /freshJsonWeight argument arg1\.bool is missing value/,
  );
  assert.equal(
    freshRuntime.call("freshJsonWeight", { kind: "bool", value: true }),
    2n,
  );
  assert.equal(
    freshRuntime.call("freshJsonWeight", {
      kind: "array",
      value: [{ kind: "null" }, { kind: "nat", value: 4 }],
    }),
    12n,
  );
  assert.equal(
    freshRuntime.call("freshJsonWeight", {
      kind: "object",
      value: [
        { fst: "ok", snd: { kind: "bool", value: false } },
        { fst: "empty", snd: { kind: "null" } },
      ],
    }),
    22n,
  );
  assert.deepEqual(
    freshRuntime.call("freshJsonWrap", { kind: "nat", value: 4 }),
    {
      kind: "array",
      value: [{ kind: "nat", value: 4n }, { kind: "null" }],
    },
  );
  const freshJsonEntry = manifestEntry(freshManifest, "freshJsonWeight");
  const freshJsonCtors = freshJsonEntry.args[0].type.native.metadata.constructors;
  assert.equal(freshJsonCtors[0].representation, "immediate");
  const jsonArrayList = freshJsonCtors[3].fields[0].type;
  assert.equal(jsonArrayList.metadata.declaration, "List");
  assert.deepEqual(jsonArrayList.metadata.constructors[1].fields[1].type, { ref: 0 });
  const jsonObjectList = freshJsonCtors[4].fields[0].type;
  const jsonObjectPair = jsonObjectList.metadata.constructors[1].fields[0].type;
  assert.deepEqual(jsonObjectPair.metadata.constructors[0].fields[1].type, { ref: 2 });

  const spellingSource = join(freshDir, "ConstructorSpelling.lean");
  const spellingPackage = join(freshDir, "constructor-spelling.irpkg");
  await writeRuntimeFixture(spellingSource, "ConstructorSpelling.lean");
  await generateIrPackage("ConstructorSpelling", spellingSource, spellingPackage);
  const spellingRuntime = await factory.createRuntime({
    irPackageSet: [await readFile(spellingPackage)],
  });
  try {
    const spellingType = manifestEntry(spellingRuntime.interfaceManifest, "constructorSpellingIdentity").args[0].type;
    assert.deepEqual(spellingType.native.metadata.constructors, [
      { name: "ConstructorSpelling.plain", representation: "immediate", fields: [] },
      { name: "ConstructorSpelling.constructor", representation: "immediate", fields: [] },
    ]);
    assert.deepEqual(spellingType.value.cases, ["plain", "constructor"]);
    assert.equal(spellingRuntime.call("constructorSpellingIdentity", "constructor"), "constructor");
    assert.throws(
      () => spellingRuntime.call("constructorSpellingIdentity", "ConstructorSpelling.constructor"),
      /unknown enum value/,
    );
  } finally {
    spellingRuntime.dispose();
  }
}
