/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { prepareVirIrpkgSync } from "../../scripts/packages/irpkg-generator.mjs";
import { describeError, withCleanup } from "./rpc-test-support.js";
import { runRpcBrowserAcceptance } from "./rpc-browser-harness.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "vir-rpc-browser-"));

await withCleanup(async () => {
  const packagePath = join(temp, "rpc.irpkg");
  const generator = prepareVirIrpkgSync(root, {
    lakeTargets: ["VirInfoview", "+tutorials.RpcReferenceWidget"],
  });
  assert.equal(
    generator.ok,
    true,
    "RPC fixture requires the current generator and infoview imports",
  );
  const generated = spawnSync(
    generator.path,
    [
      packagePath,
      join(temp, "rpc.report.md"),
      "--target-module",
      "tutorials.RpcReferenceWidget",
      ...[
        "request",
        "reference",
        "readReference",
        "message",
        "View",
        "render",
      ].map((n) => `RpcReferenceWidget.${n}`),
    ],
    { cwd: root, env: generator.env, encoding: "utf8", timeout: 120000 },
  );
  if (generated.error) throw generated.error;
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const [irPackage, wasm, bundle] = await Promise.all([
    readFile(packagePath),
    readFile(join(root, "web/public/vir-upstream.wasm")),
    build({
      entryPoints: [join(root, "tests/infoview/rpc-browser-entry.js")],
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "chrome120",
      write: false,
      define: { "process.env.NODE_ENV": '"development"' },
    }),
  ]);
  return runRpcBrowserAcceptance({
    assets: new Map([
      ["/probe.js", ["text/javascript", bundle.outputFiles[0].contents]],
      ["/runtime.wasm", ["application/wasm", wasm]],
      ["/rpc.irpkg", ["application/octet-stream", irPackage]],
    ]),
  });
}, [["temporary files", () => rm(temp, { recursive: true, force: true })]])
  .then((result) => {
    console.log("real infoview RPC browser acceptance ok", result);
  })
  .catch((error) => {
    console.error(JSON.stringify(describeError(error), null, 2));
    process.exitCode = 1;
  });
