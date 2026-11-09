/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/

import { validateIrPackageSetMembers } from "../runtime/ir-package.js";
import { resolveProgramExports } from "./program-exports.js";
import { requireSha256 } from "./descriptor.js";

export function creationError(phase, cause, context = {}, name = "Error") {
  const error = new Error(`program creation failed during ${phase}`, { cause });
  error.name = name;
  error.phase = phase;
  error.context = Object.freeze({ ...context });
  return error;
}

// Shared by verified URL acquisition and the factory's verified byte input.
// prepare supplies private snapshots and an instantiator, never caller flags
// claiming that arbitrary bytes or a precompiled module have been verified.
export async function openOwnedProgram({
  signal,
  expected,
  prepare,
  initialPhase = "program-validation",
}) {
  if (signal?.aborted)
    throw creationError(initialPhase, signal.reason, {}, "AbortError");
  try {
    requireSha256();
  } catch (cause) {
    throw creationError("runtime-creation", cause);
  }
  const controller = new AbortController();
  let primary = null;
  let phase = initialPhase;
  const stop = (error) => {
    if (primary === null) {
      primary = error;
      controller.abort(error);
    }
    return primary;
  };
  const checkStopped = () => {
    if (primary !== null) throw primary;
  };
  const abort = () =>
    stop(creationError(phase, signal.reason, {}, "AbortError"));
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () =>
      stop(
        creationError(
          phase,
          new Error("resource acquisition timeout"),
          {},
          "TimeoutError",
        ),
      ),
    120000,
  );
  let detached = false;
  const detach = () => {
    if (detached) return;
    detached = true;
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  };
  const perform = async (nextPhase, action, context = {}) => {
    phase = nextPhase;
    try {
      checkStopped();
      const value = await action();
      checkStopped();
      return value;
    } catch (cause) {
      throw stop(primary ?? creationError(nextPhase, cause, context));
    }
  };
  let runtime = null;
  try {
    const {
      compatibility,
      packages,
      packageInfo = null,
      instantiate,
    } = await prepare({ signal: controller.signal, perform });
    checkStopped();
    phase = "program-validation";
    const { manifests } = validateIrPackageSetMembers(packages, {
      members: packageInfo?.members ?? null,
    });
    for (const manifest of manifests) {
      // IR and interface format versions were checked by the package validator.
      if (manifest.metadata.leanGithash !== compatibility.leanRevision) {
        throw new Error(
          "program compiled identity does not match resource compatibility",
        );
      }
    }
    const rootDeclarations = resolveProgramExports(
      manifests.at(-1).exports,
      expected,
    );
    // Assign before the post-await abort check so a late owned instance cannot
    // escape cleanup. Creation itself may be non-preemptible.
    await perform("runtime-creation", async () => {
      runtime = await instantiate(checkStopped);
      // Own the instance before installation: partial initialization or an abort
      // must still dispose it, preserving the primary creation error.
      checkStopped();
      runtime.installIrPackageSetBytes(packages, packageInfo);
    });
    // Use the installed entries (including their runtime call-index cache), not
    // structurally equivalent entries parsed during the preflight above.
    phase = "program-validation";
    const installedDeclarations = resolveProgramExports(
      runtime.interfaceManifest.exports,
      expected,
    );
    const declarations = new Map();
    for (const declaration of rootDeclarations.keys()) {
      const entry = installedDeclarations.get(declaration);
      if (entry === undefined)
        throw new Error(`missing installed program export ${declaration}`);
      declarations.set(declaration, entry);
    }
    checkStopped();
    detach(); // Final check and ownership handoff have no intervening await.
    let disposed = false;
    return Object.freeze({
      get status() {
        return disposed
          ? "disposed"
          : runtime.failure === null
            ? "active"
            : "failed";
      },
      call(declaration, ...args) {
        if (disposed) throw new Error("program has been disposed");
        const entry = declarations.get(declaration);
        if (entry === undefined)
          throw new Error(`unknown program export ${declaration}`);
        return runtime.callEntry(entry, args);
      },
      callWith(options, declaration, ...args) {
        if (disposed) throw new Error("program has been disposed");
        if (!declarations.has(declaration))
          throw new Error(`unknown program export ${declaration}`);
        return runtime.callWith(options, declaration, ...args);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        try {
          runtime.dispose();
        } finally {
          // A retained closed facade must not keep the Wasm heap reachable,
          // including when runtime cleanup reports an error.
          runtime = null;
          declarations.clear();
        }
      },
    });
  } catch (error) {
    const failure = stop(primary ?? creationError(phase, error));
    const owned = runtime;
    runtime = null; // Detach before invoking arbitrary cleanup, even on throw.
    if (owned !== null) {
      try {
        owned.dispose();
      } catch (cleanupError) {
        Object.defineProperty(failure, "cleanupError", {
          value: cleanupError,
          enumerable: true,
        });
      }
    }
    throw failure;
  } finally {
    detach();
  }
}
