#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  artifactBundlePaths,
  cleanArtifactBundle,
  copyArtifactMetadata,
  writeAndPublishArtifactArchive,
} from "./artifact-bundle.mjs";
import { copyFileWithDirs } from "../file-utils.mjs";
import { repositoryRoot } from "../repository-paths.mjs";
import { runSync } from "../process-utils.mjs";
import { PACKAGE_VERSIONS } from "./package-versions.mjs";
import { SDK_PAYLOADS } from "./sdk-payloads.mjs";

const artifactName = process.env.VIR_SDK_ARTIFACT_NAME ?? "lean-vir-sdk";
const artifactPaths = artifactBundlePaths(repositoryRoot, artifactName);

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

await cleanArtifactBundle(artifactPaths);

const files = [];
for (const [destRel, sourceRel] of SDK_PAYLOADS) {
  const source = join(repositoryRoot, sourceRel);
  const dest = join(artifactPaths.bundleDir, destRel);
  await copyFileWithDirs(source, dest);
  files.push({
    path: destRel,
    source: sourceRel,
    sha256: await sha256(dest),
  });
}

await copyArtifactMetadata(repositoryRoot, artifactPaths.bundleDir);

const packageJson = JSON.parse(
  await readFile(join(repositoryRoot, "package.json"), "utf8"),
);
const packageLock = JSON.parse(
  await readFile(join(repositoryRoot, "package-lock.json"), "utf8"),
);
const externalDependencies = Object.fromEntries(
  ["react", "react-dom"].map((name) => {
    const version = packageLock.packages?.[`node_modules/${name}`]?.version;
    if (typeof version !== "string" || version.length === 0) {
      throw new Error(`package-lock.json does not pin ${name}`);
    }
    return [name, version];
  }),
);
const leanToolchain = (
  await readFile(join(repositoryRoot, "lean-toolchain"), "utf8")
).trim();
const gitCommit = runSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  capture: true,
});
const gitStatus = runSync("git", ["status", "--short"], {
  cwd: repositoryRoot,
  capture: true,
});
const leanVersion = runSync("lean", ["--version"], {
  cwd: repositoryRoot,
  capture: true,
});
const artifactManifest = {
  name: artifactName,
  version: packageJson.version,
  gitCommit,
  gitDirty: gitStatus.length !== 0,
  leanToolchain,
  leanVersion,
  ...PACKAGE_VERSIONS,
  externalDependencies,
  generatedAt: new Date().toISOString(),
  files,
};
await writeFile(
  join(artifactPaths.bundleDir, "lean-vir-artifact.json"),
  `${JSON.stringify(artifactManifest, null, 2)}\n`,
);
await writeFile(
  join(artifactPaths.bundleDir, "README.txt"),
  `Lean VIR SDK
============

This SDK contains the JavaScript runtime modules and wasm32-wasip1 interpreter
for the matching lean_vir package revision.

It exposes the direct runtime API for custom hosts and existing integrations.
The application resource workflow uses a separately prepared runtime.js loader
with createProgram; that facade exposes status, call and dispose. Start ordinary
applications with the complete resource example:
https://github.com/ejgallego/lean-vir/blob/main/docs/guides/EMBEDDED_RESOURCES.md

Official support covers the runtime, packages, object API and minimal JS/Lean
interop. DOM, React/JSX, widgets, broad generated bindings and automatic conversion
of records and custom inductives are experimental, including when shipped in this
archive. Arrays inherit the support status of their element representations.
See the support scope for details and the planned 0.1.1 JSON converter API:
https://github.com/ejgallego/lean-vir/blob/main/docs/SUPPORT.md

The JavaScript files are ES modules. The generic runtime and host-binding
modules do not import React; js/vir-react-host-bindings.js imports react and
react-dom/client and should only be used by browser React integrations. Their
exact build-time versions are recorded under externalDependencies in
lean-vir-artifact.json.

SDK host code should import the entry modules directly under js/:

  js/vir-runtime.js
  js/vir-runtime-node.js
  js/vir-host-bindings.js
  js/vir-react-host-bindings.js

Nested js/runtime/, js/host/, and js/react/ modules are shipped so those entry
modules can resolve relative imports. They remain internal implementation
modules and may change with the matching lean_vir revision.

For a host using this SDK, mark JavaScript-callable declarations with
@[vir_export] and startup hooks with @[vir_startup], then build the module
package and matching SDK:

  lake build +MyApp.Runtime:vir
  lake build :virSdk

The SDK installer needs a matching published SDK release. For an unreleased
revision, VIR_SDK_COMMIT selects an existing, unexpired Actions artifact for
that exact commit; downloading it requires GitHub authentication. A runtime
resource release is not an SDK release. VIR_SDK_ARCHIVE selects a matching
archive supplied locally, without downloading it.

The module facet creates a descriptor plus ordinary .irpkg members. Serve:

  wasm/vir-upstream.wasm
  the complete js/ directory, preserving relative imports
  your generated .irpkg-set.json and all of its .irpkg members
  the SDK license notices

wasm/vir-upstream.wasm is the stripped release artifact and is selected by
default. wasm/vir-upstream.dev.wasm is an optimized, unstripped debugging
companion.
Serve the companion alongside the release Wasm when enabling debugWasm.

Minimal browser usage:

  import { createVirRuntime } from "./js/vir-runtime.js";

  const vir = await createVirRuntime({
    wasmUrl: "./wasm/vir-upstream.wasm",
    irPackageSet: "./MyApp/Runtime.irpkg-set.json",
  });

  vir.runStartupEntries();

Call vir.dispose() when the page or application is torn down.

Set debugWasm: true to load ./wasm/vir-upstream.dev.wasm instead:

  const debugVir = await createVirRuntime({
    wasmUrl: "./wasm/vir-upstream.wasm",
    debugWasm: true,
    irPackageSet: "./MyApp/Runtime.irpkg-set.json",
  });

Experimental browser React root usage:

  import { createVirRuntimeFactory } from "./js/vir-runtime.js";
  import {
    createBrowserHostBindings,
  } from "./js/vir-host-bindings.js";
  import { createBrowserReactHostBindings } from "./js/vir-react-host-bindings.js";

  const factory = createVirRuntimeFactory({
    wasmUrl: "./wasm/vir-upstream.wasm",
    defaultHostBindings: () =>
      createBrowserHostBindings({
        reactHostBindings: createBrowserReactHostBindings,
      }),
  });

Check lean-vir-artifact.json before mixing this SDK with generated packages
from another lean_vir revision.
`,
);

await writeAndPublishArtifactArchive(repositoryRoot, artifactPaths);
