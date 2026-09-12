/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { evaluate, launchChromium, openChromiumPage } from "./harness.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [wasm, pkg] = await Promise.all([
  readFile(new URL("../../web/public/vir-upstream.wasm", import.meta.url)),
  readFile(new URL("../../build/shell-lifetime.irpkg", import.meta.url)),
]);
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ["tests/browser/shell-lifetime-entry.js"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "shell-observation",
      setup(builder) {
        builder.onResolve({ filter: /^@leanprover\/infoview$/ }, () => ({
          path: "infoview",
          namespace: "shell-test",
        }));
        builder.onLoad({ filter: /.*/, namespace: "shell-test" }, () => ({
          contents: `import * as React from 'react';
        export const EditorContext = React.createContext(null);
        export function useClientNotificationEffect() { throw new Error('unexpected lifecycle notification hook'); }
        export function useRpcSession() { return globalThis.__shellTest.rpc; }`,
          loader: "js",
          resolveDir: root,
        }));
        builder.onLoad(
          { filter: /web\/src\/vir-runtime\.js$/ },
          async ({ path }) => ({
            contents:
              (await readFile(path, "utf8")).replace(
                "export async function createVirRuntime(options = {}) {",
                "async function unobservedCreateVirRuntime(options = {}) {",
              ) +
              `\nexport async function createVirRuntime(options = {}) {
        const observed = globalThis.__shellTest.runtimeOptions(options);
        const runtime = await unobservedCreateVirRuntime(observed.options);
        globalThis.__shellTest.created(runtime, observed.state);
        return runtime;
      }`,
            loader: "js",
            resolveDir: fileURLToPath(
              new URL("../../web/src/", import.meta.url),
            ),
          }),
        );
        builder.onLoad({ filter: /vir-react-dom-client\.js$/ }, () => ({
          contents: `import { createRoot as actualCreateRoot } from 'react-dom/client';
        export function createRoot(container) {
          const root = actualCreateRoot(container);
          globalThis.__shellTest.createdRoot(root);
          return root;
        }`,
          loader: "js",
          resolveDir: root,
        }));
        // Observe ownership without exporting a production test hook or changing policy.
        builder.onLoad(
          { filter: /vir-infoview-widget\.js$/ },
          async ({ path }) => ({
            contents: (await readFile(path, "utf8")).replace(
              "const loadedRef = React.useRef(null);",
              "const loadedRef = React.useRef(null); globalThis.__shellTest.loadedRef = loadedRef;",
            ),
            loader: "js",
            resolveDir: fileURLToPath(
              new URL("../../web/app/", import.meta.url),
            ),
          }),
        );
      },
    },
  ],
});
const chromium = await launchChromium({ exposeGc: true });
let cdp;
try {
  cdp = await openChromiumPage(chromium);
  await evaluate(cdp, `${bundle.outputFiles[0].text}\nvoid 0;`);
  const result = await evaluate(
    cdp,
    `runShellLifetime(${JSON.stringify(wasm.toString("base64"))}, ${JSON.stringify(pkg.toString("base64"))})`,
  );
  assert.equal(result.ok, true);
  console.log("actual shell/Lean/Chromium lifetime smoke ok", result);
} finally {
  cdp?.close();
  await chromium.close();
}
