/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { ManagedRuntimeFactory } from "./factory-core.js";
import { VirRuntime } from "./core.js";
import { asBytes, sha256Hex } from "./vir-codec.js";
import { validateEnvelope } from "../resources/descriptor.js";
import { assertResourceCompatibility } from "../resources/compatibility.js";
import { snapshotExpectedExports } from "../resources/program-exports.js";
import { creationError, openOwnedProgram } from "../resources/owned-program.js";
export {
  createVirImports,
  debugWasmUrlFor,
  fetchBytes,
  hasExternrefTableSupport,
  requireExternrefTableSupport,
  IR_PACKAGE_SET_FORMAT,
  IR_PACKAGE_SET_VERSION,
  PACKAGE_TARGET_MODE,
  VIR_HOST_DISPOSE,
  VIR_WASM_DEV_FILE,
  VIR_WASM_RELEASE_FILE,
  formatPackageTarget,
  packageTargetModeLabel,
} from "./factory-core.js";

export class VirRuntimeFactory extends ManagedRuntimeFactory {
  #programRuntimeInput = null;
  #programRuntimePromise = null;
  #programModulePromise = null;

  constructor(options = {}) {
    const { runtimeManifest, expectedRuntimeContentId, ...runtimeOptions } =
      options;
    const {
      wasmBytes = null,
      wasmModule = null,
      wasmUrl = null,
      wasmDebugUrl = null,
      debugWasm = false,
    } = runtimeOptions;
    let input = null;
    if (
      runtimeManifest !== undefined ||
      expectedRuntimeContentId !== undefined
    ) {
      if (
        runtimeManifest === undefined ||
        typeof expectedRuntimeContentId !== "string" ||
        !/^[0-9a-f]{64}$/.test(expectedRuntimeContentId) ||
        wasmBytes === null ||
        wasmModule !== null ||
        wasmUrl !== null ||
        wasmDebugUrl !== null ||
        debugWasm
      )
        throw new TypeError(
          "owned programs require wasmBytes, runtimeManifest and expectedRuntimeContentId without other Wasm selectors",
        );
      // Capture the association now, independently of public low-level fields.
      input = {
        bytes: Uint8Array.from(asBytes(wasmBytes, "wasmBytes")),
        envelope: structuredClone(runtimeManifest),
        contentId: expectedRuntimeContentId,
      };
    }
    super(VirRuntime, runtimeOptions);
    this.#programRuntimeInput = input;
  }

  async module() {
    if (this.#programRuntimeInput === null) return super.module();
    return this.#programModule(await this.#verifiedProgramRuntime());
  }

  async #verifiedProgramRuntime() {
    if (this.#programRuntimeInput === null)
      throw new Error(
        "owned programs require a runtimeManifest and expectedRuntimeContentId with raw wasmBytes",
      );
    if (this.#programRuntimePromise === null) {
      const input = this.#programRuntimeInput;
      this.#programRuntimePromise = (async () => {
        const envelope = await validateEnvelope(input.envelope);
        if (
          envelope.contentId !== input.contentId ||
          envelope.descriptor.kind !== "runtime"
        )
          throw new Error(
            "runtime envelope does not match the selected runtime content identity",
          );
        assertResourceCompatibility(envelope.descriptor.compatibility);
        const role = envelope.descriptor.fileEntries.find(
          (entry) => entry.role === "wasm",
        );
        const file = envelope.descriptor.files.find(
          (file) => file.path === role.path,
        );
        if (
          file.mediaType !== "application/wasm" ||
          file.byteLength !== input.bytes.byteLength ||
          (await sha256Hex(input.bytes)) !== file.sha256
        )
          throw new Error("runtime Wasm does not match its verified inventory");
        return {
          compatibility: envelope.descriptor.compatibility,
          bytes: input.bytes,
        };
      })();
    }
    return this.#programRuntimePromise;
  }

  #programModule(verified) {
    this.#programModulePromise ??= Promise.resolve().then(
      () => new WebAssembly.Module(verified.bytes),
    );
    return this.#programModulePromise;
  }

  async createProgram(options = {}) {
    if (
      options === null ||
      typeof options !== "object" ||
      Array.isArray(options) ||
      !Object.hasOwn(options, "irPackageSet") ||
      Reflect.ownKeys(options).some(
        (key) => !["irPackageSet", "expectedExports", "signal"].includes(key),
      )
    )
      throw new TypeError(
        "VirRuntimeFactory.createProgram expects irPackageSet and optional expectedExports/signal",
      );
    const { signal } = options;
    if (signal !== undefined && !(signal instanceof AbortSignal))
      throw new TypeError("signal must be an AbortSignal");
    let expected, packages;
    try {
      expected = snapshotExpectedExports(options.expectedExports);
      if (
        !Array.isArray(options.irPackageSet) ||
        options.irPackageSet.length === 0
      )
        throw new TypeError(
          "owned programs require a non-empty package byte array, dependencies first and root last",
        );
      // No await precedes either public-input snapshot.
      packages = options.irPackageSet.map((bytes, index) =>
        Uint8Array.from(asBytes(bytes, `IR package-set member ${index + 1}`)),
      );
    } catch (cause) {
      throw creationError("program-validation", cause);
    }
    return openOwnedProgram({
      signal,
      expected,
      prepare: async ({ perform }) => {
        const verified = await perform("compatibility", () =>
          this.#verifiedProgramRuntime(),
        );
        return {
          compatibility: verified.compatibility,
          packages,
          instantiate: async (checkStopped) => {
            const module = await this.#programModule(verified);
            checkStopped();
            return this.instantiateModule(module);
          },
        };
      },
    });
  }
}
export function createVirRuntimeFactory(options = {}) {
  return new VirRuntimeFactory(options);
}
