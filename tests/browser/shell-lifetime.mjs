/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  evaluate,
  launchChromium,
  navigate,
  openChromiumPage,
} from "./harness.mjs";
import {
  readIrPackageInfo,
  replaceIrPackageManifest,
} from "../../scripts/packages/irpkg-format.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

function run(args) {
  const result = spawnSync("lake", args, {
    cwd: root,
    stdio: "inherit",
    timeout: 120000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `lake ${args.join(" ")}`);
}

function prepareShellLifetimePackage() {
  run(["build", "VirInfoview", "vir_irpkg", "+ShellLifetime"]);
  run([
    "env",
    ".lake/build/bin/vir_irpkg",
    "build/shell-lifetime.irpkg",
    "build/shell-lifetime.report.md",
    "--target-module",
    "ShellLifetime",
    "Vir.Fixtures.ShellLifetime.createComponent",
  ]);
}
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
        export { TaggedText_stripTags } from '@leanprover/infoview-api';
        export const EditorContext = React.createContext(null);
        export const DocumentPosition = { toTdpp() { throw new Error('unexpected position conversion'); } };
        export function InteractiveCode() { throw new Error('unexpected interactive code render'); }
        export function useClientNotificationEffect() {}
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
      committedRequestRef.current.configurationKey = null;
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
    observed.includes("      candidate = await loadRuntimeService({"),
    "missing shell service await observation point",
  );
  assert.ok(
    observed.includes("      });\n      if (obsolete()) {"),
    "missing shell service await completion point",
  );
  observed = observed
    .replace(
      "      candidate = await loadRuntimeService({",
      "      candidate = await globalThis.__shellTest.afterLoadRuntimeService(\n        loadRuntimeService({",
    )
    .replace(
      "      });\n      if (obsolete()) {",
      "        }),\n      );\n      if (obsolete()) {",
    );
  const passiveCleanup = "      // React owns the descendant UI.";
  assert.ok(observed.includes(passiveCleanup), "missing passive cleanup observation point");
  return observed.replace(passiveCleanup,
    "      globalThis.__shellTest.widgetPassiveCleanup();\n" + passiveCleanup);
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

async function main() {
  prepareShellLifetimePackage();
  const [wasm, pkg, redBundle, greenBundle] = await Promise.all([
    readFile(join(root, "web/public/vir-upstream.wasm")),
    readFile(join(root, "build/shell-lifetime.irpkg")),
    buildShellLifetime({ withoutRemovalInvalidation: true }),
    buildShellLifetime(),
  ]);
  const manifest = structuredClone(readIrPackageInfo(pkg).manifest);
  manifest.metadata.generator = `${manifest.metadata.generator}:shell-lifetime-test`;
  const manifestChangedPackage = replaceIrPackageManifest(pkg, manifest);
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><div id=\"app\"></div>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let chromium;
  let cdp;
  try {
    chromium = await launchChromium({ exposeGc: true });
    cdp = await openChromiumPage(chromium);
    await navigate(cdp, `http://127.0.0.1:${server.address().port}/`);
    const wasmBase64 = wasm.toString("base64");
    const packageBase64 = pkg.toString("base64");
    const red = await runPendingRemovalControl(
      cdp,
      redBundle,
      wasmBase64,
      packageBase64,
    );
    assertPendingRemovalControl(red, {
      disposed: 0,
      factoryCalls: 1,
      cleanups: 0,
    });
    const green = await runPendingRemovalControl(
      cdp,
      greenBundle,
      wasmBase64,
      packageBase64,
    );
    assertPendingRemovalControl(green, {
      disposed: 1,
      factoryCalls: 0,
      cleanups: 0,
    });
    console.log(
      "actual React pending-removal control: red leak, green unpublished disposal",
    );
    await evaluate(cdp, `${greenBundle.outputFiles[0].text}\nvoid 0;`);
    const result = await evaluate(
      cdp,
      `runShellLifetime(${JSON.stringify(wasmBase64)}, ${JSON.stringify(packageBase64)}, ${JSON.stringify(Buffer.from(manifestChangedPackage).toString("base64"))})`,
    );
    assert.equal(result.ok, true);
    console.log("actual shell/Lean/Chromium lifetime smoke ok", result);
  } finally {
    cdp?.close();
    await chromium?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

await main();
