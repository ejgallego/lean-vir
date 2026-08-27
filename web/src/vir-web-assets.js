/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const VIR_WEB_ASSETS_FORMAT = "lean-vir-web-assets";
export const VIR_WEB_ASSETS_VERSION = 1;

const COMPATIBILITY_NAT_FIELDS = [
  "packageFormatVersion",
  "manifestVersion",
  "runtimeAbiVersion",
];
const COMPATIBILITY_STRING_FIELDS = [
  "leanVersion",
  "leanToolchain",
  "leanGithash",
];

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireNat(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a natural number`);
  }
  return value;
}

function requireRelativePath(value, label) {
  const path = requireString(value, label);
  const components = path.split("/");
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    components.some((component) => component === "" || component === "." || component === "..")
  ) {
    throw new TypeError(`${label} must be a normalized relative URL path`);
  }
  return path;
}

function validateCompatibility(value, label) {
  const compatibility = requireObject(value, label);
  for (const field of COMPATIBILITY_NAT_FIELDS) {
    requireNat(compatibility[field], `${label}.${field}`);
  }
  for (const field of COMPATIBILITY_STRING_FIELDS) {
    requireString(compatibility[field], `${label}.${field}`);
  }
  return compatibility;
}

function validateFileRecords(value, label, prefix) {
  const records = requireArray(value, label);
  if (records.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
  const paths = new Set();
  for (const [index, entry] of records.entries()) {
    const record = requireObject(entry, `${label}[${index}]`);
    const path = requireRelativePath(record.path, `${label}[${index}].path`);
    if (!path.startsWith(prefix)) {
      throw new TypeError(`${label}[${index}].path must be under ${prefix}`);
    }
    if (paths.has(path)) {
      throw new TypeError(`${label} contains duplicate path ${path}`);
    }
    paths.add(path);
    if (typeof record.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.sha256)) {
      throw new TypeError(`${label}[${index}].sha256 must be a lowercase SHA-256 digest`);
    }
    requireNat(record.byteSize, `${label}[${index}].byteSize`);
  }
  return paths;
}

function requireListedPath(container, field, paths, label) {
  const path = requireRelativePath(container[field], `${label}.${field}`);
  if (!paths.has(path)) {
    throw new TypeError(`${label}.${field} is not listed in ${label}.files`);
  }
  return path;
}

function assertCompatible(program, sdk, label) {
  for (const field of [...COMPATIBILITY_NAT_FIELDS, "leanVersion", "leanGithash"]) {
    if (program[field] !== sdk[field]) {
      throw new TypeError(`${label} compatibility mismatch for ${field}`);
    }
  }
}

export function validateVirWebAssetsManifest(value) {
  const manifest = requireObject(value, "VIR web-assets manifest");
  if (manifest.format !== VIR_WEB_ASSETS_FORMAT) {
    throw new TypeError(`unsupported VIR web-assets format: ${String(manifest.format)}`);
  }
  if (manifest.version !== VIR_WEB_ASSETS_VERSION) {
    throw new TypeError(`unsupported VIR web-assets version: ${String(manifest.version)}`);
  }
  requireString(manifest.hostPackage, "VIR web-assets manifest.hostPackage");
  const vir = requireObject(manifest.vir, "VIR web-assets manifest.vir");
  const virVersion = requireString(vir.version, "VIR web-assets manifest.vir.version");
  const virCommit = requireString(vir.gitCommit, "VIR web-assets manifest.vir.gitCommit");

  const sdk = requireObject(manifest.sdk, "VIR web-assets manifest.sdk");
  const sdkVersion = requireString(sdk.version, "VIR web-assets manifest.sdk.version");
  const sdkCommit = requireString(sdk.gitCommit, "VIR web-assets manifest.sdk.gitCommit");
  if (sdkVersion !== virVersion || sdkCommit !== virCommit) {
    throw new TypeError("VIR web-assets manifest SDK does not match its lean_vir identity");
  }
  const sdkCompatibility = validateCompatibility(
    sdk.compatibility,
    "VIR web-assets manifest.sdk.compatibility",
  );
  const sdkFiles = validateFileRecords(
    sdk.files,
    "VIR web-assets manifest.sdk.files",
    "sdk/",
  );
  requireListedPath(sdk, "manifest", sdkFiles, "VIR web-assets manifest.sdk");
  requireListedPath(sdk, "webAssetsModule", sdkFiles, "VIR web-assets manifest.sdk");
  requireListedPath(sdk, "runtimeModule", sdkFiles, "VIR web-assets manifest.sdk");
  requireListedPath(sdk, "wasm", sdkFiles, "VIR web-assets manifest.sdk");

  const programs = requireArray(
    manifest.programs,
    "VIR web-assets manifest.programs",
  );
  if (programs.length === 0) {
    throw new TypeError("VIR web-assets manifest.programs must not be empty");
  }
  const programIds = new Set();
  for (const [index, entry] of programs.entries()) {
    const label = `VIR web-assets manifest.programs[${index}]`;
    const program = requireObject(entry, label);
    const id = requireString(program.id, `${label}.id`);
    if (!/^[A-Za-z0-9._-]+$/.test(id) || id === "." || id === "..") {
      throw new TypeError(`${label}.id must be a URL-safe slug`);
    }
    if (programIds.has(id)) {
      throw new TypeError(`VIR web-assets manifest contains duplicate program id ${id}`);
    }
    programIds.add(id);
    requireString(program.package, `${label}.package`);
    requireString(program.module, `${label}.module`);
    const compatibility = validateCompatibility(
      program.compatibility,
      `${label}.compatibility`,
    );
    assertCompatible(compatibility, sdkCompatibility, label);
    const files = validateFileRecords(program.files, `${label}.files`, `programs/${id}/`);
    requireListedPath(program, "descriptor", files, label);
  }
  return manifest;
}

function resolveManifestUrl(value) {
  if (value instanceof URL) {
    return value;
  }
  const base = globalThis.document?.baseURI ?? globalThis.location?.href;
  if (base === undefined) {
    throw new TypeError("a relative VIR web-assets manifest URL requires a document or location base URL");
  }
  return new URL(value, base);
}

export async function loadVirWebAssetsManifest(
  manifestUrl,
  { fetchManifest = globalThis.fetch } = {},
) {
  if (typeof fetchManifest !== "function") {
    throw new TypeError("fetchManifest must be a function");
  }
  const url = resolveManifestUrl(manifestUrl);
  const response = await fetchManifest(url);
  if (!response.ok) {
    const status = response.statusText
      ? `${response.status} ${response.statusText}`
      : String(response.status);
    throw new Error(`failed to load VIR web-assets manifest: HTTP ${status}`);
  }
  return {
    manifest: validateVirWebAssetsManifest(await response.json()),
    manifestUrl: url,
  };
}

export async function createVirWebAssetsFactory(manifestUrl, options = {}) {
  const { fetchManifest = globalThis.fetch, ...factoryOptions } = options;
  for (const field of ["wasmUrl", "wasmBytes", "wasmModule", "wasmDebugUrl", "debugWasm"]) {
    if (Object.hasOwn(factoryOptions, field)) {
      throw new TypeError(`${field} is selected by VIR_WEB_ASSETS.json`);
    }
  }
  const loaded = await loadVirWebAssetsManifest(manifestUrl, { fetchManifest });
  const runtimeModuleUrl = new URL(loaded.manifest.sdk.runtimeModule, loaded.manifestUrl);
  const runtimeModule = await import(runtimeModuleUrl.href);
  if (typeof runtimeModule.createVirRuntimeFactory !== "function") {
    throw new TypeError("staged VIR runtime module does not export createVirRuntimeFactory");
  }
  const factory = runtimeModule.createVirRuntimeFactory({
    ...factoryOptions,
    wasmUrl: new URL(loaded.manifest.sdk.wasm, loaded.manifestUrl),
  });
  return Object.freeze({
    manifest: loaded.manifest,
    programIds: Object.freeze(loaded.manifest.programs.map((program) => program.id)),
    createRuntime(programId) {
      let selectedId = programId;
      if (selectedId === undefined) {
        if (loaded.manifest.programs.length !== 1) {
          throw new Error(
            `VIR web-assets program id is required; available programs: ${loaded.manifest.programs.map((program) => program.id).join(", ")}`,
          );
        }
        selectedId = loaded.manifest.programs[0].id;
      }
      if (typeof selectedId !== "string" || selectedId.length === 0) {
        throw new TypeError("VIR web-assets program id must be a non-empty string");
      }
      const program = loaded.manifest.programs.find((candidate) => candidate.id === selectedId);
      if (program === undefined) {
        throw new Error(`unknown VIR web-assets program: ${selectedId}`);
      }
      return factory.createRuntime({
        irPackageSetUrl: new URL(program.descriptor, loaded.manifestUrl),
      });
    },
  });
}

export async function createVirWebAssetsRuntime(manifestUrl, programIdOrOptions, options = {}) {
  let programId = programIdOrOptions;
  if (programIdOrOptions !== null && typeof programIdOrOptions === "object") {
    programId = undefined;
    options = programIdOrOptions;
  }
  const factory = await createVirWebAssetsFactory(manifestUrl, options);
  return factory.createRuntime(programId);
}
