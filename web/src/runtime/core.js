/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { validateInterfaceManifest } from "./interface-manifest.js";
import { validateIrPackageSetMembers } from "./ir-package.js";
import { encodePackageContract } from "./package-contract.js";
import { releaseCallbackRoots } from "./callbacks.js";
import { RuntimeCallTiming } from "./call-timing.js";
import { asError, collectCleanupError, throwCollectedErrors } from "./cleanup.js";
import { ObjectValueRuntime } from "./object-values.js";
import {
  asBytes,
  requireFunctionArgs,
  requireFunctionResult,
} from "./vir-codec.js";
import {
  objectArgumentSupported,
  objectResultSupported,
} from "./object-abi.js";

const runtimeBoundaries = new WeakMap();
const textDecoder = new TextDecoder();
const MAX_UINT32 = 0xffffffffn;
const MAX_UINT64 = 0xffffffffffffffffn;

export class VirRuntime extends ObjectValueRuntime {
  constructor(
    exports,
    {
      module = null,
      packageInfo = null,
      hostState = null,
    } = {},
  ) {
    super();
    const boundary = guardWasmExports(exports, hostState);
    runtimeBoundaries.set(this, boundary);
    this.exports = boundary.exports;
    this.module = module;
    this.hostState = hostState;
    this.packageInfo = packageInfo;
    this.interfaceManifest = null;
    this.packageMetadata = null;
    this.exportsByName = Object.create(null);
    this.entriesByName = Object.create(null);
    this.entryCallCache = new WeakMap();
    this.startupState = "pending";
    this.startupError = null;
    this.disposed = false;
    this.disposing = false;
    this.liveCallbacks = new Set();
    this.hostState?.attachRuntime(this);
    this.hostState?.attach(this.exports);

    if (!this.exports.memory) {
      throw new Error("WASM memory export is missing");
    }
    if (
      typeof this.exports.vir_package_interface_manifest_size === "function" &&
      this.exports.vir_package_interface_manifest_size() !== 0
    ) {
      this.interfaceManifest = this.readPackageManifest();
      this.hostState?.setManifest(this.interfaceManifest);
      this.packageMetadata = this.interfaceManifest.metadata;
      this.rebuildManifestExports();
    }
  }

  targetPointerBytes() {
    return this.exports.vir_upstream_target_pointer_bytes?.() ?? null;
  }

  packageDeclCount() {
    return this.exports.vir_package_decl_count?.() ?? null;
  }

  lastPackageError() {
    const len = this.exports.vir_last_package_error_size?.() ?? 0;
    return len === 0
      ? ""
      : this.readWasmString(this.exports.vir_last_package_error(), len);
  }

  loadIrPackageSetBytes(packages, packageSet = null) {
    this.requireLiveRuntime();
    if (this.hasPackageState()) {
      throw new Error(
        "VirRuntime already owns an IR package set; create a fresh runtime for another generation",
      );
    }
    if (this.liveCallbacks.size !== 0) {
      throw new Error(
        "VirRuntime cannot install an IR package set while callbacks are live; create a fresh runtime",
      );
    }
    const packageBytes = validateIrPackageSetMembers(packages, {
      members: packageSet?.members ?? null,
    }).bytes;
    return this.installIrPackageSetBytes(packageBytes, packageSet);
  }

  // Internal installer for validated bytes from the factory or public loader.
  installIrPackageSetBytes(packageBytes, packageSet = null) {
    this.requireLiveRuntime();
    if (this.hasPackageState()) {
      throw new Error(
        "VirRuntime already owns an IR package set; create a fresh runtime for another generation",
      );
    }
    if (this.liveCallbacks.size !== 0) {
      throw new Error(
        "VirRuntime cannot install an IR package set while callbacks are live; create a fresh runtime",
      );
    }
    this.requireFunction("vir_begin_ir_package_set");
    this.requireFunction("vir_append_ir_package");
    this.requireFunction("vir_prepare_ir_package_set");
    this.requireFunction("vir_finish_ir_package_set");
    this.requireFunction("vir_package_decl_count");
    this.requireFunction("vir_abort_ir_package_set");
    if (this.exports.vir_begin_ir_package_set() === 0) {
      const detail = this.lastPackageError();
      throw new Error(
        `IR package-set setup failed${detail ? `: ${detail}` : ""}`,
      );
    }

    let transactionOpen = true;
    let initializationStarted = false;
    try {
      let byteLength = 0;
      for (let index = 0; index < packageBytes.length; index += 1) {
        const bytes = packageBytes[index];
        byteLength += bytes.byteLength;
        const ptr = this.allocBytes(bytes);
        try {
          if (this.exports.vir_append_ir_package(ptr, bytes.byteLength) === 0) {
            const detail = this.lastPackageError();
            throw new Error(
              `IR package-set member ${index + 1} load failed${detail ? `: ${detail}` : ""}`,
            );
          }
        } finally {
          this.freeBytes(ptr);
        }
      }

      if (this.exports.vir_prepare_ir_package_set() === 0) {
        const detail = this.lastPackageError();
        throw new Error(
          `IR package-set validation failed${detail ? `: ${detail}` : ""}`,
        );
      }
      const interfaceManifest = this.readPackageManifest();
      this.hostState?.setManifest(interfaceManifest);

      initializationStarted = true;
      const finished = this.exports.vir_finish_ir_package_set();
      const hostError = this.hostState?.takeCallError();
      if (hostError) throw hostError;
      if (finished === 0) {
        const detail = this.lastPackageError();
        throw new Error(
          `IR package-set finalization failed${detail ? `: ${detail}` : ""}`,
        );
      }
      transactionOpen = false;
      return this.finishPackageInstall({
        count: this.packageDeclCount(),
        byteLength,
        packageCount: packageBytes.length,
        interfaceManifest,
        packageSet,
      });
    } catch (error) {
      // Initializers can publish persistent values and opaque handles. Once
      // execution starts, failure cannot be rolled back into an empty instance.
      if (initializationStarted) runtimeBoundaries.get(this).fail(error);
      const errors = [error];
      if (transactionOpen && !initializationStarted) {
        collectCleanupError(errors, () =>
          this.exports.vir_abort_ir_package_set(),
        );
      }
      collectCleanupError(errors, () => this.clearPackageMetadata());
      throwCollectedErrors(errors, "IR package-set rollback failed");
    }
  }

  finishPackageInstall({
    count,
    byteLength,
    packageCount,
    interfaceManifest,
    packageSet,
  }) {
    this.interfaceManifest = interfaceManifest;
    this.hostState?.setManifest(this.interfaceManifest);
    this.packageMetadata = this.interfaceManifest.metadata;
    this.rebuildManifestExports();
    this.packageInfo = {
      count,
      byteLength,
      packageCount,
      interfaceExports: this.interfaceManifest.exports.length,
      hostImports: this.interfaceManifest.hostImports?.length ?? 0,
      metadata: this.packageMetadata,
      packageSet,
    };
    return this.packageInfo;
  }

  clearPackageMetadata() {
    this.packageInfo = null;
    this.interfaceManifest = null;
    this.hostState?.setManifest(null);
    this.packageMetadata = null;
    this.exportsByName = Object.create(null);
    this.entriesByName = Object.create(null);
    this.entryCallCache = new WeakMap();
  }

  hasPackageState() {
    return (
      this.packageInfo !== null ||
      this.interfaceManifest !== null ||
      this.packageMetadata !== null ||
      (this.exports.vir_package_interface_manifest_size?.() ?? 0) !== 0 ||
      (this.packageDeclCount() ?? 0) !== 0
    );
  }

  readPackageManifest() {
    this.requireFunction("vir_package_interface_manifest");
    this.requireFunction("vir_package_interface_manifest_size");

    const len = this.exports.vir_package_interface_manifest_size();
    if (len === 0) {
      throw new Error(
        "IR package does not contain an embedded interface manifest",
      );
    }
    const text = this.readWasmString(
      this.exports.vir_package_interface_manifest(),
      len,
    );
    const manifest = JSON.parse(text);
    this.requireFunction("vir_package_format_version");
    const validated = validateInterfaceManifest(manifest, {
      packageFormatVersion: this.exports.vir_package_format_version(),
    });
    this.requireFunction("vir_validate_package_contract");
    const contract = encodePackageContract(validated);
    const ptr = this.allocBytes(contract);
    try {
      if (this.exports.vir_validate_package_contract(ptr, contract.length) === 0) {
        throw new Error(this.lastPackageError());
      }
    } finally {
      this.freeBytes(ptr);
    }
    return freezeManifestTree(validated);
  }

  rebuildManifestExports() {
    this.exportsByName = Object.create(null);
    this.entriesByName = Object.create(null);
    this.entryCallCache = new WeakMap();
    const entries = this.interfaceManifest?.exports ?? [];
    for (let exportIndex = 0; exportIndex < entries.length; exportIndex += 1) {
      const entry = entries[exportIndex];
      registerManifestEntryKey(this.entriesByName, entry.entry, entry);
      registerManifestEntryKey(this.entriesByName, entry.id, entry);
      registerManifestEntryKey(this.entriesByName, entry.jsName, entry);
      this.entryCallCache.set(entry, { exportIndex });
      if (entry.jsName && isIdentifier(entry.jsName)) {
        this.exportsByName[entry.jsName] = (...args) =>
          this.callEntry(entry, args);
      }
    }
  }

  findManifestEntry(name) {
    return typeof name === "string" ? (this.entriesByName[name] ?? null) : null;
  }

  call(name, ...args) {
    this.requireLiveRuntime();
    const entry = this.findManifestEntry(name);
    if (entry === null) {
      throw new Error(`interface entry not found: ${name}`);
    }
    return this.callEntry(entry, args);
  }

  callTimed(name, ...args) {
    this.requireLiveRuntime();
    const timing = new RuntimeCallTiming();
    const entry = this.findManifestEntry(name);
    if (entry === null) {
      throw new Error(`interface entry not found: ${name}`);
    }
    const value = this.callEntry(entry, args, timing);
    return { value, timings: timing.finish() };
  }

  runStartupEntries() {
    this.requireLiveRuntime();
    if (this.interfaceManifest === null) {
      throw new Error(
        "cannot run VIR startup hooks before loading an IR package",
      );
    }
    // Host bindings can synchronously reenter this method. Let the outer
    // traversal finish each hook before proceeding to the next one.
    if (this.startupState === "running" || this.startupState === "complete") return;
    if (this.startupState === "failed") throw this.startupError;
    this.startupState = "running";
    try {
      for (const entry of this.interfaceManifest.exports) {
        if (entry.startup) {
          this.callEntry(entry, []);
        }
      }
      this.startupState = "complete";
    } catch (error) {
      // A failed hook may already have performed effects. Never resume it.
      this.startupState = "failed";
      this.startupError = error;
      throw error;
    }
  }

  callEntry(entry, args, timing = null) {
    this.requireLiveRuntime();
    this.requireFunction("vir_resolve_call_export");
    if (args.length !== entry.args.length) {
      throw new Error(
        `${entry.entry} expects ${entry.args.length} arguments, got ${args.length}`,
      );
    }

    const cache = this.callCacheFor(entry);
    const plan = this.objectCallPlanFor(entry, cache);
    if (plan === null || !this.hasObjectValueExports()) {
      throw new Error(
        `object ABI does not support interface entry ${entry.entry}`,
      );
    }
    const argObjs = [];
    try {
      const marshalStarted = timing?.beginPhase();
      try {
        for (let index = 0; index < plan.args.length; index++) {
          const arg = plan.args[index];
          argObjs.push(
            this.makeObjectValue(
              arg.type,
              args[index],
              `${entry.entry} argument ${arg.name}`,
            ),
          );
        }
      } finally {
        if (timing !== null) timing.endMarshal(marshalStarted);
      }
      return this.callResolvedObjects(
        entry,
        cache,
        argObjs,
        (resultObj) =>
          this.liftObjectValue(
            plan.resultType,
            resultObj,
            `${entry.entry} result`,
          ),
        timing,
      );
    } finally {
      this.releaseOwnedObjects(argObjs);
    }
  }

  objectCallPlanFor(entry, cache) {
    if (cache.objectCallPlan !== undefined) {
      return cache.objectCallPlan;
    }
    const resultType = entry.result;
    if (
      !objectResultSupported(resultType) ||
      !entry.args.every((arg) => objectArgumentSupported(arg.type))
    ) {
      cache.objectCallPlan = null;
      return null;
    }
    // Preparation resolves the actual boxed declaration. The binary contract
    // independently checks its boundary requirement; display aliases and
    // target provenance cannot establish executable declaration availability.
    cache.objectCallPlan = {
      args: entry.args,
      resultType,
    };
    return cache.objectCallPlan;
  }

  usizeMaxValue() {
    return this.targetPointerBytes() === 4 ? MAX_UINT32 : MAX_UINT64;
  }

  callCacheFor(entry) {
    let cache = this.entryCallCache.get(entry);
    if (cache === undefined) {
      const exportIndex = this.interfaceManifest?.exports?.indexOf(entry) ?? -1;
      if (exportIndex < 0) {
        throw new Error("interface entry does not belong to this runtime");
      }
      cache = { exportIndex };
      this.entryCallCache.set(entry, cache);
    }
    return cache;
  }

  resolveCallSlot(entry, cache) {
    if (cache.callSlot !== undefined) {
      return cache.callSlot;
    }
    const callSlot =
      this.exports.vir_resolve_call_export(cache.exportIndex) >>> 0;
    if (callSlot === 0) {
      throw new Error(
        this.lastCallError() || `call entry not found: ${entry.entry}`,
      );
    }
    cache.callSlot = callSlot;
    return callSlot;
  }

  lastCallError() {
    const len = this.exports.vir_call_error_size?.() ?? 0;
    return len === 0
      ? ""
      : this.readWasmString(this.exports.vir_call_error(), len);
  }

  allocBytes(bytes) {
    const view = asBytes(bytes, "bytes");
    const ptr = this.allocByteLength(view.byteLength, "bytes");
    new Uint8Array(this.exports.memory.buffer, ptr, view.byteLength).set(view);
    return ptr;
  }

  allocByteLength(byteLength, label) {
    this.requireFunction("vir_alloc_bytes");
    if (!Number.isInteger(byteLength) || byteLength < 0) {
      throw new Error(`${label} byte length must be a non-negative integer`);
    }
    const ptr = this.exports.vir_alloc_bytes(byteLength);
    if (ptr === 0 && byteLength !== 0) {
      throw new Error(`${label} allocation failed`);
    }
    return ptr;
  }

  writePointerArray(ptr, values) {
    const view = new DataView(
      this.exports.memory.buffer,
      ptr,
      values.length * 4,
    );
    for (let index = 0; index < values.length; index++) {
      view.setUint32(index * 4, values[index], true);
    }
  }

  freeBytes(ptr) {
    this.exports.vir_free_bytes?.(ptr);
  }

  readWasmString(ptr, len) {
    return textDecoder.decode(
      new Uint8Array(this.exports.memory.buffer, ptr, len),
    );
  }

  readWasmBytes(ptr, len) {
    return new Uint8Array(this.exports.memory.buffer, ptr, len).slice();
  }

  requireFunction(name) {
    if (typeof this.exports[name] !== "function") {
      throw new Error(`${name} export is missing`);
    }
  }

  requireLiveRuntime() {
    if (this.disposed) {
      throw new Error("VirRuntime has been disposed");
    }
    if (this.failure !== null) {
      throw new Error("VirRuntime failed during Wasm execution; create a fresh runtime", { cause: this.failure });
    }
  }

  get failure() {
    return runtimeBoundaries.get(this)?.failure ?? null;
  }

  onFailure(listener) {
    if (typeof listener !== "function") throw new TypeError("failure listener must be a function");
    return runtimeBoundaries.get(this).subscribe(listener);
  }

  trackCallback(callback) {
    this.liveCallbacks.add(callback);
  }

  untrackCallback(callback) {
    this.liveCallbacks.delete(callback);
  }

  callClosure(rootId, type, args) {
    this.requireLiveRuntime();
    this.requireFunction("vir_closure_call_objects");
    const fnArgs = requireFunctionArgs(type, "callback");
    // Like ordinary JS formal parameters, ignore extra arguments and read
    // missing arguments as undefined. Each declared boundary view still
    // performs its normal conversion/check when lowered into Lean.
    const argObjs = [];
    try {
      fnArgs.forEach((arg, index) => {
        argObjs.push(
          this.makeObjectValue(
            arg.type,
            args[index],
            `callback argument ${arg.name}`,
          ),
        );
      });
      return this.callClosureObjects(rootId, type, argObjs);
    } finally {
      this.releaseOwnedObjects(argObjs);
    }
  }

  callClosureObjects(rootId, type, argObjs) {
    let argvPtr = 0;
    let resultObj = 0;
    try {
      if (this.hostState?.callError) throw this.hostState.callError;
      if (argObjs.length !== 0) {
        argvPtr = this.allocByteLength(
          argObjs.length * 4,
          "callback argv pointer array",
        );
        this.writePointerArray(argvPtr, argObjs);
      }
      try {
        const argc = argObjs.length;
        // The consuming ABI owns arguments from entry, including trap paths.
        argObjs.length = 0;
        resultObj = this.exports.vir_closure_call_objects(
          rootId,
          argvPtr,
          argc,
        );
      } catch (error) {
        const hostError = this.hostState?.takeCallError();
        throw hostError ?? error;
      }
      const hostError = this.hostState?.takeCallError();
      if (hostError) {
        throw hostError;
      }
      if (resultObj === 0) {
        throw new Error(this.lastClosureCallError() || "closure call failed");
      }
      return this.liftObjectValue(
        requireFunctionResult(type, "callback"),
        resultObj,
        "callback result",
      );
    } finally {
      if (argvPtr !== 0) {
        this.freeBytes(argvPtr);
      }
      if (resultObj !== 0) {
        this.exports.vir_obj_dec(resultObj);
      }
    }
  }

  releaseClosure(rootId) {
    this.exports.vir_closure_release?.(rootId);
  }

  lastClosureCallError() {
    const len = this.exports.vir_closure_call_error_size?.() ?? 0;
    return len === 0
      ? ""
      : this.readWasmString(this.exports.vir_closure_call_error(), len);
  }

  dispose() {
    if (this.disposed || this.disposing) return;
    this.disposing = true;
    const errors = [];
    try {
      collectCleanupError(errors, () => this.teardownPackageResources());
    } finally {
      this.markDisposed();
    }
    throwCollectedErrors(errors, "VirRuntime disposal failed");
  }

  teardownPackageResources() {
    const errors = [];
    collectCleanupError(errors, () => this.hostState?.dispose());
    collectCleanupError(errors, () => this.releaseLiveCallbacks());
    throwCollectedErrors(errors, "VirRuntime package resource teardown failed");
  }

  releaseLiveCallbacks() {
    const callbacks = Array.from(this.liveCallbacks);
    try {
      releaseCallbackRoots(callbacks);
    } finally {
      this.liveCallbacks.clear();
    }
  }

  markDisposed() {
    this.disposed = true;
    this.disposing = false;
    this.hostState = null;
    this.exportsByName = Object.create(null);
  }
}

// Trap recovery cannot safely call into the abandoned interpreter/allocator.
// Keep JS cleanup idempotent, but leave Wasm allocations to instance GC.
const abandonedCleanupExports = new Set([
  "vir_obj_dec", "vir_free_bytes", "vir_closure_release", "vir_abort_ir_package_set",
]);

function guardWasmExports(exports, hostState) {
  const listeners = new Set();
  const schedule = (subscription) => {
    if (subscription.pending) return;
    subscription.pending = true;
    queueMicrotask(() => {
      if (!listeners.delete(subscription)) return;
      try {
        subscription.listener(boundary.failure);
      } catch (error) {
        // Notifications cannot replace the original failure or escape as an
        // unhandled microtask exception. Applications own listener diagnostics.
        try { console.error("VIR failure listener threw", error); } catch {}
      }
    });
  };
  const boundary = {
    failure: null,
    exports: Object.create(null),
    fail(error) {
      if (boundary.failure !== null) return boundary.failure;
      // Commit abandonment before touching the thrown value or host diagnostics.
      boundary.failure = new Error("Wasm invocation failed", { cause: error });
      let cause = error;
      try { cause = hostState?.takeCallError() ?? error; } catch {}
      boundary.failure = asError(cause, "Wasm invocation failed");
      for (const subscription of listeners) schedule(subscription);
      return boundary.failure;
    },
    subscribe(listener) {
      const subscription = { listener, pending: false };
      listeners.add(subscription);
      if (boundary.failure !== null) schedule(subscription);
      return () => { listeners.delete(subscription); };
    },
  };
  for (const [name, value] of Object.entries(exports)) {
    boundary.exports[name] = typeof value !== "function" ? value : (...args) => {
      if (boundary.failure !== null) {
        if (abandonedCleanupExports.has(name)) return 0;
        throw new Error("VirRuntime failed during Wasm execution; create a fresh runtime", { cause: boundary.failure });
      }
      try {
        const result = value(...args);
        // A host binding may have caught a nested fatal call. It cannot revive
        // the shared instance by returning an apparently successful result.
        if (boundary.failure !== null) throw boundary.failure;
        return result;
      } catch (error) {
        throw boundary.fail(error);
      }
    };
  }
  return boundary;
}

// Only called on the runtime's own parsed JSON, never caller-owned host values
// or standalone validator inputs. Cached call/layout plans require stable data.
function freezeManifestTree(manifest) {
  const pending = [manifest];
  while (pending.length !== 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object") continue;
    Object.freeze(value);
    for (const child of Object.values(value)) pending.push(child);
  }
  return manifest;
}

function registerManifestEntryKey(map, key, entry) {
  // Manifest validation guarantees that every nonempty alias has one owner.
  if (typeof key === "string" && key !== "") {
    map[key] = entry;
  }
}

function isIdentifier(text) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text);
}
