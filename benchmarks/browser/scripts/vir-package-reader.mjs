import { readFile } from "node:fs/promises";

const decoder = new TextDecoder("utf-8", { fatal: true });
const packageMagic = "lean-vir-ir-package";
const interfaceManifestSection = 5;
const requiredSections = [1, 2, 3, 4, interfaceManifestSection];

export async function readVirPackageFile(path) {
  return readVirPackageInfo(await readFile(path));
}

export function readVirPackageInfo(input) {
  const bytes = asBytes(input);
  let offset = 0;
  const magic = readString(bytes, offset);
  offset = magic.nextOffset;
  if (magic.value !== packageMagic) {
    throw new Error(`invalid VIR package magic ${JSON.stringify(magic.value)}`);
  }
  const version = readU32(bytes, offset);
  offset += 8; // package version and declaration count
  const sectionCount = readU32(bytes, offset);
  offset += 4;
  if (sectionCount > Math.floor((bytes.byteLength - offset) / 12)) {
    throw new Error("VIR package section directory exceeds package byte length");
  }
  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const kind = readU32(bytes, offset);
    const sectionOffset = readU32(bytes, offset + 4);
    const byteLength = readU32(bytes, offset + 8);
    offset += 12;
    if (
      sectionOffset > bytes.byteLength ||
      byteLength > bytes.byteLength - sectionOffset
    ) {
      throw new Error(`VIR package section ${kind} exceeds package byte length`);
    }
    sections.push({ kind, offset: sectionOffset, byteLength });
  }
  for (const kind of requiredSections) requireSection(sections, kind);
  const manifestSection = requireSection(sections, interfaceManifestSection);
  const manifestText = readString(bytes, manifestSection.offset);
  if (
    manifestText.nextOffset !==
    manifestSection.offset + manifestSection.byteLength
  ) {
    throw new Error("VIR package interface manifest section has trailing bytes");
  }
  const manifest = JSON.parse(manifestText.value);
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    !Number.isInteger(manifest.version) ||
    manifest.metadata === null ||
    typeof manifest.metadata !== "object" ||
    Array.isArray(manifest.metadata) ||
    !Array.isArray(manifest.exports)
  ) {
    throw new Error("VIR package interface manifest is malformed");
  }
  return { package: { version }, manifest };
}

function requireSection(sections, kind) {
  const matches = sections.filter((section) => section.kind === kind);
  if (matches.length !== 1) {
    throw new Error(
      `VIR package must contain exactly one section ${kind}, found ${matches.length}`,
    );
  }
  return matches[0];
}

function readString(bytes, offset) {
  const byteLength = readU32(bytes, offset);
  const start = offset + 4;
  const end = start + byteLength;
  if (end > bytes.byteLength) {
    throw new Error(`string length ${byteLength} exceeds remaining package bytes`);
  }
  return {
    value: decoder.decode(bytes.subarray(start, end)),
    nextOffset: end,
  };
}

function readU32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    throw new Error("unexpected end of VIR package");
  }
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new Error("VIR package bytes must be an ArrayBuffer or Uint8Array");
}
