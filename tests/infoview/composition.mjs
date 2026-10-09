/* Copyright (c) 2026 Lean FRO LLC. Released under Apache 2.0. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { runSync } from "../../scripts/process-utils.mjs";
import { runRpcBrowserAcceptance } from "./rpc-browser-harness.mjs";

const root = new URL("../../", import.meta.url);
const mode = process.env.VIR_INFOVIEW_COMPOSITION_MODE ?? "production";
if (!["production", "development"].includes(mode)) throw new Error(`Unknown composition mode: ${mode}`);
await mkdir(new URL("build/native-infoview-port/", root), { recursive: true });
runSync("lake", ["build", "vir_irpkg", "+VirNativeInfoview.Comparison"], { cwd: root });
runSync("lake", ["env", ".lake/build/bin/vir_irpkg",
  `build/native-infoview-port/comparison-${mode}.irpkg`, `build/native-infoview-port/comparison-${mode}.report.md`,
  "--target-module", "VirNativeInfoview.Comparison", "VirNativeInfoview.Comparison.createComponent"], { cwd: root });
const [wasm, pkg, css, bundle] = await Promise.all([
  readFile(new URL("web/public/vir-upstream.wasm", root)),
  readFile(new URL(`build/native-infoview-port/comparison-${mode}.irpkg`, root)),
  readFile(new URL("node_modules/@leanprover/infoview/dist/index.css", root)),
  build({ entryPoints: [fileURLToPath(new URL("composition-rpc-entry.js", import.meta.url))],
    bundle: true, write: false, format: "iife", platform: "browser",
    plugins: [{ name: "infoview-react-dom-compat", setup(builder) {
      builder.onResolve({ filter: /^react-dom$/ }, args => {
        if (args.importer.includes("@leanprover/infoview/dist/"))
          return { path: fileURLToPath(new URL("react-dom-compat.js", import.meta.url)) };
      });
    } }],
    define: { "process.env.NODE_ENV": JSON.stringify(mode) } }),
]);
const result = await runRpcBrowserAcceptance({
  label: "External InteractiveCode composition",
  resultExpression: "globalThis.rpcAcceptance ?? ({ok:false,error:JSON.stringify(globalThis.__virRpcBrowserErrors)})",
  assets: new Map([
    ["/", ["text/html", '<!doctype html><link rel="stylesheet" href="/infoview.css"><div id="app"></div><script src="/probe.js"></script>']],
    ["/infoview.css", ["text/css", css]],
    ["/probe.js", ["text/javascript", bundle.outputFiles[0].contents]],
    ["/runtime.wasm", ["application/wasm", wasm]],
    ["/rpc.irpkg", ["application/octet-stream", pkg]],
  ]),
});
await writeFile(new URL(`build/native-infoview-port/composition-${mode}-result.json`, root), JSON.stringify(result, null, 2) + "\n");
console.log("External InteractiveCode composition passed", result);
