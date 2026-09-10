/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import { VIR_HOST_DISPOSE } from "../../web/src/host-boundary.js";
import {
  check,
  collectUntil,
  makeGeneration,
  makeJsl,
  readJsl,
} from "./generation-gc-cases.js";

function rejects(action, pattern) {
  try {
    action();
  } catch (error) {
    check(pattern.test(String(error)), `unexpected rejection: ${error}`);
    return;
  }
  throw new Error("expected rejection");
}

export async function runGenerationLifecycleCases(createRuntime, packageBytes) {
  const first = await makeGeneration(createRuntime, "before replacement");
  const state = first.runtime.hostState;
  rejects(
    () => first.runtime.loadIrPackageSetBytes([new Uint8Array([0])]),
    /package|header|truncated|byte/i,
  );
  check(first.callback(4n) === 11n, "failed replacement preserves callback");
  check(
    readJsl(first.runtime, first.jsl) === "before replacement",
    "failed replacement preserves JSL",
  );
  first.runtime.loadIrPackageSetBytes([packageBytes]);
  check(
    first.runtime.hostState !== state,
    "replacement adopts separate host state",
  );
  check(
    state.leanObjectHandleCells.size === 0,
    "replacement releases old JSL roots",
  );
  rejects(() => first.callback(4n), /disposed runtime/);
  rejects(() => readJsl(first.runtime, first.jsl), /live Lean object handle/);
  const replacementJsl = makeJsl(first.runtime, "after replacement");
  check(
    readJsl(first.runtime, replacementJsl) === "after replacement",
    "new heap is usable",
  );
  first.runtime.dispose();
  first.runtime.dispose();
  rejects(
    () => readJsl(first.runtime, replacementJsl),
    /live Lean object handle/,
  );

  // Fault injection releases the actual Wasm roots first, then throws. Every
  // independent cleanup must still run; repeated disposal must not release twice.
  let hostDisposals = 0;
  const failures = await makeGeneration((bindings) =>
    createRuntime({
      ...bindings,
      [VIR_HOST_DISPOSE]: () => {
        hostDisposals++;
        throw new Error("host cleanup sentinel");
      },
    }),
  );
  const failedState = failures.runtime.hostState;
  const counts = injectReleaseFailures(failures.runtime);
  rejects(() => failures.runtime.dispose(), /cleanup|teardown/i);
  check(
    hostDisposals === 1 && counts.callback === 1 && counts.jsl === 1,
    "shutdown attempts host, callback and JSL cleanup exactly once",
  );
  check(
    failedState.leanObjectHandleCells.size === 0 &&
      failures.runtime.liveCallbacks.size === 0,
    "failed shutdown clears tracked foreign roots",
  );
  check(
    failedState.resourceRoots.debugCounts().active === 0,
    "failed shutdown clears externrefs",
  );
  failures.runtime.dispose();
  check(
    hostDisposals === 1 && counts.callback === 1 && counts.jsl === 1,
    "failed shutdown is idempotent",
  );
  rejects(() => failures.callback(4n), /disposed runtime/);
  rejects(
    () => readJsl(failures.runtime, failures.jsl),
    /live Lean object handle/,
  );

  let finalizers = await makeGeneration(createRuntime);
  const owned = finalizers.runtime;
  const finalizedCounts = injectReleaseFailures(owned);
  finalizers = null;
  await collectUntil(
    () => finalizedCounts.callback === 1 && finalizedCounts.jsl === 1,
    "best-effort cleanup failure recording",
  );
  check(
    owned.hostState.takeFinalizerErrors().length === 2,
    "both finalizer errors are recorded",
  );
  check(
    owned.liveCallbacks.size === 0 &&
      owned.hostState.leanObjectHandleCells.size === 0,
    "failing finalizers untrack their roots",
  );
  owned.dispose();
  check(
    finalizedCounts.callback === 1 && finalizedCounts.jsl === 1,
    "finalized roots are not released twice",
  );
  return {
    replacement: true,
    failedReplacement: true,
    hardShutdown: true,
    cleanupErrors: true,
  };
}

function injectReleaseFailures(runtime) {
  const counts = { callback: 0, jsl: 0 };
  const release = runtime.releaseClosure.bind(runtime);
  const dec = runtime.exports.vir_obj_dec;
  runtime.releaseClosure = (id) => {
    release(id);
    counts.callback++;
    throw new Error("callback release sentinel");
  };
  runtime.exports = {
    ...runtime.exports,
    vir_obj_dec: (ptr) => {
      dec(ptr);
      counts.jsl++;
      throw new Error("JSL release sentinel");
    },
  };
  return counts;
}

export async function runSharedBindingGcCases(
  factory,
  sharedBindings,
  packageBytes,
) {
  let disposals = 0;
  sharedBindings[VIR_HOST_DISPOSE] = () => {
    disposals++;
  };
  const first = await factory.createRuntime({ irPackageSet: [packageBytes] });
  const second = await factory.createRuntime({ irPackageSet: [packageBytes] });
  first.dispose();
  check(
    disposals === 0,
    "one shared owner cannot dispose another owner's bindings",
  );
  second.dispose();
  check(disposals === 1, "last explicit shared owner disposes bindings once");
  second.dispose();
  check(disposals === 1, "shared binding disposal is idempotent");

  // An externally owned factory/passive shared map has no reverse runtime edge.
  const weak = await makeSharedGraph(factory, packageBytes);
  await collectUntil(
    () => weak.deref() === undefined,
    "passive shared factory does not anchor generation",
  );
  const retained = await makeSharedGraph(factory, packageBytes, sharedBindings);
  await collectUntil(() => true, "shared-map retention control");
  check(
    retained.deref() !== undefined,
    "shared map deliberately retains target owner",
  );
  check(
    readJsl(retained.deref(), sharedBindings.retained) === "shared",
    "shared-map JSL remains usable",
  );
  delete sharedBindings.retained;
  await collectUntil(
    () => retained.deref() === undefined,
    "shared-map target released",
  );
  // Collection does not decrement existing numeric lease counts. This test
  // establishes reachability only, not automatic shared-binding teardown.
  return {
    explicitSharedDisposal: true,
    passiveFactory: true,
    retainedMap: true,
  };
}

async function makeSharedGraph(factory, packageBytes, bindings = null) {
  const runtime = await factory.createRuntime({ irPackageSet: [packageBytes] });
  const jsl = makeJsl(runtime, "shared");
  runtime.hostState.resourceRoots.root(jsl);
  if (bindings !== null) bindings.retained = jsl;
  return new WeakRef(runtime);
}
