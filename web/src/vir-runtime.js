/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { VirRuntime } from "./runtime/core.js";
import { asBytes } from "./runtime/vir-codec.js";
import { VirHostState } from "./runtime/host-state.js";
import {
  collectCleanupError,
  throwCollectedErrors,
} from "./runtime/cleanup.js";
import { disposeHostBindings } from "./host-boundary.js";
import { createBrowserHostBindings } from "./vir-host-bindings.js";

export {
  hasExternrefTableSupport,
  requireExternrefTableSupport,
} from "./vir-host-bindings.js";
export { VIR_HOST_DISPOSE } from "./host-boundary.js";
export {
  PACKAGE_TARGET_MODE,
  formatPackageTarget,
  packageTargetModeLabel,
} from "./runtime/package-targets.js";

export const VIR_WASM_RELEASE_FILE = "vir-upstream.wasm";
export const VIR_WASM_DEV_FILE = "vir-upstream.dev.wasm";

export const IR_PACKAGE_SET_FORMAT = "lean-vir-ir-package-set";
export const IR_PACKAGE_SET_VERSION = 2;
const fetchedPackageSetBrand = Symbol("VIR fetched package set");

function rejectUnknownOptions(options, label) {
  const names = Object.keys(options);
  if (names.length !== 0) {
    throw new TypeError(
      `${label} received unknown option${names.length === 1 ? "" : "s"}: ${names.join(", ")}`,
    );
  }
}

export async function fetchBytes(path, init = { cache: "no-store" }) {
  const response = await fetch(path, init);
  if (!response.ok) {
    const status = response.statusText
      ? `${response.status} ${response.statusText}`
      : String(response.status);
    throw new Error(`failed to load ${path}: HTTP ${status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function debugWasmUrlFor(wasmUrl = VIR_WASM_RELEASE_FILE) {
  const value = wasmUrl instanceof URL ? wasmUrl.href : String(wasmUrl);
  const match = /(\.wasm)([?#].*)?$/.exec(value);
  if (match === null) {
    throw new Error(
      "debugWasm requires a .wasm wasmUrl or an explicit wasmDebugUrl",
    );
  }
  return `${value.slice(0, match.index)}.dev.wasm${match[2] ?? ""}`;
}

export function createVirImports(module, overrides = {}, hostState = null) {
  const imports = {};

  for (const spec of WebAssembly.Module.imports(module)) {
    imports[spec.module] ??= {};
    if (spec.kind === "function") {
      imports[spec.module][spec.name] = (...args) => {
        if (
          spec.module === "wasi_snapshot_preview1" &&
          spec.name === "proc_exit"
        ) {
          throw new Error(`WASI proc_exit(${args[0]})`);
        }
        if (spec.module === "env" && spec.name === "vir_js_call_objects") {
          throw new Error(
            "Vir JavaScript host import called without an attached host state",
          );
        }
        return 0;
      };
    }
  }

  for (const [moduleName, moduleImports] of Object.entries(overrides)) {
    imports[moduleName] = {
      ...(imports[moduleName] ?? {}),
      ...moduleImports,
    };
  }

  if (hostState !== null) {
    imports.env ??= {};
    imports.env.vir_js_call_objects = (slot, argvPtr, argc) => {
      try {
        return hostState.callObjects(slot, argvPtr, argc);
      } catch (error) {
        hostState.recordCallError(error);
        return 0;
      }
    };
    imports.env.vir_resource_root = (value) => hostState.rootResource(value);
    imports.env.vir_resource_get = (rootId) =>
      hostState.getRootedResource(rootId);
    imports.env.vir_resource_release = (rootId) =>
      hostState.releaseRootedResourceFromFinalizer(rootId);
  }

  return imports;
}

export function createVirRuntimeFactory(options = {}) {
  return new VirRuntimeFactory(options);
}

export async function createVirRuntime(options = {}) {
  const { irPackageSet = null, ...factoryOptions } = options;
  const factory = createVirRuntimeFactory(factoryOptions);
  return factory.createRuntime({ irPackageSet });
}

export class VirRuntimeFactory {
  constructor(options = {}) {
    const {
      wasmBytes = null,
      wasmModule = null,
      wasmUrl = null,
      wasmDebugUrl = null,
      debugWasm = false,
      fetchBytes: loadBytes = fetchBytes,
      imports = null,
      hostBindings = null,
      defaultHostBindings = null,
      ...unknownOptions
    } = options;
    rejectUnknownOptions(unknownOptions, "VirRuntimeFactory");
    this.wasmBytes = wasmBytes;
    this.wasmModule = wasmModule;
    this.debugWasm = debugWasm;
    this.wasmUrl = selectWasmUrl({ wasmUrl, wasmDebugUrl, debugWasm });
    this.fetchBytes = loadBytes;
    this.imports = imports;
    this.hostBindings = hostBindings;
    this.defaultHostBindings = defaultHostBindings;
    this.hostBindingsLease = new HostBindingsLease(hostBindings);
    this.defaultHostBindingsLease =
      defaultHostBindings !== null && typeof defaultHostBindings !== "function"
        ? new HostBindingsLease(defaultHostBindings)
        : null;
  }

  async module() {
    if (this.wasmModule !== null) {
      return this.wasmModule;
    }
    if (this.wasmBytes === null) {
      if (this.wasmUrl === null) {
        throw new Error("wasmUrl, wasmBytes, or wasmModule is required");
      }
      this.wasmBytes = await this.fetchBytes(this.wasmUrl);
    }
    this.wasmModule = new WebAssembly.Module(
      asBytes(this.wasmBytes, "wasmBytes"),
    );
    return this.wasmModule;
  }

  async instantiate() {
    const module = await this.module();
    return this.instantiateModule(module);
  }

  instantiateModule(module) {
    const defaultHostBindings =
      typeof this.defaultHostBindings === "function"
        ? this.defaultHostBindings()
        : (this.defaultHostBindings ?? createBrowserHostBindings());
    const defaultHostBindingsLease =
      this.defaultHostBindingsLease ??
      new HostBindingsLease(defaultHostBindings);
    const hostBindings = this.hostBindingsLease.acquire();
    const defaultBindings = defaultHostBindingsLease.acquire();
    let hostState = null;
    try {
      hostState = new VirHostState({
        hostBindings: hostBindings.value,
        defaultHostBindings: defaultBindings.value,
        releaseHostBindings: hostBindings.release,
        releaseDefaultHostBindings: defaultBindings.release,
      });
      const imports =
        typeof this.imports === "function"
          ? this.imports(module, hostState)
          : createVirImports(module, this.imports ?? {}, hostState);
      const instance = new WebAssembly.Instance(module, imports);
      hostState.attach(instance.exports);
      instance.exports.__wasm_call_ctors?.();
      return new VirRuntime(instance.exports, {
        module,
        hostState,
        createReplacementRuntime: () => this.instantiateModule(module),
      });
    } catch (error) {
      const errors = [error];
      if (hostState !== null) {
        collectCleanupError(errors, () => hostState.dispose());
      } else {
        collectCleanupError(errors, () => releaseBindings(defaultBindings));
        collectCleanupError(errors, () => releaseBindings(hostBindings));
      }
      throwCollectedErrors(
        errors,
        "VirRuntime instantiation failed during cleanup",
      );
    }
  }

  async createRuntime(options = {}) {
    const { irPackageSet = null, ...unknownOptions } = options;
    rejectUnknownOptions(unknownOptions, "VirRuntimeFactory.createRuntime");
    const packageSet =
      irPackageSet === null
        ? null
        : await resolvePackageSetInput(this, irPackageSet);
    const runtime = await this.instantiate();
    try {
      if (packageSet !== null) {
        runtime.loadIrPackageSetBytes(packageSet.bytes, packageSet.info);
      }
      return runtime;
    } catch (error) {
      const errors = [error];
      collectCleanupError(errors, () => runtime.dispose());
      throwCollectedErrors(errors, "VirRuntime creation failed during cleanup");
    }
  }

  async fetchIrPackageSet(descriptorUrl) {
    const descriptorBytes = await this.fetchBytes(descriptorUrl);
    const descriptor = parseIrPackageSetDescriptor(descriptorBytes);
    const members = await Promise.all(
      descriptor.packages.map(async (entry) => {
        const url = resolvePackageSetUrl(entry.path, descriptorUrl);
        const bytes = Uint8Array.from(
          asBytes(
            await this.fetchBytes(url),
            `IR package-set member ${entry.module}`,
          ),
        );
        if (bytes.byteLength !== entry.byteLength) {
          throw new Error(
            `IR package-set member ${entry.module} has ${bytes.byteLength} bytes; ` +
              `expected ${entry.byteLength}`,
          );
        }
        const actualSha256 = await sha256Hex(bytes);
        if (actualSha256 !== entry.sha256) {
          throw new Error(
            `IR package-set member ${entry.module} checksum mismatch: ` +
              `expected ${entry.sha256}, got ${actualSha256}`,
          );
        }
        return Object.freeze({ ...entry, url, bytes });
      }),
    );
    return Object.freeze({
      [fetchedPackageSetBrand]: true,
      format: descriptor.format,
      version: descriptor.version,
      descriptorUrl,
      members: Object.freeze(members),
    });
  }
}

async function resolvePackageSetInput(factory, input) {
  if (Array.isArray(input)) {
    if (input.length === 0) {
      throw new TypeError(
        "irPackageSet byte input must be a non-empty array ordered dependencies first, root last",
      );
    }
    return {
      bytes: input.map((bytes, index) =>
        asBytes(bytes, `irPackageSet member ${index + 1}`),
      ),
      info: null,
    };
  }
  if (typeof input === "string" || input instanceof URL) {
    const fetched = await factory.fetchIrPackageSet(input);
    return {
      bytes: await packageSetMemberBytes(fetched, { verify: false }),
      info: runtimePackageSetInfo(fetched),
    };
  }
  return {
    bytes: await packageSetMemberBytes(input),
    info: runtimePackageSetInfo(input),
  };
}

const packageSetTextDecoder = new TextDecoder();

function parseIrPackageSetDescriptor(bytes) {
  let descriptor;
  try {
    descriptor = JSON.parse(
      packageSetTextDecoder.decode(asBytes(bytes, "IR package-set descriptor")),
    );
  } catch (error) {
    throw new Error(`invalid IR package-set descriptor JSON: ${error.message}`);
  }
  if (
    descriptor === null ||
    typeof descriptor !== "object" ||
    Array.isArray(descriptor)
  ) {
    throw new Error("IR package-set descriptor must be a JSON object");
  }
  if (descriptor.format !== IR_PACKAGE_SET_FORMAT) {
    throw new Error(
      `unsupported IR package-set descriptor format ${JSON.stringify(descriptor.format)}; ` +
        `expected ${JSON.stringify(IR_PACKAGE_SET_FORMAT)}`,
    );
  }
  if (descriptor.version !== IR_PACKAGE_SET_VERSION) {
    throw new Error(
      `unsupported IR package-set descriptor version ${JSON.stringify(descriptor.version)}; ` +
        `expected ${IR_PACKAGE_SET_VERSION}`,
    );
  }
  if (!Array.isArray(descriptor.packages) || descriptor.packages.length === 0) {
    throw new Error("IR package-set descriptor must list at least one package");
  }
  const modules = new Set();
  const paths = new Set();
  for (const [index, entry] of descriptor.packages.entries()) {
    const label = `IR package-set descriptor entry ${index + 1}`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label} must be an object`);
    }
    requireNormalizedModuleName(entry.module, label);
    if (modules.has(entry.module)) {
      throw new Error(
        `${label} duplicates module ${JSON.stringify(entry.module)}`,
      );
    }
    modules.add(entry.module);
    if (typeof entry.path !== "string" || entry.path.trim() === "") {
      throw new Error(`${label} has no path`);
    }
    requireNormalizedPackageSetPath(entry.path, label);
    if (paths.has(entry.path)) {
      throw new Error(`${label} duplicates path ${JSON.stringify(entry.path)}`);
    }
    paths.add(entry.path);
    if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength <= 0) {
      throw new Error(`${label}.byteLength must be a positive safe integer`);
    }
    if (
      typeof entry.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(entry.sha256)
    ) {
      throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`);
    }
    const expectedRole =
      index === descriptor.packages.length - 1 ? "root" : "dependency";
    if (entry.role !== expectedRole) {
      throw new Error(
        `${label} must have role ${JSON.stringify(expectedRole)}, got ${JSON.stringify(entry.role)}`,
      );
    }
  }
  return descriptor;
}

function resolvePackageSetUrl(path, descriptorUrl) {
  const base =
    descriptorUrl instanceof URL
      ? descriptorUrl
      : new URL(String(descriptorUrl), globalThis.location?.href ?? "file:///");
  return new URL(path, base);
}

function requireNormalizedPackageSetPath(path, label) {
  const parts = path.split("/");
  if (
    path !== path.trim() ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes(":") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("%") ||
    /[\u0000-\u0020\u007f]/u.test(path) ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${label}.path must be a normalized relative path`);
  }
}

function requireNormalizedModuleName(moduleName, label) {
  if (typeof moduleName !== "string" || moduleName.trim() === "") {
    throw new Error(`${label} has no module`);
  }
  if (
    moduleName !== moduleName.trim() ||
    /[\u0000-\u001f\u007f/\\:#?%]/u.test(moduleName)
  ) {
    throw new Error(`${label}.module must be a normalized Lean module name`);
  }
  let offset = 0;
  while (offset < moduleName.length) {
    if (moduleName[offset] === "«") {
      const end = moduleName.indexOf("»", offset + 1);
      if (end === offset + 1 || end < 0) {
        throw new Error(
          `${label}.module must be a normalized Lean module name`,
        );
      }
      offset = end + 1;
    } else {
      const end = moduleName.indexOf(".", offset);
      const component = moduleName.slice(
        offset,
        end < 0 ? moduleName.length : end,
      );
      if (component === "" || /[\s«»]/u.test(component)) {
        throw new Error(
          `${label}.module must be a normalized Lean module name`,
        );
      }
      offset += component.length;
    }
    if (offset === moduleName.length) return;
    if (moduleName[offset] !== "." || offset + 1 === moduleName.length) {
      throw new Error(`${label}.module must be a normalized Lean module name`);
    }
    offset += 1;
  }
}

async function packageSetMemberBytes(packageSet, { verify = true } = {}) {
  if (
    packageSet === null ||
    typeof packageSet !== "object" ||
    packageSet[fetchedPackageSetBrand] !== true ||
    packageSet.format !== IR_PACKAGE_SET_FORMAT ||
    packageSet.version !== IR_PACKAGE_SET_VERSION ||
    !Array.isArray(packageSet.members) ||
    packageSet.members.length === 0
  ) {
    throw new TypeError("irPackageSet must be a fetched package-set object");
  }
  return Promise.all(
    packageSet.members.map(async (member, index) => {
      if (
        member === null ||
        typeof member !== "object" ||
        member.bytes === undefined
      ) {
        throw new TypeError(`irPackageSet member ${index + 1} has no bytes`);
      }
      const bytes = asBytes(member.bytes, `irPackageSet member ${index + 1}`);
      if (bytes.byteLength !== member.byteLength) {
        throw new Error(
          `irPackageSet member ${index + 1} no longer matches its integrity metadata`,
        );
      }
      if (verify && (await sha256Hex(bytes)) !== member.sha256) {
        throw new Error(
          `irPackageSet member ${index + 1} no longer matches its integrity metadata`,
        );
      }
      return bytes;
    }),
  );
}

function runtimePackageSetInfo(packageSet) {
  return Object.freeze({
    format: packageSet.format,
    version: packageSet.version,
    descriptorUrl: String(packageSet.descriptorUrl),
    members: Object.freeze(
      packageSet.members.map(({ bytes: _bytes, url, ...member }) =>
        Object.freeze({ ...member, url: String(url) }),
      ),
    ),
  });
}

async function sha256Hex(bytes) {
  if (globalThis.crypto?.subtle === undefined) {
    throw new Error("SHA-256 verification requires Web Crypto support");
  }
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

class HostBindingsLease {
  constructor(value) {
    this.value = value;
    this.references = 0;
  }

  acquire() {
    this.references += 1;
    let live = true;
    return {
      value: this.value,
      release: () => {
        if (!live) return false;
        live = false;
        this.references -= 1;
        return this.references === 0;
      },
    };
  }
}

function releaseBindings(bindings) {
  if (bindings.release()) disposeHostBindings(bindings.value);
}

function selectWasmUrl({ wasmUrl, wasmDebugUrl, debugWasm }) {
  if (debugWasm) {
    return wasmDebugUrl ?? debugWasmUrlFor(wasmUrl ?? VIR_WASM_RELEASE_FILE);
  }
  return wasmUrl ?? VIR_WASM_RELEASE_FILE;
}
