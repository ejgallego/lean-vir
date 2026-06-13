/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import {
  defaultPackageFile,
  hostPackageFile,
  leanPackageFile,
  prettyPackageFile,
  publicArtifactPath,
  wasmPublicFile,
} from "../browser-package-config.mjs";
import {
  roundTripInterfaceTypeDescriptor,
  sameInterfaceWireType,
} from "../../web/src/vir-runtime.js";
import {
  INTERFACE_MANIFEST_ARTIFACT,
  validateInterfaceManifest,
} from "../../web/src/runtime/interface-manifest.js";

export { assert, readFile, writeFile, spawnSync, join, validateInterfaceManifest };

export async function readRuntimeArtifacts() {
  return {
    wasmBytes: await readPublicArtifact(wasmPublicFile),
    irPackageBytes: await readPublicArtifact(defaultPackageFile),
    hostPackageBytes: await readPublicArtifact(hostPackageFile),
    prettyPackageBytes: await readPublicArtifact(prettyPackageFile),
    leanPackageBytes: await readPublicArtifact(leanPackageFile),
  };
}

function readPublicArtifact(file) {
  return readFile(new URL(`../../${publicArtifactPath(file)}`, import.meta.url));
}

export function createCallbackHostBindings(records = []) {
  return {
    "test.callNatCallback": (input, callback) => {
      try {
        return callback(input);
      } finally {
        callback.release();
      }
    },
    "test.recordNat": (value) => {
      records.push(Number(value));
      return undefined;
    },
  };
}

export function assertManifestTypeDescriptorsRoundTrip(manifest) {
  const entries = [
    ...manifest.exports,
    ...(manifest.hostImports ?? []).map((entry) => ({
      ...entry,
      entry: entry.name,
    })),
  ];
  for (const entry of entries) {
    for (const arg of entry.args) {
      const decoded = roundTripInterfaceTypeDescriptor(arg.type, `${entry.entry} argument ${arg.name}`);
      assert.ok(
        sameInterfaceWireType(arg.type, decoded),
        `${entry.entry} argument ${arg.name} descriptor should round-trip`,
      );
    }
    const decoded = roundTripInterfaceTypeDescriptor(entry.result, `${entry.entry} result`);
    assert.ok(
      sameInterfaceWireType(entry.result, decoded),
      `${entry.entry} result descriptor should round-trip`,
    );
  }
}

export function findTypeDescriptor(type, predicate, seen = new Set()) {
  if (type === null || typeof type !== "object") return null;
  if (seen.has(type)) return null;
  seen.add(type);
  if (predicate(type)) return type;
  for (const value of Object.values(type)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findTypeDescriptor(item, predicate, seen);
        if (found !== null) return found;
      }
    } else if (value !== null && typeof value === "object") {
      const found = findTypeDescriptor(value, predicate, seen);
      if (found !== null) return found;
    }
  }
  return null;
}

export function manifestEntry(manifest, name) {
  const entry = manifest.exports.find((candidate) => candidate.entry === name);
  assert.ok(entry, `manifest entry missing: ${name}`);
  return entry;
}

const validManifestShape = {
  artifact: INTERFACE_MANIFEST_ARTIFACT,
  version: 1,
  metadata: {},
  exports: [
    {
      id: "ok",
      jsName: "ok",
      entry: "ok",
      source: "Ok.lean",
      args: [{ name: "arg1", type: { type: "Nat", wireTag: 0 } }],
      result: { type: "Nat", wireTag: 0 },
    },
  ],
};

export function assertValidManifestShape() {
  assert.equal(validateInterfaceManifest(structuredClone(validManifestShape)).exports[0].entry, "ok");
}

export function assertInvalidManifest(mutator, pattern) {
  const manifest = structuredClone(validManifestShape);
  mutator(manifest);
  assert.throws(() => validateInterfaceManifest(manifest), pattern);
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function reactHtmlElement(fields = {}) {
  return {
    kind: "element",
    fields: {
      tag: "div",
      "key?": null,
      props: [],
      handlers: [],
      children: [],
      ...fields,
    },
  };
}

export function generateIrPackage(source, packagePath) {
  const generated = spawnSync(
    "bash",
    ["scripts/lean-to-irpkg.sh", source, packagePath],
    { encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  return generated;
}

export async function assertUnsupportedInterfaceSource(dir, stem, lines, patterns, roots = null) {
  const source = join(dir, `${stem}.lean`);
  const packagePath = join(dir, `${stem}.irpkg`);
  const reportPath = join(dir, `${stem}.report.md`);
  await writeFile(source, lines.join("\n"));
  const generated = spawnSync(
    "bash",
    roots === null
      ? ["scripts/lean-to-irpkg.sh", source, packagePath]
      : ["scripts/lean-to-irpkg.sh", source, packagePath, ...roots],
    { encoding: "utf8" },
  );
  assert.notEqual(generated.status, 0, `${stem} unexpectedly generated successfully`);
  assert.match(generated.stderr, /unsupported interface exports/);
  const report = await readFile(reportPath, "utf8");
  for (const pattern of patterns) {
    assert.match(generated.stderr, pattern);
    assert.match(report, pattern);
  }
}
