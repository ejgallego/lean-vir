/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { repositoryRoot } from "../../scripts/repository-paths.mjs";

test("Node runtime excludes browser and Infoview providers", async () => {
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["web/src/vir-runtime-node.js"],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "neutral",
  });
  for (const input of Object.keys(result.metafile.inputs)) {
    assert.doesNotMatch(
      input,
      /vir-(?:dom|active|infoview|react).*bindings|vir-host-bindings\.js|web\/app\//,
    );
    assert.doesNotMatch(input, /node_modules/);
  }
  assert.ok(result.metafile.inputs["web/src/host/vir-common-host-bindings.js"]);
});

test("internal primitive composition excludes structural codecs and browser providers", async () => {
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["web/src/runtime/primitive-factory.js"],
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "neutral",
  });
  const inputs = result.metafile.inputs;
  for (const input of Object.keys(inputs)) {
    assert.doesNotMatch(
      input,
      /\/(?:object-values|object-abi)\.js$/,
    );
    assert.doesNotMatch(
      input,
      /vir-(?:dom|active|infoview|react).*bindings|web\/app\//,
    );
  }
});
