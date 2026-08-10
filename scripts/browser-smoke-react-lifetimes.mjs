/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

import { evaluate } from "./browser-smoke-harness.mjs";

const resultKey = "__leanVirReactRefLifetimeSmoke";
const strictModeResultKey = "__leanVirReactStrictModeSmoke";
const strictModeStateKey = "__leanVirReactStrictModeLifetimeState";
const strictModeCleanupKey = "__leanVirReactStrictModeLifetimeCleanup";
const browserProbeBundles = new Map();

export async function smokeBrowserReactLifetimes(cdp) {
  await smokeBrowserReactRefLifetime(cdp);
  await smokeBrowserReactStrictModeLifetime(cdp);
}

async function smokeBrowserReactRefLifetime(cdp) {
  const source = await bundledBrowserProbe(
    "./browser-smoke-react-ref-lifetime-entry.js",
    "production",
  );
  await evaluateBrowserProbe(cdp, source, "lean-vir-react-ref-lifetime-smoke.js");
  const result = await evaluate(cdp, `globalThis[${JSON.stringify(resultKey)}]`);
  if (result?.ok !== true) {
    throw new Error(
      `React ref lifetime browser probe failed: ${result?.error?.message ?? JSON.stringify(result)}`,
    );
  }
  assert.deepEqual(result.value, {
    unattached: { leases: 2, releases: 0, current: "payload" },
    attached: { leases: 1, releases: 2, current: "element" },
    cleared: { leases: 1, releases: 3, current: "null" },
    released: { leases: 0, releases: 4, finalized: true },
  });
}

async function smokeBrowserReactStrictModeLifetime(cdp) {
  const source = await bundledBrowserProbe(
    "./browser-smoke-react-strict-mode-entry.js",
    "development",
  );
  await evaluateBrowserProbe(cdp, source, "lean-vir-react-strict-mode-smoke.js");
  const result = await evaluate(cdp, `globalThis[${JSON.stringify(strictModeResultKey)}]`);
  if (result?.ok !== true) {
    throw new Error(
      `React Strict Mode lifetime browser probe failed: ${result?.error?.message ?? JSON.stringify(result)}`,
    );
  }
  assert.equal(result.value.strict.renders, 2, "Strict Mode must perform its development render replay");
  assert.deepEqual(result.value.strict, { renders: 2, setups: 2, cleanups: 2 });
  assert.deepEqual(
    result.value.componentReplay,
    { initialRenders: 2, replacementRenders: 4 },
    "Strict Mode must replay a replacement callback without releasing its winner",
  );
  assert.ok(result.value.lanes.renders.includes("urgent"), "the urgent React lane must render");
  assert.equal(result.value.lanes.renders.at(-1), "transition", "the queued transition lane must commit last");
  assert.ok(result.value.abandoned.renders >= 1, "Suspense must start at least one discarded render");

  await evaluate(cdp, `delete globalThis[${JSON.stringify(strictModeResultKey)}]`);
  let state = null;
  try {
    await cdp.send("HeapProfiler.enable");
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        await cdp.send("HeapProfiler.collectGarbage");
        await evaluate(cdp, "new Promise((resolve) => setTimeout(resolve, 0))");
        state = await evaluate(cdp, `globalThis[${JSON.stringify(strictModeStateKey)}]`);
        if (reactLifetimeStateReleased(state)) break;
      }
    } finally {
      await cdp.send("HeapProfiler.disable");
    }
    assert.ok(state !== null, "React Strict Mode lifetime state must remain observable during GC");
    assert.equal(state.strict.setupCallbacks.active, 0, "discarded Strict Mode setup leases must be collectible");
    assert.equal(state.strict.cleanupCallbacks.active, 0, "discarded Strict Mode cleanup leases must be collectible");
    assert.equal(state.strict.payloads.active, 0, "Strict Mode payload leases must all be released");
    assertLifetimeCounterReleased(
      state.componentReplay.initialRenderCallbacks,
      "initial component render callbacks",
    );
    assertLifetimeCounterReleased(
      state.componentReplay.initialNodeCallbacks,
      "initial component node callbacks",
    );
    assertLifetimeCounterReleased(
      state.componentReplay.replacementRenderCallbacks,
      "replacement component render callbacks",
    );
    assertLifetimeCounterReleased(
      state.componentReplay.replacementNodeCallbacks,
      "replacement component node callbacks",
    );
    assert.equal(state.lanes.initialPayloads.active, 0, "React lane initial payload leases must all be released");
    assert.equal(state.lanes.urgentPayloads.active, 0, "React lane urgent payload leases must all be released");
    assert.equal(state.lanes.transitionPayloads.active, 0, "React lane transition payload leases must all be released");
    assert.equal(state.abandoned.payloads.active, 0, "a replaced Suspense render must release its payload leases");
    assert.equal(state.abandoned.payloads.releases, state.abandoned.payloads.created);
  } finally {
    await evaluate(cdp, `globalThis[${JSON.stringify(strictModeCleanupKey)}]?.()`);
    await evaluate(cdp, `delete globalThis[${JSON.stringify(strictModeCleanupKey)}]`);
    await evaluate(cdp, `delete globalThis[${JSON.stringify(strictModeStateKey)}]`);
  }
}

function reactLifetimeStateReleased(state) {
  return state?.strict?.setupCallbacks?.active === 0 &&
    state?.strict?.cleanupCallbacks?.active === 0 &&
    state?.strict?.payloads?.active === 0 &&
    state?.componentReplay?.initialRenderCallbacks?.active === 0 &&
    state?.componentReplay?.initialNodeCallbacks?.active === 0 &&
    state?.componentReplay?.replacementRenderCallbacks?.active === 0 &&
    state?.componentReplay?.replacementNodeCallbacks?.active === 0 &&
    state?.lanes?.initialPayloads?.active === 0 &&
    state?.lanes?.urgentPayloads?.active === 0 &&
    state?.lanes?.transitionPayloads?.active === 0 &&
    state?.abandoned?.payloads?.active === 0;
}

function assertLifetimeCounterReleased(counter, label) {
  assert.equal(counter.active, 0, `${label} must all be released`);
  assert.equal(counter.releases, counter.created, `${label} must release exactly once`);
}

async function evaluateBrowserProbe(cdp, source, sourceName) {
  await evaluate(cdp, `${source}\nvoid 0;\n//# sourceURL=${sourceName}`);
}

async function bundledBrowserProbe(entry, nodeEnv) {
  const cacheKey = `${nodeEnv}:${entry}`;
  const cached = browserProbeBundles.get(cacheKey);
  if (cached !== undefined) return cached;
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    define: {
      "process.env.NODE_ENV": JSON.stringify(nodeEnv),
    },
    format: "iife",
    legalComments: "none",
    minify: true,
    platform: "browser",
    target: ["chrome120"],
    write: false,
  });
  const output = result.outputFiles?.[0];
  if (output === undefined) {
    throw new Error(`React lifetime browser probe did not produce a bundle for ${entry}`);
  }
  browserProbeBundles.set(cacheKey, output.text);
  return output.text;
}
