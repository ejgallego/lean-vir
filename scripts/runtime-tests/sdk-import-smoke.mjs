/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { SDK_JS_MODULES } from "../sdk-payloads.mjs";

const packaged = spawnSync(process.execPath, ["scripts/package-sdk-artifact.mjs"], {
  encoding: "utf8",
});
assert.equal(packaged.status, 0, packaged.stderr || packaged.stdout);

async function extractSdk(tempDir) {
  const extracted = spawnSync("tar", [
    "-xzf",
    "web/public/downloads/lean-vir-sdk.tar.gz",
    "-C",
    tempDir,
  ], { encoding: "utf8" });
  assert.equal(extracted.status, 0, extracted.stderr || extracted.stdout);
  const sdkRoot = join(tempDir, "lean-vir-sdk");
  await writeFile(join(sdkRoot, "package.json"), "{\"type\":\"module\"}\n");
  return join(sdkRoot, "js");
}

const isolatedDir = await mkdtemp(join(tmpdir(), "lean-vir-sdk-import-"));
try {
  const jsDir = await extractSdk(isolatedDir);
  const modules = {};
  for (const moduleName of SDK_JS_MODULES.filter((name) => name !== "vir-react-host-bindings.js")) {
    modules[moduleName] = await import(pathToFileURL(join(jsDir, moduleName)));
  }
  const runtime = modules["vir-runtime.js"];
  const nodeRuntime = modules["vir-runtime-node.js"];
  const hostBindings = modules["vir-host-bindings.js"];
  const codec = modules["runtime/vir-codec.js"];
  const leanCodec = modules["runtime/vir-lean-codec.js"];
  const valueCodec = modules["runtime/vir-value-codec.js"];
  const primitiveLanes = modules["runtime/primitive-lanes.js"];
  const reactNode = modules["react/vir-react-node.js"];
  const interfaceManifest = modules["runtime/interface-manifest.js"];
  const wireTags = modules["runtime/wire-tags.js"];

  assert.equal(typeof runtime.createVirRuntime, "function");
  assert.equal(typeof runtime.roundTripInterfaceTypeDescriptor, "function");
  assert.equal(typeof nodeRuntime.createVirRuntime, "function");
  assert.equal(typeof hostBindings.createHostResourceState, "function");
  assert.equal(typeof codec.decodeTypeDescriptor, "function");
  assert.equal(typeof leanCodec.decodeExpr, "function");
  assert.equal(typeof valueCodec.decodeCallResult, "function");
  assert.equal(primitiveLanes.PRIMITIVE_LANE.STRING, 3);
  assert.equal(typeof reactNode.virtualReactTextContent, "function");
  assert.equal(typeof interfaceManifest.validateInterfaceManifest, "function");
  assert.equal(wireTags.WIRE.NAT, 0);

  const decoded = runtime.roundTripInterfaceTypeDescriptor({
    type: "Nat",
    wireTag: wireTags.WIRE.NAT,
  });
  assert.deepEqual(decoded, { wireTag: wireTags.WIRE.NAT });
} finally {
  await rm(isolatedDir, { recursive: true, force: true });
}

const tempRoot = join(process.cwd(), "build", "sdk-import-smoke");
await mkdir(tempRoot, { recursive: true });
const tempDir = await mkdtemp(join(tempRoot, "react-"));
try {
  const jsDir = await extractSdk(tempDir);
  const reactHostBindings = await import(pathToFileURL(join(jsDir, "vir-react-host-bindings.js")));
  const hostBindings = await import(pathToFileURL(join(jsDir, "vir-host-bindings.js")));
  const resources = hostBindings.createHostResourceState();
  const bindings = reactHostBindings.createBrowserReactHostBindings(resources);
  assert.equal(typeof reactHostBindings.createBrowserReactHostBindings, "function");
  assert.equal(typeof bindings["react.node.text"], "function");
  assert.equal(typeof bindings["react.node.createElement"], "function");
  assert.equal(typeof bindings["react.root.create"], "function");
  assert.equal(typeof bindings["react.root.render"], "function");
  assert.equal(typeof bindings["react.root.unmount"], "function");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("vir runtime SDK import smoke ok");
