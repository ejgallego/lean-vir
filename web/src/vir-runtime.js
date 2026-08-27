/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { VirRuntime } from "./runtime/core.js";
import { asBytes } from "./runtime/vir-codec.js";
import { VirHostState } from "./runtime/host-state.js";
import { collectCleanupError, throwCollectedErrors } from "./runtime/cleanup.js";
import { createBrowserHostBindings } from "./vir-browser-host-bindings.js";

export {
  hasExternrefTableSupport,
  requireExternrefTableSupport,
} from "./vir-browser-host-bindings.js";
export {
  releaseHostResource,
  VIR_HOST_DISPOSE,
} from "./host-resource.js";
export {
  VirCallback,
} from "./runtime/callbacks.js";

export const VIR_WASM_RELEASE_FILE = "vir-upstream.wasm";
export const VIR_WASM_DEV_FILE = "vir-upstream.dev.wasm";

export const IR_PACKAGE_SET_FORMAT = "lean-vir-ir-package-set";
export const IR_PACKAGE_SET_VERSION = 1;

function rejectUnknownOptions(options, label) {
  const names = Object.keys(options);
  if (names.length !== 0) {
    throw new TypeError(`${label} received unknown option${names.length === 1 ? "" : "s"}: ${names.join(", ")}`);
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
    throw new Error("debugWasm requires a .wasm wasmUrl or an explicit wasmDebugUrl");
  }
  return `${value.slice(0, match.index)}.dev.wasm${match[2] ?? ""}`;
}

export function createVirImports(module, overrides = {}, hostState = null) {
  const imports = {};

  for (const spec of WebAssembly.Module.imports(module)) {
    imports[spec.module] ??= {};
    if (spec.kind === "function") {
      imports[spec.module][spec.name] = (...args) => {
        if (spec.module === "wasi_snapshot_preview1" && spec.name === "proc_exit") {
          throw new Error(`WASI proc_exit(${args[0]})`);
        }
        if (spec.module === "env" && spec.name === "vir_js_call_objects") {
          throw new Error("Vir JavaScript host import called without an attached host state");
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
    imports.env.vir_resource_root = (value, owned) => hostState.rootResource(value, owned);
    imports.env.vir_resource_get = (rootId, take) => hostState.getRootedResource(rootId, take);
    imports.env.vir_resource_is_owned = (rootId) => hostState.rootedResourceIsOwned(rootId);
    imports.env.vir_resource_release = (rootId) => hostState.releaseRootedResourceFromFinalizer(rootId);
  }

  return imports;
}

export function createVirRuntimeFactory(options = {}) {
  return new VirRuntimeFactory(options);
}

export async function createVirRuntime(options = {}) {
  const {
    irPackageSetBytes,
    irPackageSetUrl,
    ...factoryOptions
  } = options;
  const factory = createVirRuntimeFactory(factoryOptions);
  return factory.createRuntime({
    irPackageSetBytes,
    irPackageSetUrl,
  });
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
    this.wasmModule = new WebAssembly.Module(asBytes(this.wasmBytes, "wasmBytes"));
    return this.wasmModule;
  }

  async instantiate() {
    const module = await this.module();
    return this.instantiateModule(module);
  }

  instantiateModule(module, { disposeBindingsOnFailure = true } = {}) {
    const hostBindings = this.hostBindingsLease.acquire();
    const defaultHostBindings =
      typeof this.defaultHostBindings === "function"
        ? this.defaultHostBindings()
        : (this.defaultHostBindings ?? createBrowserHostBindings());
    const defaultHostBindingsLease = this.defaultHostBindingsLease ?? new HostBindingsLease(defaultHostBindings);
    const defaultBindings = defaultHostBindingsLease.acquire();
    const hostState = new VirHostState({
      hostBindings: hostBindings.value,
      defaultHostBindings: defaultBindings.value,
      releaseHostBindings: hostBindings.release,
      releaseDefaultHostBindings: defaultBindings.release,
    });
    try {
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
        createReplacementRuntime: () => this.instantiateModule(module, {
          disposeBindingsOnFailure: false,
        }),
      });
    } catch (error) {
      const errors = [error];
      collectCleanupError(errors, () => hostState.dispose({ disposeBindings: disposeBindingsOnFailure }));
      throwCollectedErrors(errors, "VirRuntime instantiation failed during cleanup");
    }
  }

  async createRuntime(options = {}) {
    const {
      irPackageSetBytes = null,
      irPackageSetUrl = null,
      ...unknownOptions
    } = options;
    rejectUnknownOptions(unknownOptions, "VirRuntimeFactory.createRuntime");
    const runtime = await this.instantiate();
    try {
      if (irPackageSetBytes !== null && irPackageSetUrl !== null) {
        throw new Error("provide exactly one IR package-set input");
      }
      if (irPackageSetBytes !== null) {
        runtime.loadIrPackageSetBytes(irPackageSetBytes);
      } else if (irPackageSetUrl !== null) {
        const packages = await this.fetchIrPackageSet(irPackageSetUrl);
        runtime.loadIrPackageSetBytes(packages);
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
    return Promise.all(descriptor.packages.map((entry) =>
      this.fetchBytes(resolvePackageSetUrl(entry.path, descriptorUrl))));
  }
}

const packageSetTextDecoder = new TextDecoder();

function parseIrPackageSetDescriptor(bytes) {
  let descriptor;
  try {
    descriptor = JSON.parse(packageSetTextDecoder.decode(asBytes(bytes, "IR package-set descriptor")));
  } catch (error) {
    throw new Error(`invalid IR package-set descriptor JSON: ${error.message}`);
  }
  if (descriptor === null || typeof descriptor !== "object" || Array.isArray(descriptor)) {
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
    if (typeof entry.module !== "string" || entry.module.trim() === "") {
      throw new Error(`${label} has no module`);
    }
    if (modules.has(entry.module)) {
      throw new Error(`${label} duplicates module ${JSON.stringify(entry.module)}`);
    }
    modules.add(entry.module);
    if (typeof entry.path !== "string" || entry.path.trim() === "") {
      throw new Error(`${label} has no path`);
    }
    if (paths.has(entry.path)) {
      throw new Error(`${label} duplicates path ${JSON.stringify(entry.path)}`);
    }
    paths.add(entry.path);
    const expectedRole = index === descriptor.packages.length - 1 ? "root" : "dependency";
    if (entry.role !== expectedRole) {
      throw new Error(
        `${label} must have role ${JSON.stringify(expectedRole)}, got ${JSON.stringify(entry.role)}`,
      );
    }
  }
  return descriptor;
}

function resolvePackageSetUrl(path, descriptorUrl) {
  const base = descriptorUrl instanceof URL
    ? descriptorUrl
    : new URL(String(descriptorUrl), globalThis.location?.href ?? "file:///");
  return new URL(path, base);
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

function selectWasmUrl({ wasmUrl, wasmDebugUrl, debugWasm }) {
  if (debugWasm) {
    return wasmDebugUrl ?? debugWasmUrlFor(wasmUrl ?? VIR_WASM_RELEASE_FILE);
  }
  return wasmUrl ?? VIR_WASM_RELEASE_FILE;
}
