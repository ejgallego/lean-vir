/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { evaluate, launchChromium, openChromiumPage } from "./harness.mjs";
import { smokeBrowserReactLifetimes } from "./react-lifetimes.mjs";
import { readRuntimeArtifacts } from "../runtime/shared.mjs";

const { wasmBytes, hostPackageBytes } = await readRuntimeArtifacts();
const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL("./generation-gc-entry.js", import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  define: { "process.env.NODE_ENV": '"development"' },
});
const chromium = await launchChromium({ exposeGc: true });
let cdp;
try {
  cdp = await openChromiumPage(chromium);
  await evaluate(cdp, `${bundle.outputFiles[0].text}\nvoid 0;`);
  const result = await evaluate(
    cdp,
    `runVirGenerationGc(${JSON.stringify([...wasmBytes])},${JSON.stringify([...hostPackageBytes])})`,
  );
  assert.equal(result.gc.collectedGraphs, 3);
  await smokeBrowserReactLifetimes(cdp);
  console.log(
    "Chromium real-Wasm generation GC and React lifetime smoke ok",
    result,
  );
} finally {
  cdp?.close();
  await chromium.close();
}
