/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/

import { createVirRuntimeFactory } from "../runtime/factory.js";
import { asBytes, sha256Hex } from "../runtime/vir-codec.js";
import { validateEnvelope } from "./descriptor.js";
import { assertResourceCompatibility } from "./compatibility.js";
import { snapshotExpectedExports } from "./program-exports.js";
import { creationError, openOwnedProgram } from "./owned-program.js";

// Capture only the verified compatibility and compiled module. Raw input copies
// and the envelope belong to preparation, not the reusable program creator.
function programCreator(factory, module, compatibility) {
  return Object.freeze({
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
          "prepared runtime.createProgram expects irPackageSet and optional expectedExports/signal",
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
        // No await precedes either operation-input snapshot.
        packages = options.irPackageSet.map((bytes, index) =>
          Uint8Array.from(asBytes(bytes, `IR package-set member ${index + 1}`)),
        );
      } catch (cause) {
        throw creationError("program-validation", cause);
      }
      return openOwnedProgram({
        signal,
        expected,
        prepare: () => ({
          compatibility,
          packages,
          instantiate: () => factory.instantiateModule(module),
        }),
      });
    },
  });
}

/** Verify selected runtime bytes and compile once, without creating an instance. */
export async function prepareRuntime(options = {}, defaultHostBindings = null) {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Reflect.ownKeys(options).some(
      (key) =>
        ![
          "wasmBytes",
          "runtimeManifest",
          "expectedRuntimeContentId",
          "signal",
          "imports",
          "hostBindings",
          "defaultHostBindings",
        ].includes(key),
    )
  )
    throw new TypeError(
      "prepareRuntime expects selected Wasm bytes, runtime envelope and content ID with optional signal/host bindings",
    );
  const {
    wasmBytes,
    runtimeManifest,
    expectedRuntimeContentId,
    signal,
    ...hostOptions
  } = options;
  if (
    wasmBytes == null ||
    runtimeManifest === undefined ||
    typeof expectedRuntimeContentId !== "string" ||
    !/^[0-9a-f]{64}$/.test(expectedRuntimeContentId)
  )
    throw new TypeError(
      "prepareRuntime requires wasmBytes, runtimeManifest and expectedRuntimeContentId",
    );
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new TypeError("signal must be an AbortSignal");

  let phase = "compatibility";
  const checkAborted = () => {
    if (signal?.aborted)
      throw creationError(phase, signal.reason, {}, "AbortError");
  };
  checkAborted();
  try {
    // Snapshot all artifact inputs before the first await. The selected content
    // ID is independent from the received envelope, never inferred from it.
    const bytes = Uint8Array.from(asBytes(wasmBytes, "wasmBytes"));
    const envelopeInput = structuredClone(runtimeManifest);
    const envelope = await validateEnvelope(envelopeInput);
    checkAborted();
    if (
      envelope.contentId !== expectedRuntimeContentId ||
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
      file.byteLength !== bytes.byteLength ||
      (await sha256Hex(bytes)) !== file.sha256
    )
      throw new Error("runtime Wasm does not match its verified inventory");
    checkAborted();
    phase = "runtime-creation";
    const module = await WebAssembly.compile(bytes);
    checkAborted();
    const factory = createVirRuntimeFactory({
      ...hostOptions,
      defaultHostBindings: hostOptions.defaultHostBindings ?? defaultHostBindings,
      wasmModule: module,
    });
    return programCreator(factory, module, envelope.descriptor.compatibility);
  } catch (cause) {
    checkAborted();
    throw creationError(phase, cause);
  }
}
