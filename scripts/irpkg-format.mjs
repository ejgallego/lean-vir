/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

import { INTERFACE_MANIFEST_ARTIFACT, validateInterfaceManifest } from "../web/src/runtime/interface-manifest.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export const IR_PACKAGE_MAGIC = "lean-vir-ir-package";

export async function readIrPackageFile(path) {
  return readIrPackageInfo(await readFile(path), { path });
}

export function readIrPackageInfo(input, { path = null } = {}) {
  const bytes = asBytes(input);
  const header = readHeader(bytes);
  if (header.magic !== IR_PACKAGE_MAGIC) {
    throw new Error(`invalid IR package magic \`${header.magic}\``);
  }
  if (header.version < 4) {
    throw new Error(`IR package version ${header.version} does not contain an embedded interface manifest`);
  }
  const { offset: manifestOffset, byteLength: manifestByteLength, manifest } = readTrailingManifest(bytes);
  return {
    path,
    byteLength: bytes.byteLength,
    package: {
      magic: header.magic,
      version: header.version,
      declarationCount: header.declarationCount,
      manifestOffset,
      manifestByteLength,
    },
    manifest,
  };
}

export function replaceIrPackageManifest(input, manifest) {
  const bytes = asBytes(input);
  const info = readIrPackageInfo(bytes);
  const manifestText = JSON.stringify(validateInterfaceManifest(manifest));
  const manifestBytes = textEncoder.encode(manifestText);
  const output = new Uint8Array(info.package.manifestOffset + 4 + manifestBytes.byteLength);
  output.set(bytes.subarray(0, info.package.manifestOffset), 0);
  writeU32(output, info.package.manifestOffset, manifestBytes.byteLength);
  output.set(manifestBytes, info.package.manifestOffset + 4);
  return output;
}

export function encodeInvalidMagicPackage() {
  const magicBytes = textEncoder.encode("not-lean-vir");
  const bytes = new Uint8Array(4 + magicBytes.byteLength + 8);
  writeU32(bytes, 0, magicBytes.byteLength);
  bytes.set(magicBytes, 4);
  writeU32(bytes, 4 + magicBytes.byteLength, 4);
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
  return { magic: magic.value, version, declarationCount };
}

function readTrailingManifest(bytes) {
  for (let offset = bytes.byteLength - 4; offset >= 0; offset -= 1) {
    const byteLength = readU32OrNull(bytes, offset);
    if (byteLength === null || offset + 4 + byteLength !== bytes.byteLength) {
      continue;
    }
    const text = textDecoder.decode(bytes.subarray(offset + 4));
    let manifest;
    try {
      manifest = JSON.parse(text);
    } catch {
      continue;
    }
    if (manifest?.artifact !== INTERFACE_MANIFEST_ARTIFACT) {
      continue;
    }
    return { offset, byteLength, manifest: validateInterfaceManifest(manifest) };
  }
  throw new Error("IR package does not contain a valid trailing interface manifest");
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
