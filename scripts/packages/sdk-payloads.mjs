/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";

import { SDK_METADATA_FILES } from "./sdk-metadata.mjs";

export const SDK_PAYLOADS = [
  ["wasm/vir-upstream.wasm", "web/public/vir-upstream.wasm"],
  ["wasm/vir-upstream.dev.wasm", "web/public/vir-upstream.dev.wasm"],
  ["js/vir-web-assets.js", "web/src/vir-web-assets.js"],
  ["js/vir-runtime.js", "web/src/vir-runtime.js"],
  ["js/vir-runtime-node.js", "web/src/vir-runtime-node.js"],
  ["js/vir-host-bindings.js", "web/src/vir-host-bindings.js"],
  ["js/vir-browser-host-bindings.js", "web/src/vir-browser-host-bindings.js"],
  ["js/vir-react-host-bindings.js", "web/src/vir-react-host-bindings.js"],
  ["js/vir-react-dom-client.js", "web/src/vir-react-dom-client.js"],
  ["js/host-resource.js", "web/src/host-resource.js"],
  ["js/runtime/call-timing.js", "web/src/runtime/call-timing.js"],
  ["js/runtime/callbacks.js", "web/src/runtime/callbacks.js"],
  ["js/runtime/cleanup.js", "web/src/runtime/cleanup.js"],
  ["js/runtime/core.js", "web/src/runtime/core.js"],
  ["js/runtime/object-values.js", "web/src/runtime/object-values.js"],
  ["js/runtime/vir-codec.js", "web/src/runtime/vir-codec.js"],
  ["js/runtime/host-state.js", "web/src/runtime/host-state.js"],
  ["js/runtime/object-abi.js", "web/src/runtime/object-abi.js"],
  ["js/runtime/object-abi-exports.js", "web/src/runtime/object-abi-exports.js"],
  ["js/runtime/vir-value-normalizers.js", "web/src/runtime/vir-value-normalizers.js"],
  ["js/runtime/interface-effects.js", "web/src/runtime/interface-effects.js"],
  ["js/runtime/interface-manifest.js", "web/src/runtime/interface-manifest.js"],
  ["js/runtime/interface-tags.js", "web/src/runtime/interface-tags.js"],
  ["js/host/vir-host-resources.js", "web/src/host/vir-host-resources.js"],
  ["js/host/vir-js-collection-bindings.js", "web/src/host/vir-js-collection-bindings.js"],
  ["js/host/vir-js-value-bindings.js", "web/src/host/vir-js-value-bindings.js"],
  ["js/host/vir-proofwidgets-refs.js", "web/src/host/vir-proofwidgets-refs.js"],
  ["js/host/vir-virtual-host-bindings.js", "web/src/host/vir-virtual-host-bindings.js"],
  ["js/react/vir-react-node.js", "web/src/react/vir-react-node.js"],
  ["js/react/vir-react-hooks.js", "web/src/react/vir-react-hooks.js"],
];

export const SDK_BROWSER_PROFILE = Object.freeze({
  webAssetsModule: "js/vir-web-assets.js",
  runtimeModule: "js/vir-runtime.js",
  wasm: "wasm/vir-upstream.wasm",
});

const SDK_PAYLOAD_PATHS = new Set(SDK_PAYLOADS.map(([destination]) => destination));
const STATIC_MODULE_SPECIFIER = /\b(?:import|export)\s+(?:[^"']*?\s+from\s*)?["'](\.[^"']+)["']/g;

function resolveSdkModule(importer, specifier) {
  const resolved = posix.normalize(posix.join(posix.dirname(importer), specifier));
  return posix.extname(resolved) === "" ? `${resolved}.js` : resolved;
}

export async function sdkBrowserFiles(root) {
  const selected = new Set([
    ...SDK_METADATA_FILES,
    SDK_BROWSER_PROFILE.webAssetsModule,
    SDK_BROWSER_PROFILE.runtimeModule,
    SDK_BROWSER_PROFILE.wasm,
  ]);
  const pending = [
    SDK_BROWSER_PROFILE.webAssetsModule,
    SDK_BROWSER_PROFILE.runtimeModule,
  ];

  while (pending.length > 0) {
    const importer = pending.pop();
    const source = await readFile(join(root, importer), "utf8");
    for (const match of source.matchAll(STATIC_MODULE_SPECIFIER)) {
      const dependency = resolveSdkModule(importer, match[1]);
      if (!SDK_PAYLOAD_PATHS.has(dependency)) {
        throw new Error(
          `browser SDK module ${importer} imports unshipped module ${dependency}`,
        );
      }
      if (!selected.has(dependency)) {
        selected.add(dependency);
        pending.push(dependency);
      }
    }
  }

  return [
    ...SDK_METADATA_FILES,
    ...SDK_PAYLOADS.map(([destination]) => destination).filter((path) => selected.has(path)),
  ];
}

export const SDK_JS_MODULES = SDK_PAYLOADS
  .map(([dest]) => dest)
  .filter((dest) => dest.startsWith("js/"))
  .map((dest) => dest.slice("js/".length));

export function sdkArchiveEntries(root = "lean-vir-sdk") {
  return [
    ...SDK_METADATA_FILES.map((entry) => `${root}/${entry}`),
    `${root}/lean-vir-artifact.json`,
    ...SDK_PAYLOADS.map(([dest]) => `${root}/${dest}`),
  ];
}
