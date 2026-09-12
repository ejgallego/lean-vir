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
async function buildShellLifetime({ withoutRemovalInvalidation = false } = {}) {
  return build({
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
        // Observe ownership without exporting a production test hook or changing policy.
        builder.onLoad(
          { filter: /vir-infoview-widget\.js$/ },
          async ({ path }) => ({
            contents: instrumentShellSource(
              await readFile(path, "utf8"),
              withoutRemovalInvalidation,
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
}

function instrumentShellSource(source, withoutRemovalInvalidation) {
  let observed = source.replace(
    "const loadedRef = React.useRef(null);",
    "const loadedRef = React.useRef(null); globalThis.__shellTest.loadedRef = loadedRef;",
  );
  const layoutInvalidation = `    return () => {
      // Invalidate pending candidates at removal, before passive cleanup runs.
      hostContextRef.current.configurationKey = null;
    };
`;
  if (withoutRemovalInvalidation) {
    assert.ok(
      observed.includes(layoutInvalidation),
      "red control requires the committed-removal invalidation",
    );
    observed = observed.replace(layoutInvalidation, "");
  }
  assert.ok(
    observed.includes("      service = await loadRuntimeService({"),
    "missing shell service await observation point",
  );
  assert.ok(
    observed.includes("      });\n      if (obsolete()) {"),
    "missing shell service await completion point",
  );
  observed = observed
    .replace(
      "      service = await loadRuntimeService({",
      "      service = await globalThis.__shellTest.afterLoadRuntimeService(\n        loadRuntimeService({",
    )
    .replace(
      "      });\n      if (obsolete()) {",
      "        }),\n      );\n      if (obsolete()) {",
    );
  assert.ok(
    observed.includes("    return () => {\n      disposed = true;"),
    "missing passive cleanup observation point",
  );
  return observed.replace(
    "    return () => {\n      disposed = true;",
    "    return () => {\n      globalThis.__shellTest.widgetPassiveCleanup();\n      disposed = true;",
  );
}

async function runPendingRemovalControl(cdp, bundle, wasmBase64, packageBase64) {
  await evaluate(cdp, `${bundle.outputFiles[0].text}\nvoid 0;`);
  return evaluate(
    cdp,
    `runPendingCandidateAfterCommittedRemoval(${JSON.stringify(wasmBase64)}, ${JSON.stringify(packageBase64)})`,
  );
}

function assertPendingRemovalControl(result, expected) {
  assert.deepEqual(result.timing, {
    loadReady: true,
    removalLayoutCleanups: 1,
    passiveCleanups: 1,
    passiveCleanupsAtHandoff: 0,
    shellRemovedAtHandoff: true,
  });
  assert.deepEqual(result.candidate, expected);
  assert.equal(result.loaded, false);
}

const [redBundle, greenBundle] = await Promise.all([
  buildShellLifetime({ withoutRemovalInvalidation: true }),
  buildShellLifetime(),
]);
const chromium = await launchChromium({ exposeGc: true });
let cdp;
try {
  cdp = await openChromiumPage(chromium);
  const wasmBase64 = wasm.toString("base64");
  const packageBase64 = pkg.toString("base64");
  const red = await runPendingRemovalControl(cdp, redBundle, wasmBase64, packageBase64);
  assertPendingRemovalControl(red, { disposed: 0, factoryCalls: 1, cleanups: 0 });
  const green = await runPendingRemovalControl(cdp, greenBundle, wasmBase64, packageBase64);
  assertPendingRemovalControl(green, { disposed: 1, factoryCalls: 0, cleanups: 0 });
  console.log("actual React pending-removal control: red leak, green unpublished disposal");
  if (process.env.VIR_SHELL_LIFETIME_FOCUS_ONLY !== "1") {
    await evaluate(cdp, `${greenBundle.outputFiles[0].text}\nvoid 0;`);
    const result = await evaluate(
      cdp,
      `runShellLifetime(${JSON.stringify(wasmBase64)}, ${JSON.stringify(packageBase64)})`,
    );
    assert.equal(result.ok, true);
    console.log("actual shell/Lean/Chromium lifetime smoke ok", result);
  }
} finally {
  cdp?.close();
  await chromium.close();
}
