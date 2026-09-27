/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

import {
  IR_PACKAGE_SECTION,
  IR_PACKAGE_VERSION,
  irPackageManifestChecksum,
  readIrPackageInfo,
} from "../../web/src/runtime/ir-package.js";
import { asBytes } from "../../web/src/runtime/vir-codec.js";
import { validateInterfaceManifest } from "../../web/src/runtime/interface-manifest.js";

export {
  IR_PACKAGE_MAGIC,
  IR_PACKAGE_SECTION,
  IR_PACKAGE_VERSION,
  readIrPackageInfo,
  validateIrPackageSetMembers,
} from "../../web/src/runtime/ir-package.js";

const textEncoder = new TextEncoder();

/**
 * Rewrite a package manifest and its corruption checksum for tests and tools.
 * This does not update the binary call tables or establish agreement with them.
 */
export function replaceIrPackageManifest(input, manifest) {
  const bytes = asBytes(input, "IR package bytes");
  const info = readIrPackageInfo(bytes);
  const manifestText = JSON.stringify(
    validateInterfaceManifest(manifest, {
      packageFormatVersion: info.package.version,
    }),
  );
  const manifestBytes = textEncoder.encode(manifestText);
  const manifestSection = requireSection(
    info.package.sections,
    IR_PACKAGE_SECTION.INTERFACE_MANIFEST,
  );
  const newManifestSectionByteLength = 12 + manifestBytes.byteLength;
  const oldManifestEnd = manifestSection.offset + manifestSection.byteLength;
  const newManifestEnd = manifestSection.offset + newManifestSectionByteLength;
  const delta = newManifestSectionByteLength - manifestSection.byteLength;
  const output = new Uint8Array(bytes.byteLength + delta);
  output.set(bytes.subarray(0, manifestSection.offset), 0);
  writeU64(output, manifestSection.offset, irPackageManifestChecksum(manifestBytes));
  writeU32(output, manifestSection.offset + 8, manifestBytes.byteLength);
  output.set(manifestBytes, manifestSection.offset + 12);
  output.set(bytes.subarray(oldManifestEnd), newManifestEnd);
  const directoryOffset = sectionDirectoryOffset(bytes);
  for (const [index, section] of info.package.sections.entries()) {
    const offset =
      section.offset > manifestSection.offset
        ? section.offset + delta
        : section.offset;
    const directoryEntryOffset = directoryOffset + index * 12;
    writeU32(output, directoryEntryOffset + 4, offset);
    writeU32(
      output,
      directoryEntryOffset + 8,
      section.kind === IR_PACKAGE_SECTION.INTERFACE_MANIFEST
        ? newManifestSectionByteLength
        : section.byteLength,
    );
  }
  return output;
}

export function encodeInvalidMagicPackage() {
  const magicBytes = textEncoder.encode("not-lean-vir");
  const bytes = new Uint8Array(4 + magicBytes.byteLength + 8);
  writeU32(bytes, 0, magicBytes.byteLength);
  bytes.set(magicBytes, 4);
  writeU32(bytes, 4 + magicBytes.byteLength, IR_PACKAGE_VERSION);
  writeU32(bytes, 8 + magicBytes.byteLength, 0);
  return bytes;
}

export async function readIrPackageFile(path) {
  return readIrPackageInfo(await readFile(path), { path });
}

function requireSection(sections, kind) {
  const section = sections.find((candidate) => candidate.kind === kind);
  if (!section) throw new Error(`IR package is missing section ${kind}`);
  return section;
}

function sectionDirectoryOffset(bytes) {
  const magicByteLength = new DataView(
    bytes.buffer, bytes.byteOffset, bytes.byteLength,
  ).getUint32(0, true);
  return 4 + magicByteLength + 4 + 4 + 4;
}

function writeU32(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeU64(bytes, offset, value) {
  writeU32(bytes, offset, Number(value & 0xffffffffn));
  writeU32(bytes, offset + 4, Number(value >> 32n));
}
