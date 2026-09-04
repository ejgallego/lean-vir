/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  INTERFACE_MANIFEST_ARTIFACT,
  validateInterfaceManifest,
} from "./interface-manifest.js";
import { asBytes } from "./vir-codec.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export const IR_PACKAGE_MAGIC = "lean-vir-ir-package";
export const IR_PACKAGE_VERSION = 10;
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

const PACKAGE_SET_IDENTITY_FIELDS = Object.freeze([
  "packageFormatVersion",
  "manifestVersion",
  "leanVersion",
  "leanToolchain",
  "leanGithash",
]);

export function readIrPackageInfo(input, { path = null } = {}) {
  const info = readIrPackageInfoInternal(input, { path });
  return {
    path: info.path,
    byteLength: info.byteLength,
    package: {
      magic: info.package.magic,
      version: info.package.version,
      declarationCount: info.package.declarationCount,
      sections: info.package.sections.map(publicSectionInfo),
    },
    manifest: info.manifest,
  };
}

/**
 * Parse and bind an ordered package-set byte array to its embedded member
 * identities. Descriptor metadata is optional, but when supplied it must name
 * the exact module and role embedded in each member.
 */
export function validateIrPackageSetMembers(packages, { members = null } = {}) {
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new TypeError(
      "IR package set must be a non-empty array ordered dependencies first, root last",
    );
  }
  if (members !== null) {
    if (!Array.isArray(members) || members.length !== packages.length) {
      throw new Error(
        "IR package-set descriptor metadata must match the package byte array length",
      );
    }
  }

  const bytes = packages.map((value, index) =>
    asBytes(value, `IR package-set member ${index + 1}`),
  );
  const manifests = bytes.map((value, index) => {
    try {
      return readIrPackageInfo(value).manifest;
    } catch (error) {
      throw new Error(
        `IR package-set member ${index + 1} is invalid: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  });
  const embeddedMembers = manifests.map(
    (manifest) => manifest.metadata.packageSetMember ?? null,
  );
  const requiresMemberIdentity =
    packages.length > 1 ||
    members !== null ||
    embeddedMembers.some((member) => member !== null);

  if (requiresMemberIdentity) {
    const modules = new Set();
    for (let index = 0; index < embeddedMembers.length; index += 1) {
      const label = `IR package-set member ${index + 1}`;
      const embedded = embeddedMembers[index];
      if (embedded === null) {
        throw new Error(`${label} has no embedded packageSetMember identity`);
      }
      const expectedRole =
        index === packages.length - 1 ? "root" : "dependency";
      if (embedded.role !== expectedRole) {
        throw new Error(
          `${label} embeds role ${JSON.stringify(embedded.role)}; expected ${JSON.stringify(expectedRole)}`,
        );
      }
      if (modules.has(embedded.module)) {
        throw new Error(
          `${label} duplicates embedded module ${JSON.stringify(embedded.module)}`,
        );
      }
      modules.add(embedded.module);

      if (members !== null) {
        const claimed = members[index];
        if (
          claimed === null ||
          typeof claimed !== "object" ||
          Array.isArray(claimed)
        ) {
          throw new Error(`${label} has invalid descriptor metadata`);
        }
        if (claimed.module !== embedded.module) {
          throw new Error(
            `${label} embeds module ${JSON.stringify(embedded.module)}; descriptor claims ${JSON.stringify(claimed.module)}`,
          );
        }
        if (claimed.role !== embedded.role) {
          throw new Error(
            `${label} embeds role ${JSON.stringify(embedded.role)}; descriptor claims ${JSON.stringify(claimed.role)}`,
          );
        }
      }
    }
    validatePackageSetIdentity(manifests);
  }

  return { bytes, manifests };
}

export function replaceIrPackageManifest(input, manifest) {
  const bytes = asBytes(input, "IR package bytes");
  const info = readIrPackageInfoInternal(bytes);
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
    const offset =
      section.offset > manifestSection.offset
        ? section.offset + delta
        : section.offset;
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
  writeU32(bytes, 4 + magicBytes.byteLength, IR_PACKAGE_VERSION);
  writeU32(bytes, 8 + magicBytes.byteLength, 0);
  return bytes;
}

function readIrPackageInfoInternal(input, { path = null } = {}) {
  const bytes = asBytes(input, "IR package bytes");
  const header = readHeader(bytes);
  if (header.magic !== IR_PACKAGE_MAGIC) {
    throw new Error(`invalid IR package magic \`${header.magic}\``);
  }
  if (header.version !== IR_PACKAGE_VERSION) {
    throw new Error(`unsupported IR package version ${header.version}`);
  }
  const sections = readSectionDirectory(bytes, header.nextOffset);
  for (const kind of Object.values(IR_PACKAGE_SECTION)) {
    requireSection(sections, kind);
  }
  const manifestSection = requireSection(
    sections,
    IR_PACKAGE_SECTION.INTERFACE_MANIFEST,
  );
  const manifestString = readString(bytes, manifestSection.offset);
  if (
    manifestString.nextOffset !==
    manifestSection.offset + manifestSection.byteLength
  ) {
    throw new Error("interface manifest section has trailing bytes");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestString.value);
  } catch (error) {
    throw new Error(
      `invalid IR package interface manifest JSON: ${errorMessage(error)}`,
    );
  }
  if (manifest?.artifact !== INTERFACE_MANIFEST_ARTIFACT) {
    throw new Error(
      "IR package interface manifest has an invalid artifact marker",
    );
  }
  return {
    path,
    byteLength: bytes.byteLength,
    package: {
      magic: header.magic,
      version: header.version,
      declarationCount: header.declarationCount,
      sections,
    },
    manifest: validateInterfaceManifest(manifest, {
      packageFormatVersion: header.version,
    }),
  };
}

function validatePackageSetIdentity(manifests) {
  const expected = manifests[0].metadata;
  for (const field of PACKAGE_SET_IDENTITY_FIELDS) {
    if (expected[field] === undefined) {
      throw new Error(
        `IR package-set member 1 has no embedded metadata.${field}`,
      );
    }
  }
  for (let index = 1; index < manifests.length; index += 1) {
    const metadata = manifests[index].metadata;
    for (const field of PACKAGE_SET_IDENTITY_FIELDS) {
      if (metadata[field] === undefined) {
        throw new Error(
          `IR package-set member ${index + 1} has no embedded metadata.${field}`,
        );
      }
      if (metadata[field] !== expected[field]) {
        throw new Error(
          `IR package set mixes metadata.${field}: member 1 has ${JSON.stringify(expected[field])}, ` +
            `member ${index + 1} has ${JSON.stringify(metadata[field])}`,
        );
      }
    }
  }
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
  const remainingEntries = Math.floor((bytes.byteLength - offset) / 12);
  if (sectionCount > remainingEntries) {
    throw new Error(
      `section directory entry count ${sectionCount} exceeds remaining section bytes`,
    );
  }
  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const directoryEntryOffset = offset;
    const kind = readU32(bytes, offset);
    offset += 4;
    const sectionOffset = readU32(bytes, offset);
    offset += 4;
    const byteLength = readU32(bytes, offset);
    offset += 4;
    if (
      sectionOffset > bytes.byteLength ||
      byteLength > bytes.byteLength - sectionOffset
    ) {
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
  return sections;
}

function publicSectionInfo(section) {
  return {
    kind: section.kind,
    name: section.name,
    offset: section.offset,
    byteLength: section.byteLength,
  };
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
    throw new Error(
      `string length ${byteLength} exceeds remaining package bytes`,
    );
  }
  return {
    value: textDecoder.decode(bytes.subarray(start, end)),
    byteLength,
    nextOffset: end,
  };
}

function readU32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    throw new Error("unexpected end of IR package");
  }
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function writeU32(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
