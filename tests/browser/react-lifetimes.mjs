/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

import { evaluate } from "./harness.mjs";

const resultKey = "__leanVirReactRefLifetimeSmoke";
const strictModeResultKey = "__leanVirReactStrictModeSmoke";
const browserProbeBundles = new Map();

export async function smokeBrowserReactLifetimes(cdp) {
  await smokeBrowserReactRefLifetime(cdp);
  await smokeBrowserReactStrictModeLifetime(cdp);
}

async function smokeBrowserReactRefLifetime(cdp) {
  const source = await bundledBrowserProbe(
    "./react-ref-lifetime-entry.js",
    "production",
  );
  await evaluateBrowserProbe(
    cdp,
    source,
    "lean-vir-react-ref-lifetime-smoke.js",
  );
  const result = await evaluate(
    cdp,
    `globalThis[${JSON.stringify(resultKey)}]`,
  );
  if (result?.ok !== true) {
    throw new Error(
      `React ref lifetime browser probe failed: ${result?.error?.message ?? JSON.stringify(result)}`,
    );
  }
  assert.deepEqual(result.value, {
    unattached: "payload",
    attached: "react-ref-target",
    cleared: null,
  });
}

async function smokeBrowserReactStrictModeLifetime(cdp) {
  const source = await bundledBrowserProbe(
    "./react-strict-mode-entry.js",
    "development",
  );
  await evaluateBrowserProbe(
    cdp,
    source,
    "lean-vir-react-strict-mode-smoke.js",
  );
  const result = await evaluate(
    cdp,
    `globalThis[${JSON.stringify(strictModeResultKey)}]`,
  );
  if (result?.ok !== true) {
    throw new Error(
      `React Strict Mode lifetime browser probe failed: ${result?.error?.message ?? JSON.stringify(result)}`,
    );
  }
  assert.equal(
    result.value.strict.renders,
    2,
    "Strict Mode must perform its development render replay",
  );
  assert.deepEqual(result.value.strict, { renders: 2, setups: 2, cleanups: 2 });
  assert.ok(
    result.value.lanes.renders.includes("urgent"),
    "the urgent React lane must render",
  );
  assert.equal(
    result.value.lanes.renders.at(-1),
    "transition",
    "the queued transition lane must commit last",
  );
  assert.equal(result.value.lanes.initialExact, true);
  assert.equal(result.value.lanes.finalExact, true);
  assert.equal(result.value.reducer.exact, true);
  assert.ok(
    result.value.reducer.calls >= 1,
    "React must invoke the exact reducer callback",
  );
  assert.equal(result.value.memo.exactDependencies, true);
  assert.equal(result.value.memo.exactResult, true);
  assert.equal(result.value.component.mounts, 2);
  assert.equal(result.value.component.cleanups, 1);
  assert.equal(result.value.component.text, "replacement:0");
  assert.equal(result.value.nestedComponent.mounts, 2);
  assert.equal(result.value.nestedComponent.cleanups, 1);
  assert.equal(result.value.nestedComponent.text, "replacement:0");
  assert.ok(
    result.value.abandoned.renders >= 1,
    "Suspense must start at least one discarded render",
  );
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
    throw new Error(
      `React lifetime browser probe did not produce a bundle for ${entry}`,
    );
  }
  browserProbeBundles.set(cacheKey, output.text);
  return output.text;
}
