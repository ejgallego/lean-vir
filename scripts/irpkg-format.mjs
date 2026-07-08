/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

import { INTERFACE_MANIFEST_ARTIFACT, validateInterfaceManifest } from "../web/src/runtime/interface-manifest.js";
import { PACKAGE_FORMAT_VERSION } from "./package-versions.mjs";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export const IR_PACKAGE_MAGIC = "lean-vir-ir-package";
export const IR_PACKAGE_SECTION = Object.freeze({
  DECLARATIONS: 1,
  INIT_GLOBALS: 2,
  HOST_IMPORTS: 3,
  EXPORT_SUMMARIES: 4,
  INTERFACE_MANIFEST: 5,
});

const SECTION_NAMES = new Map([
  [IR_PACKAGE_SECTION.DECLARATIONS, "declarations"],
  [IR_PACKAGE_SECTION.INIT_GLOBALS, "initGlobals"],
  [IR_PACKAGE_SECTION.HOST_IMPORTS, "hostImports"],
  [IR_PACKAGE_SECTION.EXPORT_SUMMARIES, "exportSummaries"],
  [IR_PACKAGE_SECTION.INTERFACE_MANIFEST, "interfaceManifest"],
]);

export async function readIrPackageFile(path) {
  return readIrPackageInfo(await readFile(path), { path });
}

export function readIrPackageInfo(input, { path = null } = {}) {
  const bytes = asBytes(input);
  const header = readHeader(bytes);
  if (header.magic !== IR_PACKAGE_MAGIC) {
    throw new Error(`invalid IR package magic \`${header.magic}\``);
  }
  if (header.version !== PACKAGE_FORMAT_VERSION) {
    throw new Error(`unsupported IR package version ${header.version}`);
  }
  const { sections, nextOffset: sectionDirectoryEnd } = readSectionDirectory(bytes, header.nextOffset);
  for (const kind of Object.values(IR_PACKAGE_SECTION)) {
    requireSection(sections, kind);
  }
  const manifestSection = requireSection(sections, IR_PACKAGE_SECTION.INTERFACE_MANIFEST);
  const manifestString = readString(bytes, manifestSection.offset);
  if (manifestString.nextOffset !== manifestSection.offset + manifestSection.byteLength) {
    throw new Error("interface manifest section has trailing bytes");
  }
  const manifest = JSON.parse(manifestString.value);
  if (manifest?.artifact !== INTERFACE_MANIFEST_ARTIFACT) {
    throw new Error("IR package interface manifest has an invalid artifact marker");
  }
  return {
    path,
    byteLength: bytes.byteLength,
    package: {
      magic: header.magic,
      version: header.version,
      declarationCount: header.declarationCount,
      sectionDirectoryEnd,
      sections,
      manifestOffset: manifestSection.offset,
      manifestByteLength: manifestString.byteLength,
      manifestSectionByteLength: manifestSection.byteLength,
    },
    manifest: validateInterfaceManifest(manifest),
  };
}

export function replaceIrPackageManifest(input, manifest) {
  const bytes = asBytes(input);
  const info = readIrPackageInfo(bytes);
  const manifestText = JSON.stringify(validateInterfaceManifest(manifest));
  const manifestBytes = textEncoder.encode(manifestText);
  const manifestSection = requireSection(info.package.sections, IR_PACKAGE_SECTION.INTERFACE_MANIFEST);
  const newManifestSectionByteLength = 4 + manifestBytes.byteLength;
  const oldManifestEnd = manifestSection.offset + manifestSection.byteLength;
  const newManifestEnd = manifestSection.offset + newManifestSectionByteLength;
  const delta = newManifestSectionByteLength - manifestSection.byteLength;
  const output = new Uint8Array(bytes.byteLength + delta);
  output.set(bytes.subarray(0, manifestSection.offset), 0);
  writeU32(output, manifestSection.offset, manifestBytes.byteLength);
  output.set(manifestBytes, manifestSection.offset + 4);
  output.set(bytes.subarray(oldManifestEnd), newManifestEnd);
  for (const section of info.package.sections) {
    const offset = section.offset > manifestSection.offset ? section.offset + delta : section.offset;
    writeU32(output, section.directoryEntryOffset + 4, offset);
    writeU32(
      output,
      section.directoryEntryOffset + 8,
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
  writeU32(bytes, 4 + magicBytes.byteLength, PACKAGE_FORMAT_VERSION);
  writeU32(bytes, 8 + magicBytes.byteLength, 0);
  return bytes;
}

function readHeader(bytes) {
  let offset = 0;
  const magic = readString(bytes, offset);
  offset = magic.nextOffset;
  const version = readU32(bytes, offset);
  offset += 4;
  const declarationCount = readU32(bytes, offset);
  offset += 4;
  return { magic: magic.value, version, declarationCount, nextOffset: offset };
}

function readSectionDirectory(bytes, offset) {
  const sectionCount = readU32(bytes, offset);
  offset += 4;
  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const directoryEntryOffset = offset;
    const kind = readU32(bytes, offset);
    offset += 4;
    const sectionOffset = readU32(bytes, offset);
    offset += 4;
    const byteLength = readU32(bytes, offset);
    offset += 4;
    if (sectionOffset > bytes.byteLength || byteLength > bytes.byteLength - sectionOffset) {
      throw new Error(`IR package section ${kind} exceeds package byte length`);
    }
    sections.push({
      kind,
      name: sectionName(kind),
      offset: sectionOffset,
      byteLength,
      directoryEntryOffset,
    });
  }
  return { sections, nextOffset: offset };
}

function requireSection(sections, kind) {
  const matches = sections.filter((section) => section.kind === kind);
  if (matches.length === 0) {
    throw new Error(`IR package is missing section ${sectionName(kind)}`);
  }
  if (matches.length > 1) {
    throw new Error(`IR package has duplicate section ${sectionName(kind)}`);
  }
  return matches[0];
}

function sectionName(kind) {
  return SECTION_NAMES.get(kind) ?? `unknown(${kind})`;
}

function readString(bytes, offset) {
  const byteLength = readU32(bytes, offset);
  const start = offset + 4;
  const end = start + byteLength;
  if (end > bytes.byteLength) {
    throw new Error(`string length ${byteLength} exceeds remaining package bytes`);
  }
  return {
    value: textDecoder.decode(bytes.subarray(start, end)),
    byteLength,
    nextOffset: end,
  };
}

function readU32(bytes, offset) {
  const value = readU32OrNull(bytes, offset);
  if (value === null) {
    throw new Error("unexpected end of IR package");
  }
  return value;
}

function readU32OrNull(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    return null;
  }
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function writeU32(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function asBytes(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new Error("IR package bytes must be an ArrayBuffer or Uint8Array");
}
