/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { readIrPackageInfo } from "../../scripts/packages/irpkg-format.mjs";
import { repositoryRootUrl as repoRoot } from "../../scripts/repository-paths.mjs";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";
import { manifestDiagnostics } from "../../web/src/runtime/interface-manifest.js";

const packagePath = "build/infoview-smoke/typed-rpc-widget.irpkg";
const packageBytes = await readFile(new URL(packagePath, repoRoot));
const info = readIrPackageInfo(packageBytes, { path: packagePath });

assert.equal(manifestDiagnostics(info.manifest).length, 0);

const exportsByEntry = new Map(
  info.manifest.exports.map((entry) => [entry.entry, entry]),
);
const createComponent = exportsByEntry.get(
  "InfoviewFixtures.TypedRpcWidget.createComponent",
);
const mount = exportsByEntry.get("InfoviewFixtures.TypedRpcWidget.mount");
assert.ok(createComponent, "typed RPC fixture omitted its component factory");
assert.ok(mount, "typed RPC fixture omitted its mount entry");
assert.equal(createComponent.effect, "runtime");
assert.equal(createComponent.args.length, 0);
assert.equal(createComponent.result.interfaceTag, INTERFACE_TAG.RESOURCE);
assert.equal(mount.effect, "dom");
assert.deepEqual(
  mount.args.map((argument) => argument.type.interfaceTag),
  [
    INTERFACE_TAG.RESOURCE,
    INTERFACE_TAG.RESOURCE,
    INTERFACE_TAG.CUSTOM_INDUCTIVE,
  ],
);
assert.equal(mount.args[2].type.name, "Lean.Vir.Infoview.RpcJson");
assert.deepEqual(
  mount.args[2].type.constructors.map((constructor) => constructor.jsName),
  ["null", "bool", "number", "string", "array", "object"],
);
assert.equal(mount.result.interfaceTag, INTERFACE_TAG.UNIT);

const roots = info.manifest.metadata.targets.flatMap(
  (target) => target.resolvedRoots ?? [],
);
assert.ok(roots.includes("InfoviewFixtures.TypedRpcWidget.createComponent"));
assert.ok(roots.includes("InfoviewFixtures.TypedRpcWidget.mount"));

console.log("typed RPC widget package contract ok");
