/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Browser-side counterpart of Vir.Resources.Validate's v1 descriptor rules.
// This intentionally receives already-parsed JSON: callers must bound JSON
// input and reject duplicate JSON keys before calling it.

const textEncoder = new TextEncoder();
const MAX_FILES = 4096;
const MAX_PAYLOAD_BYTES = 512 * 1024 * 1024;
const MAX_DESCRIPTOR_BYTES = 4 * 1024 * 1024;
const MAX_METADATA_BYTES = 4096;
const DOMAIN_PREFIX = textEncoder.encode("vir-resource-bundle-v1\n");

const descriptorKeys = [
  "schemaVersion",
  "logicalId",
  "kind",
  "compatibility",
  "files",
  "fileEntries",
  "exports",
];
const compatibilityKeys = [
  "leanRevision",
  "virVersion",
];
const fileKeys = ["path", "mediaType", "byteLength", "sha256"];
const entryKeys = ["role", "path"];
const exportKeys = ["role", "declaration", "interfaceId"];
const hex64 = /^[0-9a-f]{64}$/;
const pathPart = /^[A-Za-z0-9._-]+$/;

// Only this private boundary constructs a normalized descriptor and its encoding.
// Public entry points keep validating arbitrary caller-owned input.
function prepareDescriptor(value) {
  const descriptor = requireObject(value, "INVALID_DESCRIPTOR");
  requireExactKeys(descriptor, descriptorKeys, "INVALID_DESCRIPTOR");

  const schemaVersion = requireSafeInteger(
    descriptor.schemaVersion,
    "SCHEMA_VERSION",
  );
  if (schemaVersion !== 1) fail("SCHEMA_VERSION");
  const logicalId = metadata(descriptor.logicalId, "INVALID_METADATA");
  if (descriptor.kind !== "runtime" && descriptor.kind !== "program") {
    fail("INVALID_KIND");
  }

  const compatibility = requireObject(
    descriptor.compatibility,
    "INVALID_COMPATIBILITY",
  );
  requireExactKeys(compatibility, compatibilityKeys, "INVALID_COMPATIBILITY");
  const normalizedCompatibility = {
    leanRevision: metadata(compatibility.leanRevision, "INVALID_METADATA"),
    virVersion: version(compatibility.virVersion),
  };

  const files = requireArray(descriptor.files, "INVALID_FILES");
  if (files.length > MAX_FILES) fail("TOO_MANY_FILES");
  let totalBytes = 0;
  const normalizedFiles = files.map((file) => {
    const item = requireObject(file, "INVALID_FILE");
    requireExactKeys(item, fileKeys, "INVALID_FILE");
    const path = requirePath(item.path);
    const byteLength = requireSafeInteger(item.byteLength, "INVALID_LENGTH");
    const mediaType = metadata(item.mediaType, "INVALID_METADATA");
    if (typeof item.sha256 !== "string" || !hex64.test(item.sha256)) {
      fail("INVALID_HASH");
    }
    totalBytes += byteLength;
    if (totalBytes > MAX_PAYLOAD_BYTES) fail("PAYLOAD_LIMIT");
    return { path, mediaType, byteLength, sha256: item.sha256 };
  });
  checkPaths(normalizedFiles.map((file) => file.path));

  const fileEntries = normalizeEntries(descriptor.fileEntries, normalizedFiles);
  const exports = normalizeExports(descriptor.exports);
  if (descriptor.kind === "runtime" && exports.length !== 0) {
    fail("RUNTIME_EXPORTS");
  }
  const requiredRoles =
    descriptor.kind === "runtime" ? ["runtimeModule", "wasm"] : ["programSet"];
  for (const role of requiredRoles) {
    if (!fileEntries.some((entry) => entry.role === role)) fail("MISSING_ROLE");
  }

  const normalized = {
    schemaVersion,
    logicalId,
    kind: descriptor.kind,
    compatibility: normalizedCompatibility,
    files: normalizedFiles.sort((a, b) => compareUtf8(a.path, b.path)),
    fileEntries: fileEntries.sort((a, b) => compareUtf8(a.role, b.role)),
    exports: exports.sort((a, b) => compareUtf8(a.role, b.role)),
  };
  const encoded = encodeCanonical(normalized);
  if (encoded.byteLength > MAX_DESCRIPTOR_BYTES) {
    fail("DESCRIPTOR_LIMIT");
  }
  return { descriptor: normalized, encoded };
}

export function validateDescriptor(value) {
  return prepareDescriptor(value).descriptor;
}

export function encodeDescriptor(value) {
  return prepareDescriptor(value).encoded;
}

export function requireSha256() {
  const subtle = globalThis.crypto?.subtle;
  if (typeof subtle?.digest !== "function") {
    throw new Error(
      "WebCrypto SHA-256 is unavailable; serve resources in a secure context (HTTPS or trusted localhost)",
    );
  }
  return subtle;
}

export async function sha256Hex(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("SHA256 input must be a Uint8Array");
  }
  const subtle = requireSha256();
  const digest = new Uint8Array(
    await subtle.digest(
      "SHA-256",
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function descriptorContentId(value) {
  return encodedContentId(encodeDescriptor(value));
}

async function encodedContentId(encoded) {
  const input = new Uint8Array(DOMAIN_PREFIX.byteLength + encoded.byteLength);
  input.set(DOMAIN_PREFIX);
  input.set(encoded, DOMAIN_PREFIX.byteLength);
  return sha256Hex(input);
}

export async function validateEnvelope(value) {
  const envelope = requireObject(value, "INVALID_ENVELOPE");
  requireExactKeys(envelope, ["contentId", "descriptor"], "INVALID_ENVELOPE");
  if (typeof envelope.contentId !== "string") fail("CONTENT_ID_MISMATCH");
  const contentId = envelope.contentId;
  const { descriptor, encoded } = prepareDescriptor(envelope.descriptor);
  if (contentId !== (await encodedContentId(encoded))) {
    fail("CONTENT_ID_MISMATCH");
  }
  return { contentId, descriptor };
}

function normalizeEntries(value, files) {
  const entries = requireArray(value, "INVALID_ENTRIES");
  if (entries.length > MAX_FILES) fail("TOO_MANY_ROLES");
  const normalized = entries.map((entry) => {
    const item = requireObject(entry, "INVALID_ENTRY");
    requireExactKeys(item, entryKeys, "INVALID_ENTRY");
    const role = metadata(item.role, "INVALID_METADATA");
    const path = requireString(item.path, "INVALID_PATH");
    if (!files.some((file) => file.path === path)) fail("ENTRY_NOT_FOUND");
    return { role, path };
  });
  checkUniqueRoles(normalized);
  return normalized;
}

function normalizeExports(value) {
  const exports = requireArray(value, "INVALID_EXPORTS");
  if (exports.length > MAX_FILES) fail("TOO_MANY_ROLES");
  const normalized = exports.map((entry) => {
    const item = requireObject(entry, "INVALID_EXPORT");
    requireExactKeys(item, exportKeys, "INVALID_EXPORT");
    return {
      role: metadata(item.role, "INVALID_METADATA"),
      declaration: metadata(item.declaration, "INVALID_METADATA"),
      interfaceId: metadata(item.interfaceId, "INVALID_METADATA"),
    };
  });
  checkUniqueRoles(normalized);
  return normalized;
}

function checkPaths(paths) {
  const folded = new Set();
  for (const path of paths) {
    const lower = path.toLowerCase();
    if (folded.has(lower)) fail("DUPLICATE_PATH");
    folded.add(lower);
  }
  for (const path of paths) {
    const parts = path.toLowerCase().split("/");
    for (let index = 1; index < parts.length; index += 1) {
      if (folded.has(parts.slice(0, index).join("/"))) {
        fail("PATH_PREFIX_CONFLICT");
      }
    }
  }
  // Reject conflicting directory spellings without rewriting either inventory.
  const directories = new Map();
  for (const path of paths) {
    const parts = path.split("/");
    let parent = "";
    for (const part of parts.slice(0, -1)) {
      parent = parent === "" ? part : `${parent}/${part}`;
      const key = parent.toLowerCase();
      const previous = directories.get(key);
      if (previous !== undefined && previous !== parent) {
        fail("DIRECTORY_CASE_CONFLICT");
      }
      directories.set(key, parent);
    }
  }
}

function checkUniqueRoles(entries) {
  const roles = new Set();
  for (const { role } of entries) {
    if (roles.has(role)) fail("DUPLICATE_ROLE");
    roles.add(role);
  }
}

function requirePath(value) {
  const path = requireString(value, "INVALID_PATH");
  if (
    utf8Length(path) > MAX_METADATA_BYTES ||
    path.split("/", 1)[0].toLowerCase() === "bundle.json"
  ) {
    fail("INVALID_PATH");
  }
  for (const part of path.split("/")) {
    if (
      part.length === 0 ||
      part === "." ||
      part === ".." ||
      part.endsWith(".") ||
      !pathPart.test(part) ||
      deviceComponent(part)
    )
      fail("INVALID_PATH");
  }
  return path;
}

function deviceComponent(part) {
  const stem = part.toLowerCase().split(".", 1)[0];
  return (
    ["con", "prn", "aux", "nul"].includes(stem) || /^(com|lpt)[1-9]$/.test(stem)
  );
}

function metadata(value, code) {
  const string = requireString(value, code);
  if (string.length === 0 || utf8Length(string) > MAX_METADATA_BYTES)
    fail(code);
  return string;
}

function version(value) {
  const number = requireSafeInteger(value, "INVALID_VERSION");
  if (number <= 0) fail("INVALID_VERSION");
  return number;
}

function requireSafeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

function requireString(value, code) {
  if (typeof value !== "string" || !isScalarString(value)) fail(code);
  return value;
}

function isScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    if (unit > 0xdbff || index + 1 === value.length) return false;
    const next = value.charCodeAt(index + 1);
    if (next < 0xdc00 || next > 0xdfff) return false;
    index += 1;
  }
  return true;
}

function requireArray(value, code) {
  if (!Array.isArray(value)) fail(code);
  return value;
}

function requireObject(value, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(code);
  return value;
}

function requireExactKeys(value, expected, code) {
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    fail(code);
  }
}

function utf8Length(value) {
  return textEncoder.encode(value).byteLength;
}

function compareUtf8(left, right) {
  const a = textEncoder.encode(left);
  const b = textEncoder.encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function encodeCanonical(descriptor) {
  const compatibility = `{\"leanRevision\":${quote(descriptor.compatibility.leanRevision)},\"virVersion\":${descriptor.compatibility.virVersion}}`;
  const exports = descriptor.exports
    .map(
      (entry) =>
        `{\"declaration\":${quote(entry.declaration)},\"interfaceId\":${quote(entry.interfaceId)},\"role\":${quote(entry.role)}}`,
    )
    .join(",");
  const entries = descriptor.fileEntries
    .map(
      (entry) =>
        `{\"path\":${quote(entry.path)},\"role\":${quote(entry.role)}}`,
    )
    .join(",");
  const files = descriptor.files
    .map(
      (file) =>
        `{\"byteLength\":${file.byteLength},\"mediaType\":${quote(file.mediaType)},\"path\":${quote(file.path)},\"sha256\":${quote(file.sha256)}}`,
    )
    .join(",");
  return textEncoder.encode(
    `{\"compatibility\":${compatibility},\"exports\":[${exports}],\"fileEntries\":[${entries}],\"files\":[${files}],\"kind\":${quote(descriptor.kind)},\"logicalId\":${quote(descriptor.logicalId)},\"schemaVersion\":${descriptor.schemaVersion}}`,
  );
}

function quote(value) {
  let output = '"';
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0);
    if (scalar === '"' || scalar === "\\") output += `\\${scalar}`;
    else if (codePoint < 0x20)
      output += `\\u00${codePoint.toString(16).padStart(2, "0")}`;
    else output += scalar;
  }
  return `${output}"`;
}

function fail(code) {
  throw new Error(code);
}
