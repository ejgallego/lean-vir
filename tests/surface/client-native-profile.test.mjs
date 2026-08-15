/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  addClientNativeSurfaceCapabilities,
  parseClientNativeSurfaceProfile,
} from "../../scripts/client-native-surface-profile.mjs";
import { emptySurfaceReportV3 } from "./fixtures.mjs";

const manifest = {
  format: "lean-vir-client-native-externs",
  version: 1,
  modules: ["Client.Native"],
  externs: ["Client.Native.call"],
  providerSources: ["native.c"],
};

test("client-native surface profile adds the target ABI as a capability", () => {
  const profile = parseClientNativeSurfaceProfile(manifest);
  const report = addClientNativeSurfaceCapabilities(
    emptySurfaceReportV3(),
    graph([externNode("Client.Native.call")]),
    profile,
  );
  assert.equal(report.runtimeCapabilities.nativeExternCount, 1);
  assert.deepEqual(report.runtimeCapabilities.nativeExterns[0], {
    name: "Client.Native.call",
    symbol: "client_native_call",
    generateBoxedWrapper: true,
    params: [{ index: 3, borrow: true, type: "object" }],
    resultType: "uint32",
    deps: [],
  });
});

test("client-native surface profile rejects malformed or unresolved selections", () => {
  assert.throws(
    () => parseClientNativeSurfaceProfile({
      ...manifest,
      externs: ["Client.Native.call", "Client.Native.call"],
    }),
    /unique non-empty strings/,
  );
  assert.throws(
    () => addClientNativeSurfaceCapabilities(
      emptySurfaceReportV3(),
      graph([]),
      parseClientNativeSurfaceProfile(manifest),
    ),
    /is not a captured extern/,
  );
});

function graph(nodes) {
  return { nodes };
}

function externNode(name) {
  return {
    name,
    kind: "extern",
    targets: [{ kind: "standard", backend: "all", value: "client_native_call" }],
    abi: {
      params: [{ index: 3, borrow: true, type: "object" }],
      resultType: "uint32",
    },
  };
}
