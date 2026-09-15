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
const hoverBundle = await build({
  entryPoints: [fileURLToPath(new URL("native-hover-entry.js", import.meta.url))],
  bundle: true, write: false, format: "iife", platform: "browser",
  define: { "process.env.NODE_ENV": '"development"' },
});
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

// This is the browser-level gate: CDP moves the real pointer through the
// actual Wasm/React renderer.  Synthetic events above remain useful for the
// dense state matrix, but cannot prove the portal transition geometry.
const hoverChrome = await launchChromium();
let hoverCdp;
try {
  hoverCdp = await openChromiumPage(hoverChrome);
  const upstreamCss = await readFile(new URL("node_modules/@leanprover/infoview/dist/index.css", root), "utf8");
  await evaluate(hoverCdp, `(() => { const style = document.createElement('style');
    style.textContent = ${JSON.stringify(upstreamCss)}; document.head.append(style); })()`);
  await evaluate(hoverCdp, `${hoverBundle.outputFiles[0].text}\nvoid 0`);
  await evaluate(hoverCdp,
    `setupNativeHoverPanel(${JSON.stringify([...wasm])},${JSON.stringify([...pkg])})`);
  const initial = await evaluate(hoverCdp, `nativeHoverController.theme(false); nativeHoverController.snapshot()`);
  const parent = initial.tags.find(tag => tag.text.includes("prefix") && tag.text.includes("suffix"));
  const child = initial.tags.find(tag => tag.text === "child");
  const sibling = initial.tags.find(tag => tag.text === "sibling");
  assert.ok(parent && child && sibling && initial.prefixRect && initial.suffixRect,
    "real-pointer fixture rendered nested parent, child and sibling terms");
  const snapshot = () => evaluate(hoverCdp, "nativeHoverController.snapshot()");
  const move = (x, y) => hoverCdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  const moveTo = rect => move(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  // The literal prefix is inside the parent tag but outside either nested tag.
  await moveTo(initial.prefixRect);
  const started = performance.now();
  await wait(460);
  const beforeOpen = await snapshot();
  assert.equal(beforeOpen.popup, false, "real pointer does not open hover early");
  assert.equal(beforeOpen.requests, 0, "real pointer does not request type early");
  await wait(130);
  let opened = await snapshot();
  const elapsed = performance.now() - started;
  assert.deepEqual(opened.highlighted, [parent.id], "literal parent area highlights only parent");
  assert.equal(opened.requests, 1, "real pointer issues one parent type RPC after hover delay");
  assert.deepEqual(opened.refs, ["parent"], "parent hover preserves its exact RPC reference");
  assert.deepEqual(opened.tags.map(tag => tag.instance), initial.tags.map(tag => tag.instance),
    "opening parent portal preserves nested tag DOM identities");
  assert.ok(elapsed >= 500 && elapsed < 850, `hover open timing ${elapsed}ms is bounded`);
  assert.equal(opened.portal, true, "type popup is appended to document.body");
  assert.equal(opened.popupPosition, "fixed", "type popup uses fixed portal positioning");
  assert.deepEqual(opened.tag, initial.tag, "opening portal does not shift tagged-term layout");
  assert.deepEqual(opened.popupStyle, {
    color: "rgb(51, 51, 51)", background: "rgb(243, 243, 243)", radius: "4px",
    shadow: "rgba(0, 0, 0, 0.2) 1px 1px 5px 0px", padding: "4px 24px 4px 8px",
    docFont: "system-ui", codeFont: "monospace", separators: 1,
  }, "light popup uses upstream theme tokens and separates code from prose");
  const hoverScreenshot = await hoverCdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(new URL("build/native-infoview-port/hover-preview.png", root), Buffer.from(hoverScreenshot.data, "base64"));
  await evaluate(hoverCdp, "nativeHoverController.theme(true)");
  const dark = await snapshot();
  assert.equal(dark.popupStyle.color, "rgb(221, 221, 221)", "dark popup foreground follows theme");
  assert.equal(dark.popupStyle.background, "rgb(37, 37, 38)", "dark popup background follows theme");
  assert.equal(dark.requests, opened.requests, "theme change does not restart type RPC");
  const darkScreenshot = await hoverCdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(new URL("build/native-infoview-port/hover-preview-dark.png", root), Buffer.from(darkScreenshot.data, "base64"));
  await evaluate(hoverCdp, "nativeHoverController.theme(false)");
  await moveTo(child.rect);
  await wait(460);
  let transitioned = await snapshot();
  assert.deepEqual(transitioned.highlighted, [child.id], "real pointer parent-to-child has one deepest highlight");
  assert.equal(transitioned.requests, 1, "child transition waits before issuing its RPC");
  await wait(130);
  transitioned = await snapshot();
  assert.deepEqual(transitioned.highlighted, [child.id], "child remains the sole active highlight");
  assert.deepEqual(transitioned.refs, ["parent", "child"], "child transition uses its exact RPC reference");
  await moveTo(sibling.rect);
  await wait(460);
  transitioned = await snapshot();
  assert.deepEqual(transitioned.highlighted, [sibling.id], "real pointer child-to-sibling has one deepest highlight");
  assert.equal(transitioned.requests, 2, "sibling transition waits before issuing its RPC");
  await wait(130);
  opened = await snapshot();
  assert.deepEqual(opened.highlighted, [sibling.id], "sibling remains the sole active highlight");
  assert.deepEqual(opened.refs, ["parent", "child", "sibling"],
    "sibling transition uses its exact RPC reference after delay");
  await move(opened.popupRect.left + opened.popupRect.width / 2, opened.popupRect.top + opened.popupRect.height / 2);
  await wait(350);
  assert.equal((await snapshot()).popup, true, "moving pointer into popup keeps it open");
  const closeStarted = performance.now();
  await move(4, 4);
  await wait(240);
  assert.equal((await snapshot()).popup, true, "real pointer close delay has not elapsed early");
  await wait(130);
  assert.equal((await snapshot()).popup, false, "real pointer closes portal after leave delay");
  const closeElapsed = performance.now() - closeStarted;
  assert.ok(closeElapsed >= 300 && closeElapsed < 850, `hover close timing ${closeElapsed}ms is bounded`);
  const hoverWarnings = await evaluate(hoverCdp, "nativeHoverController.dispose()");
  assert.deepEqual(hoverWarnings, [], "real-pointer fixture emitted no React warnings");
  console.log("Native infoview real pointer hover acceptance passed");
} finally {
  hoverCdp?.close();
  await hoverChrome.close();
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
