/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function check(condition, message) {
  if (!condition) throw new Error(message);
}

export async function collectUntil(predicate, label) {
  for (let attempt = 0; attempt < 150; attempt++) {
    // Leave the job that created/dereferenced WeakRefs before requesting GC.
    await new Promise((resolve) => setTimeout(resolve, 0));
    globalThis.gc();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (predicate()) return;
  }
  throw new Error(`controlled GC observation budget exhausted: ${label}`);
}

export function makeJsl(runtime, text) {
  const bytes = new TextEncoder().encode(text);
  const ptr = runtime.allocBytes(bytes);
  let object;
  try {
    object = runtime.exports.vir_obj_string(ptr, bytes.length);
  } finally {
    runtime.freeBytes(ptr);
  }
  try {
    return runtime.makeLeanObjectHandleResource(object, text);
  } finally {
    runtime.exports.vir_obj_dec(object);
  }
}

export function readJsl(runtime, jsl) {
  const ptr = runtime.retainLeanObjectHandleValue(jsl, "GC payload");
  try {
    return runtime.readObjectString(ptr);
  } finally {
    runtime.exports.vir_obj_dec(ptr);
  }
}

export async function makeGeneration(
  createRuntime,
  text = "original generation",
) {
  const capture = { callback: null };
  const runtime = await createRuntime({
    "test.callNatCallback": (input, callback) => {
      capture.callback = callback;
      return callback(input);
    },
    "test.recordNat": () => undefined,
  });
  check(
    runtime.call("HostInterop.callbackRoundTrip", 3) === "10",
    "real Lean callback setup",
  );
  const callback = capture.callback;
  capture.callback = null;
  const jsl = makeJsl(runtime, text);
  return { runtime, callback, jsl };
}

function observations({ runtime, callback, jsl }) {
  return {
    runtime: new WeakRef(runtime),
    callback: new WeakRef(callback),
    jsl: new WeakRef(jsl),
    memory: new WeakRef(runtime.exports.memory),
    table: new WeakRef(runtime.hostState.resourceRoots.table),
  };
}

export async function runGenerationGcCases(createRuntime) {
  await failedHostCallbacks(createRuntime);
  // Real Wasm roots are released while the original generation stays owned.
  let acyclic = await makeGeneration(createRuntime);
  const owned = acyclic.runtime;
  const weakAcyclic = observations(acyclic);
  acyclic = null;
  await collectUntil(
    () =>
      owned.liveCallbacks.size === 0 &&
      owned.hostState.leanObjectHandleCells.size === 0,
    "acyclic foreign root release",
  );
  check(
    !weakAcyclic.callback.deref() && !weakAcyclic.jsl.deref(),
    "acyclic values collected",
  );
  check(
    owned.hostState.resourceRoots.debugCounts().active === 0,
    "acyclic externrefs released",
  );
  owned.dispose();

  // Each target independently keeps its original generation and Wasm alive.
  let callbackCase = await makeGeneration(createRuntime);
  let callback = callbackCase.callback;
  const callbackOwner = new WeakRef(callbackCase.runtime);
  callbackCase = null;
  await collectUntil(
    () => callbackOwner.deref()?.hostState.leanObjectHandleCells.size === 0,
    "callback-only owner control",
  );
  check(callback(4n) === 11n, "retained callback enters original Lean closure");
  check(
    callbackOwner.deref() !== undefined,
    "callback strongly retains generation",
  );
  callback = null;
  await collectUntil(
    () => callbackOwner.deref() === undefined,
    "released callback generation",
  );

  let jslCase = await makeGeneration(createRuntime, "G1");
  let jsl = jslCase.jsl;
  const jslOwner = new WeakRef(jslCase.runtime);
  jslCase = null;
  await collectUntil(
    () => jslOwner.deref()?.liveCallbacks.size === 0,
    "JSL-only owner control",
  );
  check(
    readJsl(jslOwner.deref(), jsl) === "G1",
    "retained JSL keeps original Lean heap",
  );
  const other = await makeGeneration(createRuntime, "G2");
  let rejected = false;
  try {
    readJsl(other.runtime, jsl);
  } catch {
    rejected = true;
  }
  check(rejected, "G2 rejects G1 JSL");
  check(
    readJsl(other.runtime, other.jsl) === "G2",
    "G2 payload remains isolated",
  );
  check(other.callback(5n) === 12n, "G2 callback remains usable");
  other.runtime.dispose();
  jsl = null;
  await collectUntil(
    () => jslOwner.deref() === undefined,
    "released JSL generation",
  );

  // A live generation's table still owns its targets. This is not a cycle collector.
  let cyclic = await makeGeneration(createRuntime);
  const weakCycle = observations(cyclic);
  const liveCycleOwner = cyclic.runtime;
  const table = liveCycleOwner.hostState.resourceRoots;
  const callbackId = table.root(cyclic.callback);
  const jslId = table.root(cyclic.jsl);
  check(
    table.get(callbackId) === cyclic.callback &&
      table.get(jslId) === cyclic.jsl,
    "externref transport preserves exact target identity",
  );
  cyclic = null;
  await collectUntil(() => true, "live table retention control");
  check(
    typeof weakCycle.callback.deref() === "function" &&
      weakCycle.jsl.deref() !== undefined &&
      table.get(callbackId) === weakCycle.callback.deref() &&
      table.get(jslId) === weakCycle.jsl.deref(),
    "live generation retains table targets",
  );
  // Use a separate function so no retained table local can invalidate the test.
  liveCycleOwner.dispose();

  const interval = await makeIntervalGraph(createRuntime);
  try {
    await collectUntil(() => true, "platform interval retention control");
    check(
      interval.owner.deref() !== undefined,
      "active interval retains original generation",
    );
  } finally {
    clearInterval(interval.timer);
  }
  await collectUntil(
    () => interval.owner.deref() === undefined,
    "cancelled interval generation",
  );

  const deadGraphs = [];
  for (const kind of ["callback", "jsl", "both"]) {
    deadGraphs.push(await makeAbandonedGraph(createRuntime, kind));
  }
  await collectUntil(
    () =>
      deadGraphs.every((graph) =>
        Object.values(graph).every((ref) => ref.deref() === undefined),
      ),
    "whole generations with table-to-callback/JSL anchors",
  );
  return {
    failedHostCallbacks: true,
    acyclic: true,
    retainedCallback: true,
    retainedJsl: true,
    generationIsolation: true,
    intervalRetention: true,
    collectedGraphs: deadGraphs.length,
  };
}

async function failedHostCallbacks(createRuntime) {
  const capture = { strong: null, weak: null };
  const failure = new Error("host retained a callback before throwing");
  const runtime = await createRuntime({
    "test.callNatCallback": (_input, callback) => {
      capture.strong = callback;
      capture.weak = new WeakRef(callback);
      throw failure;
    },
    "test.recordNat": () => undefined,
  });
  try {
    for (const method of ["call", "callTimed"]) {
      let caught;
      try { runtime[method]("HostInterop.callbackRoundTrip", 3); }
      catch (error) { caught = error; }
      check(caught === failure, "failed host preserves exception identity");
      await collectUntil(() => true, "escaped callback retention control");
      check(capture.weak.deref() === capture.strong && capture.strong(4n) === 11n,
        "failed host callback survives GC while JavaScript retains it");
      check(runtime.liveCallbacks.size === 1, "escaped callback keeps its foreign root");
      capture.strong = null;
      await collectUntil(() => capture.weak.deref() === undefined && runtime.liveCallbacks.size === 0,
        "failed host callback eligible for collection while runtime remains live");
      check(runtime.hostState.resourceRoots.debugCounts().active === 0,
        "failed host call releases temporary externref roots");
    }
    // Inject a later lifting failure after a real Lean closure was rooted but
    // before the host receives it. The failed lift must not anchor its callback.
    const liftObjectValue = runtime.liftObjectValue;
    let partial;
    runtime.liftObjectValue = function (...args) {
      const value = liftObjectValue.apply(this, args);
      if (typeof value === "function") {
        partial = new WeakRef(value);
        throw failure;
      }
      return value;
    };
    try {
      let caught;
      try { runtime.call("HostInterop.callbackRoundTrip", 3); }
      catch (error) { caught = error; }
      check(caught === failure && partial !== undefined, "partial callback lift fails as injected");
    } finally {
      runtime.liftObjectValue = liftObjectValue;
    }
    await collectUntil(() => partial.deref() === undefined && runtime.liveCallbacks.size === 0,
      "partial lifting callback eligible for collection");
    check(runtime.hostState.resourceRoots.debugCounts().active === 0,
      "partial lifting failure releases temporary externref roots");
  } finally {
    capture.strong = null;
    runtime.dispose();
  }
}

async function makeAbandonedGraph(createRuntime, kind) {
  const values = await makeGeneration(createRuntime);
  if (kind !== "jsl")
    values.runtime.hostState.resourceRoots.root(values.callback);
  if (kind !== "callback")
    values.runtime.hostState.resourceRoots.root(values.jsl);
  return observations(values);
}

async function makeIntervalGraph(createRuntime) {
  const values = await makeGeneration(createRuntime);
  // The platform receives the exact callback; only the native registration
  // keeps the generation alive after this setup frame returns.
  return {
    timer: setInterval(values.callback, 60000, 4n),
    owner: new WeakRef(values.runtime),
  };
}
