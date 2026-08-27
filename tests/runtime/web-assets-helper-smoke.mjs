/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createVirWebAssetsRuntime,
  validateVirWebAssetsManifest,
} from "../../web/src/vir-web-assets.js";

const digest = "0".repeat(64);
const compatibility = Object.freeze({
  packageFormatVersion: 10,
  manifestVersion: 7,
  runtimeAbiVersion: 1,
  leanVersion: "4.34.0-rc2",
  leanToolchain: "leanprover/lean4:v4.34.0-rc2",
  leanGithash: "1".repeat(40),
});

function file(path) {
  return { path, sha256: digest, byteSize: 1 };
}

function manifest() {
  return {
    format: "lean-vir-web-assets",
    version: 1,
    hostPackage: "consumer-app",
    vir: {
      version: "0.1.0",
      gitCommit: "3".repeat(40),
    },
    sdk: {
      version: "0.1.0",
      gitCommit: "3".repeat(40),
      manifest: "sdk/lean-vir-artifact.json",
      webAssetsModule: "sdk/js/vir-web-assets.js",
      runtimeModule: "sdk/js/vir-runtime.js",
      wasm: "sdk/wasm/vir-upstream.wasm",
      compatibility,
      files: [
        file("sdk/lean-vir-artifact.json"),
        file("sdk/js/vir-web-assets.js"),
        file("sdk/js/vir-runtime.js"),
        file("sdk/wasm/vir-upstream.wasm"),
      ],
    },
    programs: [{
      id: "slides",
      package: "verso-slides",
      module: "VersoSlides.VirPrettyM",
      descriptor: "programs/slides/VirPrettyM.irpkg-set.json",
      compatibility,
      files: [file("programs/slides/VirPrettyM.irpkg-set.json")],
    }],
  };
}

assert.equal(validateVirWebAssetsManifest(manifest()).programs[0].id, "slides");
const normalizedToolchain = manifest();
normalizedToolchain.sdk.compatibility = {
  ...compatibility,
  leanToolchain: "leanprover/lean4:4.34.0-rc2",
};
assert.equal(
  validateVirWebAssetsManifest(normalizedToolchain).programs[0].id,
  "slides",
);
const traversal = manifest();
traversal.programs[0].descriptor = "programs/slides/../secret.irpkg";
assert.throws(() => validateVirWebAssetsManifest(traversal), /normalized relative URL path/);
const mismatch = manifest();
mismatch.programs[0].compatibility = {
  ...compatibility,
  leanGithash: "2".repeat(40),
};
assert.throws(() => validateVirWebAssetsManifest(mismatch), /compatibility mismatch/);
const sdkIdentityMismatch = manifest();
sdkIdentityMismatch.sdk.gitCommit = "4".repeat(40);
assert.throws(
  () => validateVirWebAssetsManifest(sdkIdentityMismatch),
  /does not match its lean_vir identity/,
);

const root = await mkdtemp(join(tmpdir(), "lean-vir-web-assets-helper-"));
try {
  const runtimeModulePath = join(root, "sdk", "js", "vir-runtime.js");
  await mkdir(join(root, "sdk", "js"), { recursive: true });
  await writeFile(join(root, "package.json"), "{\"type\":\"module\"}\n");
  await writeFile(runtimeModulePath, `
    export function createVirRuntimeFactory(options) {
      globalThis.__virWebAssetsFactoryOptions = options;
      return {
        async createRuntime(runtimeOptions) {
          globalThis.__virWebAssetsRuntimeOptions = runtimeOptions;
          return { source: "named-program" };
        },
      };
    }
  `);
  const manifestUrl = pathToFileURL(join(root, "VIR_WEB_ASSETS.json"));
  const fetchManifest = async () => new Response(JSON.stringify(manifest()), {
    headers: { "content-type": "application/json" },
  });
  const runtime = await createVirWebAssetsRuntime(manifestUrl, "slides", {
    fetchManifest,
    sentinel: 42,
  });
  assert.deepEqual(runtime, { source: "named-program" });
  assert.equal(globalThis.__virWebAssetsFactoryOptions.sentinel, 42);
  assert.equal(
    globalThis.__virWebAssetsFactoryOptions.wasmUrl.href,
    pathToFileURL(join(root, "sdk", "wasm", "vir-upstream.wasm")).href,
  );
  assert.equal(
    globalThis.__virWebAssetsRuntimeOptions.irPackageSetUrl.href,
    pathToFileURL(join(root, "programs", "slides", "VirPrettyM.irpkg-set.json")).href,
  );
  const inferredRuntime = await createVirWebAssetsRuntime(manifestUrl, {
    fetchManifest,
  });
  assert.deepEqual(inferredRuntime, { source: "named-program" });
  const multiProgramManifest = manifest();
  multiProgramManifest.programs.push({
    ...multiProgramManifest.programs[0],
    id: "search",
    descriptor: "programs/search/Search.irpkg-set.json",
    files: [file("programs/search/Search.irpkg-set.json")],
  });
  await assert.rejects(
    createVirWebAssetsRuntime(manifestUrl, {
      fetchManifest: async () => new Response(JSON.stringify(multiProgramManifest)),
    }),
    /program id is required; available programs: slides, search/,
  );
  await assert.rejects(
    createVirWebAssetsRuntime(manifestUrl, "unknown", { fetchManifest }),
    /unknown VIR web-assets program/,
  );
  await assert.rejects(
    createVirWebAssetsRuntime(manifestUrl, "slides", {
      fetchManifest,
      debugWasm: true,
    }),
    /selected by VIR_WEB_ASSETS.json/,
  );
} finally {
  delete globalThis.__virWebAssetsFactoryOptions;
  delete globalThis.__virWebAssetsRuntimeOptions;
  await rm(root, { recursive: true, force: true });
}

console.log("VIR web-assets browser helper smoke ok");
