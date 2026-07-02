/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const SDK_PAYLOADS = [
  ["wasm/vir-upstream.wasm", "web/public/vir-upstream.wasm"],
  ["wasm/vir-upstream.dev.wasm", "web/public/vir-upstream.dev.wasm"],
  ["js/vir-runtime.js", "web/src/vir-runtime.js"],
  ["js/vir-runtime-node.js", "web/src/vir-runtime-node.js"],
  ["js/vir-host-bindings.js", "web/src/vir-host-bindings.js"],
  ["js/vir-react-host-bindings.js", "web/src/vir-react-host-bindings.js"],
  ["js/vir-react-dom-client.js", "web/src/vir-react-dom-client.js"],
  ["js/host-resource.js", "web/src/host-resource.js"],
  ["js/runtime/callbacks.js", "web/src/runtime/callbacks.js"],
  ["js/runtime/core.js", "web/src/runtime/core.js"],
  ["js/runtime/object-values.js", "web/src/runtime/object-values.js"],
  ["js/runtime/vir-codec.js", "web/src/runtime/vir-codec.js"],
  ["js/runtime/host-state.js", "web/src/runtime/host-state.js"],
  ["js/runtime/object-abi.js", "web/src/runtime/object-abi.js"],
  ["js/runtime/vir-value-normalizers.js", "web/src/runtime/vir-value-normalizers.js"],
  ["js/runtime/interface-effects.js", "web/src/runtime/interface-effects.js"],
  ["js/runtime/interface-manifest.js", "web/src/runtime/interface-manifest.js"],
  ["js/runtime/wire-tags.js", "web/src/runtime/wire-tags.js"],
  ["js/host/vir-host-resources.js", "web/src/host/vir-host-resources.js"],
  ["js/host/vir-js-value-bindings.js", "web/src/host/vir-js-value-bindings.js"],
  ["js/host/vir-virtual-host-bindings.js", "web/src/host/vir-virtual-host-bindings.js"],
  ["js/react/vir-react-node.js", "web/src/react/vir-react-node.js"],
  ["js/react/vir-react-hooks.js", "web/src/react/vir-react-hooks.js"],
];

export const SDK_METADATA_ENTRIES = [
  "README.txt",
  "LICENSE",
  "NOTICE",
  "lean-vir-artifact.json",
];

export const SDK_JS_MODULES = SDK_PAYLOADS
  .map(([dest]) => dest)
  .filter((dest) => dest.startsWith("js/"))
  .map((dest) => dest.slice("js/".length));

export function sdkArchiveEntries(root = "lean-vir-sdk") {
  return [
    ...SDK_METADATA_ENTRIES.map((entry) => `${root}/${entry}`),
    ...SDK_PAYLOADS.map(([dest]) => `${root}/${dest}`),
  ];
}
