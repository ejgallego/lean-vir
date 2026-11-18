/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/

import { prepareRuntime, createVirImports } from "../../web/src/vir-runtime.js";

async function run({ wasmBytes, runtimeManifest, expectedRuntimeContentId, irPackageSet }) {
  const instances = [];
  const pending = new AbortController(); // Worker-local, never cloned from the page.
  const prepared = await prepareRuntime({
    wasmBytes, runtimeManifest, expectedRuntimeContentId, signal: pending.signal,
    imports(module, hostState) {
      instances.push({ module, hostState });
      return createVirImports(module, {}, hostState);
    },
  });
  const preparedWithoutInstance = instances.length === 0;
  const score = "Vir.Resources.Test.prettyScore";
  const options = {
    irPackageSet,
    expectedExports: {
      [score]: {
        args: [],
        result: { native: { type: { tag: "nat" } }, value: { tag: "bigint" } },
        effect: "pure",
      },
    },
    signal: pending.signal,
  };
  let first, second;
  try {
    first = await prepared.createProgram(options);
    second = await prepared.createProgram(options);
    pending.abort("after program handoff");
    const values = [first.call(score) === 6093n, second.call(score) === 6093n];
    const sameModule = instances[0].module === instances[1].module;
    const separateMemories = instances[0].hostState.exports.memory !==
      instances[1].hostState.exports.memory;
    first.dispose(); first.dispose();
    let disposedCallRejected = false;
    try { first.call(score); }
    catch (error) { disposedCallRejected = /disposed/.test(error.message); }
    const peerActive = second.status === "active";
    values.push(second.call(score) === 6093n);
    second.dispose();
    return {
      preparedWithoutInstance, sameModule, separateMemories, values,
      disposedCallRejected, peerActive,
      bothDisposed: first.status === "disposed" && second.status === "disposed",
      hostReferencesCleared: instances.every(({ hostState }) => hostState.runtime === null),
    };
  } finally {
    first?.dispose(); second?.dispose();
  }
}

self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ ok: true, result: await run(data) });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: { message: error.message, phase: error.phase, cause: error.cause?.message, stack: error.stack },
    });
  }
};
