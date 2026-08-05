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
let browserProbeBundle = null;

export async function smokeBrowserReactRefLifetime(cdp) {
  const source = await bundledBrowserProbe();
  await evaluate(cdp, `${source}\nvoid 0;\n//# sourceURL=lean-vir-react-ref-lifetime-smoke.js`);
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

async function bundledBrowserProbe() {
  if (browserProbeBundle !== null) return browserProbeBundle;
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("./browser-smoke-react-ref-lifetime-entry.js", import.meta.url))],
    bundle: true,
    define: {
      "process.env.NODE_ENV": '"production"',
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
    throw new Error("React ref lifetime browser probe did not produce a bundle");
  }
  browserProbeBundle = output.text;
  return browserProbeBundle;
}
