/* Copyright (c) 2026 Lean FRO LLC. Released under Apache 2.0. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { evaluate, launchChromium, openChromiumPage } from "../browser/harness.mjs";
import { runSync } from "../../scripts/process-utils.mjs";
import { runRpcBrowserAcceptance } from "./rpc-browser-harness.mjs";

const root = new URL("../../", import.meta.url);
await mkdir(new URL("build/native-infoview-port/", root), { recursive: true });
runSync("lake", ["build", "vir_irpkg", "+VirNativeInfoview"], { cwd: root });
runSync("lake", ["env", ".lake/build/bin/vir_irpkg",
  "build/native-infoview-port/goals.irpkg", "build/native-infoview-port/goals.report.md",
  "--target-module", "VirNativeInfoview", "VirNativeInfoview.createComponent"], { cwd: root });
const [wasm, pkg, bundle] = await Promise.all([
  readFile(new URL("web/public/vir-upstream.wasm", root)),
  readFile(new URL("build/native-infoview-port/goals.irpkg", root)),
  build({ entryPoints: [fileURLToPath(new URL("native-goals-entry.js", import.meta.url))],
    bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env.NODE_ENV": '"development"' } }),
]);
const chrome = await launchChromium();
let cdp;
try {
  cdp = await openChromiumPage(chrome);
  await evaluate(cdp, `${bundle.outputFiles[0].text}\nvoid 0`);
  const result = await evaluate(cdp,
    `runNativeGoalPanel(${JSON.stringify([...wasm])},${JSON.stringify([...pkg])})
      .then(value => ({ok:true,value}), error => ({ok:false,error:error.stack}))`);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.value.warnings, [], "React warnings");
  const html = `<!doctype html><meta charset="utf-8"><title>Native infoview fixture</title>
    <style>body{font:14px system-ui;margin:24px;max-width:700px}button{margin:4px}header{margin-bottom:1em}
    .inserted-text{background:#dafbe1}.removed-text{background:#ffebe9}.highlighted-text{background:#fff8c5}
    .vir-native-infoview-code-tag[aria-expanded=true]{background:#ddf4ff}</style>${result.value.html}`;
  await writeFile(new URL("build/native-infoview-port/preview.html", root), html);
  await evaluate(cdp, `document.open();document.write(${JSON.stringify(html)});document.close();`);
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(new URL("build/native-infoview-port/preview.png", root), Buffer.from(screenshot.data, "base64"));
  await writeFile(new URL("build/native-infoview-port/result.json", root), JSON.stringify({
    checks: result.value.checks, warnings: result.value.warnings,
    initialConversions: result.value.initialConversions,
  }, null, 2) + "\n");
  console.log(`Native goal panel: ${result.value.checks} real Lean/Wasm/React checks passed`);
} finally {
  cdp?.close();
  await chrome.close();
}

const liveBundle = await build({
  entryPoints: [fileURLToPath(new URL("native-goals-rpc-entry.js", import.meta.url))],
  bundle: true, write: false, format: "iife", platform: "browser",
  define: { "process.env.NODE_ENV": '"development"' },
});
const live = await runRpcBrowserAcceptance({
  label: "Native infoview live type RPC",
  assets: new Map([
    ["/probe.js", ["text/javascript", liveBundle.outputFiles[0].contents]],
    ["/runtime.wasm", ["application/wasm", wasm]],
    ["/rpc.irpkg", ["application/octet-stream", pkg]],
  ]),
});
await writeFile(new URL("build/native-infoview-port/live-result.json", root), JSON.stringify(live, null, 2) + "\n");
console.log("Native goal panel live Lean server acceptance passed", live);
