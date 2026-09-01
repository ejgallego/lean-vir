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
} from "../../scripts/packages/browser-package-config.mjs";
import {
  irpkgGeneratorFailureMessage,
  prepareVirIrpkgSync,
} from "../../scripts/packages/irpkg-generator.mjs";
import { repositoryRootUrl } from "../../scripts/repository-paths.mjs";
import {
  roundTripInterfaceTypeDescriptor,
  sameInterfaceTypeDescriptor,
} from "../../web/src/runtime/vir-codec.js";
import {
  INTERFACE_MANIFEST_ARTIFACT,
  INTERFACE_MANIFEST_VERSION,
  validateInterfaceManifest,
} from "../../web/src/runtime/interface-manifest.js";

export {
  assert,
  readFile,
  writeFile,
  spawnSync,
  join,
  validateInterfaceManifest,
};

export async function readRuntimeArtifacts() {
  return {
    wasmBytes: await readPublicArtifact(wasmPublicFile),
    defaultPackageBytes: await readPublicArtifact(defaultPackageFile),
    hostPackageBytes: await readPublicArtifact(hostPackageFile),
    prettyPackageBytes: await readPublicArtifact(prettyPackageFile),
    leanPackageBytes: await readPublicArtifact(leanPackageFile),
  };
}

async function readPublicArtifact(file) {
  const artifactPath = publicArtifactPath(file);
  try {
    return await readFile(new URL(`../../${artifactPath}`, import.meta.url));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `missing runtime artifact ${artifactPath}; run npm run build:demo first`,
      );
    }
    throw error;
  }
}

export function createCallbackHostBindings(records = []) {
  return {
    "test.callNatCallback": (input, callback) => {
      return callback(input);
    },
    "test.recordNat": (value) => {
      records.push(Number(jsNatResourceValue(value)));
      return undefined;
    },
  };
}

export function jsNatResourceValue(value) {
  if (typeof value !== "bigint") {
    throw new Error("expected JsNat host resource");
  }
  return value;
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
      const decoded = roundTripInterfaceTypeDescriptor(
        arg.type,
        `${entry.entry} argument ${arg.name}`,
      );
      assert.ok(
        sameInterfaceTypeDescriptor(arg.type, decoded),
        `${entry.entry} argument ${arg.name} descriptor should round-trip`,
      );
    }
    const decoded = roundTripInterfaceTypeDescriptor(
      entry.result,
      `${entry.entry} result`,
    );
    assert.ok(
      sameInterfaceTypeDescriptor(entry.result, decoded),
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
  version: INTERFACE_MANIFEST_VERSION,
  metadata: {},
  exports: [
    {
      id: "ok",
      jsName: "ok",
      entry: "ok",
      source: "Ok.lean",
      args: [{ name: "arg1", type: { type: "Nat", interfaceTag: 0 } }],
      result: { type: "Nat", interfaceTag: 0 },
      effect: "pure",
      startup: false,
    },
  ],
};

export function assertValidManifestShape() {
  assert.equal(
    validateInterfaceManifest(structuredClone(validManifestShape)).exports[0]
      .entry,
    "ok",
  );
}

export function assertInvalidManifest(mutator, pattern) {
  const manifest = structuredClone(validManifestShape);
  mutator(manifest);
  assert.throws(() => validateInterfaceManifest(manifest), pattern);
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function generateIrPackage(source, packagePath) {
  ensureVirIrpkgBuilt();
  const generated = spawnSync(
    "node",
    ["scripts/packages/lean-to-irpkg.mjs", source, packagePath],
    { encoding: "utf8", env: skipVirIrpkgBuildEnv() },
  );
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  return generated;
}

let cachedVirIrpkg = null;
let virJsBuilt = false;

export function virIrpkgEnv() {
  return preparedVirIrpkg().env;
}

function skipVirIrpkgBuildEnv() {
  return {
    ...process.env,
    VIR_SKIP_IRPKG_BUILD: "1",
  };
}

export function ensureVirJsBuilt() {
  if (virJsBuilt) return;
  const builtVirJs = spawnSync("lake", ["build", "Vir.Js"], {
    encoding: "utf8",
  });
  assert.equal(builtVirJs.status, 0, builtVirJs.stderr || builtVirJs.stdout);
  virJsBuilt = true;
}

export function ensureVirIrpkgBuilt() {
  preparedVirIrpkg();
}

export function runVirIrpkg(args) {
  const generator = preparedVirIrpkg();
  return spawnSync(generator.path, args, {
    encoding: "utf8",
    env: generator.env,
  });
}

function preparedVirIrpkg() {
  if (cachedVirIrpkg !== null) return cachedVirIrpkg;
  const generator = prepareVirIrpkgSync(repositoryRootUrl);
  assert.equal(generator.ok, true, irpkgGeneratorFailureMessage(generator));
  cachedVirIrpkg = generator;
  return cachedVirIrpkg;
}

export async function writeRuntimeFixture(target, fixtureName) {
  const fixture = new URL(
    `../../fixtures/runtime/${fixtureName}`,
    import.meta.url,
  );
  await writeFile(target, await readFile(fixture, "utf8"));
}

export async function assertUnsupportedInterfaceSource(
  dir,
  stem,
  lines,
  patterns,
  roots = null,
) {
  const source = join(dir, `${stem}.lean`);
  const packagePath = join(dir, `${stem}.irpkg`);
  const reportPath = join(dir, `${stem}.report.md`);
  await writeFile(source, lines.join("\n"));
  await assertUnsupportedInterfaceFile(
    source,
    packagePath,
    reportPath,
    patterns,
    roots,
  );
}

export async function assertUnsupportedInterfaceFixture(
  dir,
  fixtureName,
  patterns,
  roots = null,
) {
  const stem = fixtureName.replace(/\.lean$/, "");
  const source = join(dir, fixtureName);
  const packagePath = join(dir, `${stem}.irpkg`);
  const reportPath = join(dir, `${stem}.report.md`);
  await writeRuntimeFixture(source, fixtureName);
  await assertUnsupportedInterfaceFile(
    source,
    packagePath,
    reportPath,
    patterns,
    roots,
  );
}

async function assertUnsupportedInterfaceFile(
  source,
  packagePath,
  reportPath,
  patterns,
  roots,
) {
  ensureVirIrpkgBuilt();
  const generated = spawnSync(
    "node",
    roots === null
      ? ["scripts/packages/lean-to-irpkg.mjs", source, packagePath]
      : ["scripts/packages/lean-to-irpkg.mjs", source, packagePath, ...roots],
    { encoding: "utf8", env: skipVirIrpkgBuildEnv() },
  );
  assert.notEqual(
    generated.status,
    0,
    `${source} unexpectedly generated successfully`,
  );
  const diagnosticsText = `${generated.stderr}${generated.stdout}`;
  assert.match(
    diagnosticsText,
    /package diagnostics|unsupported interface exports/,
  );
  const report = await readFile(reportPath, "utf8");
  for (const pattern of patterns) {
    assert.match(diagnosticsText, pattern);
    assert.match(report, pattern);
  }
}
