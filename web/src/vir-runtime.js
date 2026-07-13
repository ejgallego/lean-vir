/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { VirRuntime } from "./runtime/core.js";
import { asBytes } from "./runtime/vir-codec.js";
import { VirHostState } from "./runtime/host-state.js";
import { createBrowserHostBindings } from "./vir-host-bindings.js";

export {
  hasExternrefTableSupport,
  requireExternrefTableSupport,
} from "./vir-host-bindings.js";
export {
  VIR_HOST_DISPOSE,
} from "./host-resource.js";
export {
  VirCallback,
} from "./runtime/callbacks.js";

export const VIR_WASM_RELEASE_FILE = "vir-upstream.wasm";
export const VIR_WASM_DEV_FILE = "vir-upstream.dev.wasm";

export async function fetchBytes(path, init = { cache: "no-store" }) {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(`failed to load ${path}`);
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
    imports.env.vir_resource_root = (value) => hostState.rootResource(value);
    imports.env.vir_resource_get = (rootId) => hostState.getRootedResource(rootId);
    imports.env.vir_resource_release = (rootId) => hostState.releaseRootedResource(rootId);
  }

  return imports;
}

export function createVirRuntimeFactory(options = {}) {
  return new VirRuntimeFactory(options);
}

export async function createVirRuntime(options = {}) {
  const { irPackageBytes, irPackageUrl, ...factoryOptions } = options;
  const factory = createVirRuntimeFactory(factoryOptions);
  return factory.createRuntime({ irPackageBytes, irPackageUrl });
}

export class VirRuntimeFactory {
  constructor({
    wasmBytes = null,
    wasmModule = null,
    wasmUrl = null,
    wasmDebugUrl = null,
    debugWasm = false,
    fetchBytes: loadBytes = fetchBytes,
    imports = null,
    hostBindings = null,
    defaultHostBindings = null,
  } = {}) {
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
      hostState.dispose({ disposeBindings: disposeBindingsOnFailure });
      throw error;
    }
  }

  async createRuntime({ irPackageBytes = null, irPackageUrl = null } = {}) {
    const runtime = await this.instantiate();
    try {
      if (irPackageBytes !== null || irPackageUrl !== null) {
        const bytes = irPackageBytes ?? (await this.fetchBytes(irPackageUrl));
        runtime.loadIrPackageBytes(bytes);
      }
      return runtime;
    } catch (error) {
      runtime.dispose();
      throw error;
    }
  }
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
