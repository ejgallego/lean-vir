/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { encodePackageContract } from "../../web/src/runtime/package-contract.js";
import {
  encodeInvalidMagicPackage,
  IR_PACKAGE_SECTION,
  readIrPackageInfo,
  replaceIrPackageManifest,
} from "../../scripts/packages/irpkg-format.mjs";
import { assert, readRuntimeArtifacts } from "./shared.mjs";

const { wasmBytes, defaultPackageBytes } = await readRuntimeArtifacts();
const factory = createVirRuntimeFactory({ wasmBytes });

const renamedExportManifest = structuredClone(
  readIrPackageInfo(defaultPackageBytes).manifest,
);
renamedExportManifest.exports[0].entry = "Review.RenamedExport";
await assert.rejects(
  () =>
    factory.createRuntime({
      irPackageSet: [
        replaceIrPackageManifest(defaultPackageBytes, renamedExportManifest),
      ],
    }),
  /manifest\/binary contract mismatch:.*export.*entry/,
);

const unloaded = await factory.createRuntime();
assert.equal(unloaded.packageInfo, null);
assert.equal(unloaded.packageDeclCount(), 0);
assert.throws(() => unloaded.call("fib", 8), /interface entry not found: fib/);

const first = await factory.createRuntime({
  irPackageSet: [defaultPackageBytes],
});
const second = await factory.createRuntime({
  irPackageSet: [defaultPackageBytes],
});
assert.equal(first.call("SortDemo.demo"), "192");
assert.equal(second.call("fib", 8), "21");

const contract = encodePackageContract(first.interfaceManifest);
function validateContract(bytes) {
  const ptr = first.allocBytes(bytes);
  try {
    return first.exports.vir_validate_package_contract(ptr, bytes.length);
  } finally {
    first.freeBytes(ptr);
  }
}
assert.equal(validateContract(contract), 1);
for (const bytes of [
  contract.subarray(0, 0),
  contract.subarray(0, 4),
  contract.subarray(0, contract.length - 1),
]) {
  assert.equal(validateContract(bytes), 0);
  assert.match(first.lastPackageError(), /invalid IR package contract/);
}
assert.equal(validateContract(Uint8Array.from([...contract, 0])), 0);
assert.match(first.lastPackageError(), /trailing bytes/);
const invalidBooleanContract = Uint8Array.from(contract);
invalidBooleanContract[
  12 + new TextEncoder().encode(first.interfaceManifest.exports[0].entry).length
] = 2;
assert.equal(validateContract(invalidBooleanContract), 0);
assert.match(first.lastPackageError(), /invalid boolean tag 2/);
assert.equal(validateContract(contract), 1);
assert.equal(first.lastPackageError(), "");

const badPackageRuntime = await factory.createRuntime();
// Recompute the manifest checksum on purpose: agreement must be checked against
// the independently decoded tables, not inferred from a self-consistent hash.
for (const [field, mutate] of [
  ["export count", (m) => m.exports.pop()],
  ["entry", (m) => m.exports.reverse()],
  [
    "argument count",
    (m) => {
      m.exports[0].args = [];
    },
  ],
  [
    "effect",
    (m) => {
      m.exports[0].effect = "runtime";
    },
  ],
  [
    "boxed boundary",
    (m) => {
      m.exports[0].result = { type: "Float", interfaceTag: 10 };
    },
  ],
]) {
  const manifest = structuredClone(
    readIrPackageInfo(defaultPackageBytes).manifest,
  );
  mutate(manifest);
  assertFailedCleanly(
    badPackageRuntime,
    replaceIrPackageManifest(defaultPackageBytes, manifest),
    new RegExp(`manifest/binary contract mismatch:.*${field}`),
  );
}

// An independently rewritten binary summary must also fail with an unchanged
// (and therefore still checksum-valid) manifest.
for (const [field, offset, value] of [
  ["effect", 0, 1],
  ["argument count", 1, 2],
  ["boxed boundary", 5, 1],
]) {
  const bytes = Uint8Array.from(defaultPackageBytes);
  const view = dataView(bytes);
  const section = findPackageSection(view, IR_PACKAGE_SECTION.EXPORT_SUMMARIES);
  const fields = skipName(view, section.offset + 4);
  bytes[fields + offset] = value;
  assertFailedCleanly(
    badPackageRuntime,
    bytes,
    new RegExp(`manifest/binary contract mismatch:.*${field}`),
  );
}
const badPackage = encodeInvalidMagicPackage();
assertFailedCleanly(badPackageRuntime, badPackage, /invalid IR package magic/);
assertFailedCleanly(
  badPackageRuntime,
  invalidateFirstDeclarationNameTag(defaultPackageBytes),
  /unsupported name tag 255/,
);
assertFailedCleanly(
  badPackageRuntime,
  oversizeDeclarationCount(defaultPackageBytes),
  /declaration count 4294967295 exceeds remaining section bytes/,
);
assertFailedCleanly(
  badPackageRuntime,
  oversizeSectionDirectoryCount(defaultPackageBytes),
  /section directory entry count 4294967295 exceeds remaining section bytes/,
);
assertFailedCleanly(
  badPackageRuntime,
  unknownFirstSectionKind(defaultPackageBytes),
  /unknown section kind 99/,
);
assertFailedCleanly(
  badPackageRuntime,
  sectionInsideDirectory(defaultPackageBytes),
  /starts inside the package header or section directory/,
);
assertFailedCleanly(
  badPackageRuntime,
  overlapFirstTwoSections(defaultPackageBytes),
  /sections declarations and initGlobals overlap/,
);
assertFailedCleanly(
  badPackageRuntime,
  oversizeSectionEntryCount(
    defaultPackageBytes,
    IR_PACKAGE_SECTION.INIT_GLOBALS,
  ),
  /initializer entry count 4294967295 exceeds remaining section bytes/,
);
assertFailedCleanly(
  badPackageRuntime,
  oversizeSectionEntryCount(
    defaultPackageBytes,
    IR_PACKAGE_SECTION.HOST_IMPORTS,
  ),
  /host import entry count 4294967295 exceeds remaining section bytes/,
);
assertFailedCleanly(
  badPackageRuntime,
  oversizeSectionEntryCount(
    defaultPackageBytes,
    IR_PACKAGE_SECTION.EXPORT_SUMMARIES,
  ),
  /export summary entry count 4294967295 exceeds remaining section bytes/,
);
const partialDecodeRuntime = await factory.createRuntime();
const partialDeclarationPackage =
  truncateDeclarationSection(defaultPackageBytes);
const partialDecodePages = [];
for (let iteration = 0; iteration < 30; iteration += 1) {
  assert.throws(
    () =>
      partialDecodeRuntime.loadIrPackageSetBytes([partialDeclarationPackage]),
    /invalid IR package section `declarations`:/,
  );
  partialDecodePages.push(
    partialDecodeRuntime.exports.memory.buffer.byteLength / 65536,
  );
}
const warmedPartialDecodePages = partialDecodePages.slice(5);
assert.ok(
  Math.max(...warmedPartialDecodePages) -
    Math.min(...warmedPartialDecodePages) <=
    1,
  `partial package decoding should reuse memory after warm-up; pages: ${partialDecodePages.join(", ")}`,
);
partialDecodeRuntime.dispose();

const partialSetRuntime = await factory.createRuntime();
assertFailedSetCleanly(
  partialSetRuntime,
  [defaultPackageBytes, badPackage],
  /IR package-set member 2 is invalid: invalid IR package magic/,
);
partialSetRuntime.loadIrPackageSetBytes([defaultPackageBytes]);
assert.equal(partialSetRuntime.call("fib", 8), "21");
partialSetRuntime.dispose();

assert.throws(
  () => first.loadIrPackageSetBytes([badPackage]),
  /invalid IR package magic/,
);
assert.notEqual(first.packageInfo, null);
assert.notEqual(first.interfaceManifest, null);
assert.notEqual(first.packageMetadata, null);
assert.equal(first.call("fib", 8), "21");

assert.throws(
  () =>
    first.loadIrPackageSetBytes([
      replaceIrPackageManifest(defaultPackageBytes, renamedExportManifest),
    ]),
  /manifest\/binary contract mismatch:.*export.*entry/,
);
assert.equal(first.call("fib", 8), "21");

const previousManifest = first.interfaceManifest;
first.loadIrPackageSetBytes([defaultPackageBytes]);
assert.notEqual(first.interfaceManifest, previousManifest);
assert.ok(Object.isFrozen(first.interfaceManifest.exports[0].args[0].type));
assert.equal(first.call("fib", 8), "21");

first.dispose();
second.dispose();
badPackageRuntime.dispose();
unloaded.dispose();

console.log("vir package decoder smoke ok");

function assertFailedCleanly(runtime, packageBytes, expectedError) {
  assertFailedSetCleanly(runtime, [packageBytes], expectedError);
}

function assertFailedSetCleanly(runtime, packageMembers, expectedError) {
  assert.throws(
    () => runtime.loadIrPackageSetBytes(packageMembers),
    expectedError,
  );
  assert.equal(runtime.packageInfo, null);
  assert.equal(runtime.interfaceManifest, null);
  assert.equal(runtime.packageMetadata, null);
  assert.equal(runtime.packageDeclCount(), 0);
}

function truncateDeclarationSection(packageBytes) {
  const bytes = Uint8Array.from(packageBytes);
  const view = dataView(bytes);
  const declarations = findPackageSection(
    view,
    IR_PACKAGE_SECTION.DECLARATIONS,
  );
  const declarationBytes = view.getUint32(declarations.byteLengthOffset, true);
  assert.ok(
    declarationBytes > 32,
    "IR package declarations section is too small to truncate",
  );
  view.setUint32(declarations.byteLengthOffset, declarationBytes - 32, true);
  return bytes;
}

function skipName(view, offset) {
  const tag = view.getUint8(offset++);
  if (tag === 0) return offset;
  assert.ok(tag === 1 || tag === 2, `unexpected name tag ${tag}`);
  offset = skipName(view, offset);
  return offset + 4 + (tag === 1 ? view.getUint32(offset, true) : 0);
}

function invalidateFirstDeclarationNameTag(packageBytes) {
  const bytes = Uint8Array.from(packageBytes);
  const declarations = findPackageSection(
    dataView(bytes),
    IR_PACKAGE_SECTION.DECLARATIONS,
  );
  bytes[declarations.offset] = 255;
  return bytes;
}

function oversizeDeclarationCount(packageBytes) {
  const bytes = Uint8Array.from(packageBytes);
  const view = dataView(bytes);
  view.setUint32(packageHeaderOffsets(view).declarationCount, 0xffffffff, true);
  return bytes;
}

function oversizeSectionDirectoryCount(packageBytes) {
  const bytes = Uint8Array.from(packageBytes);
  const view = dataView(bytes);
  view.setUint32(packageHeaderOffsets(view).sectionCount, 0xffffffff, true);
  return bytes;
}

function unknownFirstSectionKind(packageBytes) {
  const bytes = Uint8Array.from(packageBytes);
  const view = dataView(bytes);
  const { sectionCount } = packageHeaderOffsets(view);
  view.setUint32(sectionCount + 4, 99, true);
  return bytes;
}

function sectionInsideDirectory(packageBytes) {
  const bytes = Uint8Array.from(packageBytes);
  const view = dataView(bytes);
  const { sectionCount } = packageHeaderOffsets(view);
  view.setUint32(sectionCount + 8, sectionCount + 4, true);
  return bytes;
}

function overlapFirstTwoSections(packageBytes) {
  const bytes = Uint8Array.from(packageBytes);
  const view = dataView(bytes);
  const { sectionCount } = packageHeaderOffsets(view);
  const firstOffset = view.getUint32(sectionCount + 8, true);
  view.setUint32(sectionCount + 4 + 12 + 4, firstOffset, true);
  return bytes;
}

function oversizeSectionEntryCount(packageBytes, kind) {
  const bytes = Uint8Array.from(packageBytes);
  const view = dataView(bytes);
  const section = findPackageSection(view, kind);
  view.setUint32(section.offset, 0xffffffff, true);
  return bytes;
}

function findPackageSection(view, kind) {
  const { sectionCount } = packageHeaderOffsets(view);
  const count = view.getUint32(sectionCount, true);
  for (let index = 0; index < count; index += 1) {
    const directoryEntryOffset = sectionCount + 4 + index * 12;
    if (view.getUint32(directoryEntryOffset, true) === kind) {
      return {
        offset: view.getUint32(directoryEntryOffset + 4, true),
        byteLengthOffset: directoryEntryOffset + 8,
      };
    }
  }
  throw new Error(`IR package section ${kind} is missing`);
}

function packageHeaderOffsets(view) {
  const magicByteLength = view.getUint32(0, true);
  return {
    declarationCount: 4 + magicByteLength + 4,
    sectionCount: 4 + magicByteLength + 8,
  };
}

function dataView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
