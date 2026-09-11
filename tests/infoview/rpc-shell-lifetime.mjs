/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { runRpcBrowserAcceptance } from "./rpc-browser-harness.mjs";
import { describeError } from "./rpc-test-support.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sourcePath = join(root, "fixtures/infoview/RpcShellLifetimeServer.lean");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function run(args) {
  const result = spawnSync("lake", args, {
    cwd: root,
    stdio: "inherit",
    timeout: 120000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `lake ${args.join(" ")}`);
}
function replaceOnce(source, before, after) {
  assert.equal(
    source.split(before).length,
    2,
    `unique observation point: ${before}`,
  );
  return source.replace(before, after);
}

async function main() {
  // No copied Lean program or simulated package: the server imports these exact
  // existing fixtures and the real shell invokes statIRPackage/buildIRPackage.
  run(["build", "VirInfoview", "+ShellLifetime"]);
  for (const fixture of [
    "fixtures/infoview/RpcBrowserServer",
  ]) {
    const output = join(root, ".lake/build/lib/lean", `${fixture}.olean`);
    await mkdir(dirname(output), { recursive: true });
    run(["env", "lean", "-o", output, `${fixture}.lean`]);
  }
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: ["tests/infoview/rpc-shell-lifetime-entry.js"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "rpc-shell-observation",
        setup(builder) {
          // Only the infoview context accessor is injected. It returns the actual
          // position-specific RpcSessionAtPos from the official client, not a mock.
          builder.onResolve({ filter: /^@leanprover\/infoview$/ }, () => ({
            path: "infoview",
            namespace: "rpc-shell-test",
          }));
          builder.onLoad({ filter: /.*/, namespace: "rpc-shell-test" }, () => ({
            contents: `import * as React from 'react';
            export const EditorContext = React.createContext(null);
            export function useRpcSession() { return globalThis.__rpcShell.session; }`,
            loader: "js",
            resolveDir: root,
          }));
          builder.onLoad(
            { filter: /web\/src\/vir-runtime\.js$/ },
            async ({ path }) => ({
              contents:
                replaceOnce(
                  await readFile(path, "utf8"),
                  "export async function createVirRuntime(options = {}) {",
                  "async function actualCreateVirRuntime(options = {}) {",
                ) +
                `
            export async function createVirRuntime(options = {}) {
              const observed = globalThis.__rpcShell.observe(options);
              const runtime = await actualCreateVirRuntime(observed.options);
              globalThis.__rpcShell.created(runtime, observed.state);
              return runtime;
            }`,
              loader: "js",
              resolveDir: dirname(path),
            }),
          );
        },
      },
    ],
  });
  const wasm = await readFile(join(root, "web/public/vir-upstream.wasm"));
  const result = await runRpcBrowserAcceptance({
    sourcePath,
    assets: new Map([
      ["/probe.js", ["text/javascript", bundle.outputFiles[0].contents]],
    ]),
    label: "real-server shell lifetime acceptance",
  });
  const sources = {};
  for (const path of [
    "fixtures/runtime/ShellLifetime.lean",
    "fixtures/infoview/RpcBrowserServer.lean",
    "fixtures/infoview/RpcShellLifetimeServer.lean",
    "web/app/vir-infoview-widget.js",
    "web/src/vir-widget-errors.js",
    "tests/infoview/rpc-shell-lifetime-entry.js",
  ])
    sources[path] = sha256(await readFile(join(root, path)));
  console.log(
    "real-server shell lifetime acceptance ok",
    JSON.stringify(
      {
        ...result,
        wasm: { sha256: sha256(wasm), byteSize: wasm.length },
        bundleSha256: sha256(bundle.outputFiles[0].contents),
        sources,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(JSON.stringify(describeError(error), null, 2));
  process.exitCode = 1;
});
