/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import {
  encodeInvalidMagicPackage,
  IR_PACKAGE_SECTION,
} from "../../scripts/packages/irpkg-format.mjs";
import { assert, readRuntimeArtifacts } from "./shared.mjs";

const { wasmBytes, defaultPackageBytes } = await readRuntimeArtifacts();
const factory = createVirRuntimeFactory({ wasmBytes });

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

const badPackageRuntime = await factory.createRuntime();
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
assertFailedCleanly(
  badPackageRuntime,
  replacePackageText(
    defaultPackageBytes,
    '"packageFormatVersion":10',
    '"packageFormatVersion":11',
  ),
  /packageFormatVersion must match package header version 10/,
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
  /IR package-set member 2 load failed.*invalid IR package magic/,
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

function oversizeSectionEntryCount(packageBytes, kind) {
  const bytes = Uint8Array.from(packageBytes);
  const view = dataView(bytes);
  const section = findPackageSection(view, kind);
  view.setUint32(section.offset, 0xffffffff, true);
  return bytes;
}

function replacePackageText(packageBytes, sourceText, replacementText) {
  assert.equal(sourceText.length, replacementText.length);
  const bytes = Uint8Array.from(packageBytes);
  const source = new TextEncoder().encode(sourceText);
  const replacement = new TextEncoder().encode(replacementText);
  let offset = -1;
  for (let index = 0; index <= bytes.length - source.length; index += 1) {
    if (
      source.every((byte, sourceIndex) => bytes[index + sourceIndex] === byte)
    ) {
      offset = index;
      break;
    }
  }
  assert.notEqual(offset, -1, `package did not contain ${sourceText}`);
  bytes.set(replacement, offset);
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
