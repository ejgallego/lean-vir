/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readIrPackageInfo } from "../../scripts/packages/irpkg-format.mjs";

const harnessRoot = fileURLToPath(new URL("../..", import.meta.url));
const options = parseArguments(process.argv.slice(2));
// Fail before building when the Wasm-ready gate lacks its generated prerequisite.
const wasmBytes = options.wasm
  ? readFileSync(path.join(harnessRoot, "web/public/vir-upstream.wasm"))
  : undefined;
const sourceProducer = path.resolve(options.producer ?? harnessRoot);
const keep = options.keep || process.env.VIR_LAKE_CACHE_ARTIFACTS_KEEP === "1";
const temporary = mkdtempSync(path.join(tmpdir(), "vir-lake-cache-artifacts-"));
const producer = path.join(temporary, "producer");
const consumer = path.join(temporary, "consumer");
const cache = path.join(temporary, "lake-cache");
const retained = path.join(temporary, "conventional-builds");
const logs = path.join(temporary, "logs");
const hiddenSource = path.join(consumer, "CacheFixture", "Hidden.lean");
const descriptorPath = path.join(
  consumer,
  ".lake/build/vir/module-sets/CacheFixture/Root.irpkg-set.json",
);
const setupPath = descriptorPath.replace(/[.]irpkg-set[.]json$/, ".setup.json");
let succeeded = false;

try {
  assert.ok(
    existsSync(path.join(sourceProducer, "lakefile.lean")),
    `producer is not a lean-vir checkout: ${sourceProducer}`,
  );
  copyProducer(sourceProducer, producer);
  writeConsumer();
  mkdirSync(cache, { recursive: true });
  mkdirSync(retained, { recursive: true });
  mkdirSync(logs, { recursive: true });

  const coldLog = build("cold", false);
  assert.match(coldLog, /Built .*CacheFixture[.]Root:vir/);
  const cold = packageSummary();
  await assertRuntimeResult("cold", "42");

  moveConventionalBuilds("cold");
  const cacheOnly = runBuild("cache-only", false);
  if (options.expectCacheOnlyFailure) {
    assert.notEqual(
      cacheOnly.status,
      0,
      "cache-only negative control unexpectedly succeeded",
    );
    assert.match(
      cacheOnly.log,
      /unknown module prefix|object file.*does not exist|failed to load|missing.*[.]ir/i,
      "cache-only negative control failed for an unrelated reason",
    );
    build("negative-restore-control", true);
    assertRestoredCompiledInputs();
    const restored = packageSummary();
    assert.deepEqual(restored.contract, cold.contract);
    assert.deepEqual(restored.memberHashes, cold.memberHashes);
    await assertRuntimeResult("negative restoration control", "42");
    console.log(
      `expected cache-only failure reproduced; output retained at ${temporary}`,
    );
    process.exitCode = 0;
  } else {
    assert.equal(cacheOnly.status, 0, cacheOnly.log);
    assertNoConventionalCompiledInputs("cache-only");
    assertCacheResolvedSetup();
    const cached = packageSummary();
    const cachedSetup = setupArtifactIdentity();
    assert.deepEqual(cached.contract, cold.contract);
    assert.deepEqual(cached.memberHashes, cold.memberHashes);
    await assertRuntimeResult("cache-only", "42");

    const beforeWarm = outputSnapshot();
    const warmLog = build("warm-no-op", false);
    assert.doesNotMatch(
      warmLog,
      /Built .*CacheFixture[.]Root:vir/,
      "warm build reran the VIR facet",
    );
    assert.deepEqual(outputSnapshot(), beforeWarm);
    assert.deepEqual(packageSummary(), cached);
    assertNoConventionalCompiledInputs("warm-no-op");
    await assertRuntimeResult("warm no-op", "42");

    writeFileSync(hiddenSource, hiddenModule(2));
    const changedLog = build("private-body-change", false);
    assert.match(changedLog, /Built .*CacheFixture[.]Hidden/);
    assert.match(changedLog, /Built .*CacheFixture[.]Root:vir/);
    const changed = packageSummary();
    assertRejectsStaleDescriptorIntegrity();
    const changedSetup = setupArtifactIdentity();
    assert.deepEqual(changed.contract, cold.contract);
    assert.equal(
      changedSetup.rootOlean,
      cachedSetup.rootOlean,
      "an imported private-body change altered the root public olean",
    );
    assert.notEqual(
      changed.memberHashes["CacheFixture.Hidden"],
      cold.memberHashes["CacheFixture.Hidden"],
      "imported private implementation did not invalidate its package member",
    );
    await assertRuntimeResult("private-body change", "43");

    moveConventionalBuilds("changed");
    build("changed-cache-only", false);
    assertNoConventionalCompiledInputs("changed-cache-only");
    assertCacheResolvedSetup();
    const changedCached = packageSummary();
    assert.deepEqual(changedCached.contract, changed.contract);
    assert.deepEqual(changedCached.memberHashes, changed.memberHashes);
    await assertRuntimeResult("changed cache-only", "43");

    moveConventionalBuilds("changed-cache-only");
    build("restore-control", true);
    assertRestoredCompiledInputs();
    assertRestoredSetup();
    const restored = packageSummary();
    assert.deepEqual(restored.contract, changed.contract);
    assert.deepEqual(restored.memberHashes, changed.memberHashes);
    await assertRuntimeResult("restoration control", "43");
    console.log("VIR Lake cache-only artifact smoke ok");
  }
  succeeded = true;
} finally {
  if (succeeded && !keep && !options.expectCacheOnlyFailure) {
    rmSync(temporary, { recursive: true, force: true });
  } else if (existsSync(temporary)) {
    console.log(`VIR Lake cache artifact workspace: ${temporary}`);
  }
}

function parseArguments(args) {
  const parsed = {
    producer: undefined,
    keep: false,
    expectCacheOnlyFailure: false,
    wasm: false,
  };
  for (let index = 0; index < args.length; ++index) {
    switch (args[index]) {
      case "--producer":
        parsed.producer = args[++index];
        assert.ok(parsed.producer, "--producer requires a path");
        break;
      case "--keep":
        parsed.keep = true;
        break;
      case "--wasm":
        parsed.wasm = true;
        break;
      case "--expect-cache-only-failure":
        parsed.expectCacheOnlyFailure = true;
        break;
      case "--help":
        console.log(
          "Usage: node tests/packages/lake-cache-artifacts.mjs " +
            "[--producer DIR] [--keep] [--expect-cache-only-failure] [--wasm]",
        );
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${args[index]}`);
    }
  }
  return parsed;
}

function copyProducer(source, destination) {
  mkdirSync(destination);
  for (const relative of [
    "lakefile.lean",
    "lean-toolchain",
    "lake-manifest.json",
    "Vir",
    "Vir.lean",
    "tools",
  ]) {
    const input = path.join(source, relative);
    if (!existsSync(input)) continue;
    cpSync(input, path.join(destination, relative), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
}

function writeConsumer() {
  mkdirSync(path.join(consumer, "CacheFixture"), { recursive: true });
  cpSync(
    path.join(producer, "lean-toolchain"),
    path.join(consumer, "lean-toolchain"),
  );
  writeFileSync(
    path.join(consumer, "lakefile.lean"),
    [
      "import Lake",
      "open Lake DSL",
      "",
      "package cache_consumer",
      'require lean_vir from "../producer"',
      "",
      "@[default_target]",
      "lean_lib CacheFixture where",
      "  globs := #[.submodules `CacheFixture]",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(consumer, "CacheFixture", "Base.lean"),
    [
      "module",
      "",
      "namespace CacheFixture.Base",
      "public def seed : Nat := 40",
      "end CacheFixture.Base",
      "",
    ].join("\n"),
  );
  writeFileSync(hiddenSource, hiddenModule(1));
  writeFileSync(
    path.join(consumer, "CacheFixture", "Root.lean"),
    [
      "module",
      "",
      "meta import Vir.Attributes",
      "public import CacheFixture.Hidden",
      "",
      "namespace CacheFixture.Root",
      "@[vir_export]",
      "public def answer : Nat := CacheFixture.Hidden.answer + 1",
      "end CacheFixture.Root",
      "",
    ].join("\n"),
  );
}

function hiddenModule(increment) {
  return [
    "module",
    "",
    "public import CacheFixture.Base",
    "",
    "namespace CacheFixture.Hidden",
    `private def bump : Nat := CacheFixture.Base.seed + ${increment}`,
    "public def answer : Nat := bump",
    "end CacheFixture.Hidden",
    "",
  ].join("\n");
}

function runBuild(label, restore) {
  const result = spawnSync("lake", ["-v", "build", "+CacheFixture.Root:vir"], {
    cwd: consumer,
    encoding: "utf8",
    timeout: 10 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      LAKE_CACHE_DIR: cache,
      LAKE_ARTIFACT_CACHE: "true",
      LAKE_RESTORE_ARTIFACTS: restore ? "true" : "false",
    },
  });
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}` +
    (result.error ? `\n${result.error.stack ?? result.error}\n` : "");
  writeFileSync(path.join(logs, `${label}.log`), log);
  assert.ifError(result.error);
  return { status: result.status, log };
}

function build(label, restore) {
  const result = runBuild(label, restore);
  assert.equal(result.status, 0, result.log);
  assert.ok(existsSync(descriptorPath), result.log);
  return result.log;
}

function moveConventionalBuilds(label) {
  for (const [name, root] of [
    ["consumer", consumer],
    ["producer", producer],
  ]) {
    const buildDir = path.join(root, ".lake", "build");
    assert.ok(
      existsSync(buildDir),
      `missing ${name} build tree before ${label}`,
    );
    renameSync(buildDir, path.join(retained, `${label}-${name}`));
  }
}

function conventionalCompiledInputs() {
  const found = [];
  for (const root of [consumer, producer]) {
    const buildDir = path.join(root, ".lake", "build");
    if (!existsSync(buildDir)) continue;
    walk(buildDir, (file) => {
      if (/[.]ir(?:[.]sig)?$|[.]olean(?:[.]server|[.]private)?$/.test(file)) {
        found.push(file);
      }
    });
  }
  return found;
}

function assertNoConventionalCompiledInputs(label) {
  assert.deepEqual(
    conventionalCompiledInputs(),
    [],
    `${label} restored conventional IR/private artifacts`,
  );
}

function assertRestoredCompiledInputs() {
  for (const relative of [
    "CacheFixture/Base.ir",
    "CacheFixture/Hidden.ir",
    "CacheFixture/Hidden.olean.private",
    "CacheFixture/Root.ir",
  ]) {
    assert.ok(
      existsSync(path.join(consumer, ".lake/build/lib/lean", relative)),
      `restoration control did not restore ${relative}`,
    );
  }
}

function assertCacheResolvedSetup() {
  const setup = JSON.parse(readFileSync(setupPath, "utf8"));
  for (const moduleName of [
    "CacheFixture.Base",
    "CacheFixture.Hidden",
    "CacheFixture.Root",
  ]) {
    const artifacts = setup.importArts[moduleName];
    assert.ok(artifacts, `setup omitted ${moduleName}`);
    const paths = artifacts.flat();
    assert.ok(
      paths.length >= 4,
      `setup has incomplete artifacts for ${moduleName}`,
    );
    for (const artifact of paths) {
      assert.equal(
        path.relative(path.join(cache, "artifacts"), artifact).startsWith(".."),
        false,
        `setup did not resolve ${moduleName} through the isolated cache: ${artifact}`,
      );
      assert.ok(
        existsSync(artifact),
        `setup artifact does not exist: ${artifact}`,
      );
    }
    assert.ok(
      artifacts[1]?.some((artifact) => artifact.endsWith(".ir")),
      `setup omitted ${moduleName} IR`,
    );
  }
  assert.ok(
    setup.importArts["CacheFixture.Hidden"][0]?.some((artifact) =>
      artifact.endsWith(".olean.private"),
    ),
    "setup omitted the imported module's private artifact",
  );
}

function assertRestoredSetup() {
  const setup = JSON.parse(readFileSync(setupPath, "utf8"));
  const conventional = path.join(consumer, ".lake", "build", "lib", "lean");
  for (const moduleName of [
    "CacheFixture.Base",
    "CacheFixture.Hidden",
    "CacheFixture.Root",
  ]) {
    for (const artifact of setup.importArts[moduleName].flat()) {
      assert.equal(
        path.relative(conventional, artifact).startsWith(".."),
        false,
        `restoration setup did not select a conventional ${moduleName} artifact: ${artifact}`,
      );
    }
  }
}

function setupArtifactIdentity() {
  const setup = JSON.parse(readFileSync(setupPath, "utf8"));
  const rootOlean = setup.importArts["CacheFixture.Root"]?.[0]?.[0];
  assert.ok(rootOlean, "setup omitted the root public olean");
  return { rootOlean: sha256(readFileSync(rootOlean)) };
}

function walk(directory, visit) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file, visit);
    else visit(file);
  }
}

function packageSummary() {
  const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
  const members = descriptor.packages.map((entry) => {
    const packagePath = path.join(path.dirname(descriptorPath), entry.path);
    const bytes = readFileSync(packagePath);
    const manifest = readIrPackageInfo(bytes).manifest;
    return {
      module: entry.module,
      role: entry.role,
      path: entry.path,
      descriptorSha256: entry.sha256,
      actualSha256: sha256(bytes),
      descriptorByteLength: entry.byteLength,
      actualByteLength: bytes.byteLength,
      owner: manifest.metadata.packageSetMember,
      exports: manifest.exports.map(({ entry, startup, source }) => ({
        entry,
        startup,
        source,
      })),
    };
  });
  const summary = {
    contract: {
      format: descriptor.format,
      version: descriptor.version,
      members: members.map(({ module, role, path, owner, exports }) => ({
        module,
        role,
        path,
        owner,
        exports,
      })),
    },
    memberHashes: Object.fromEntries(
      members.map((member) => [member.module, member.actualSha256]),
    ),
    members,
  };
  assertPackageContract(summary);
  return summary;
}

function assertPackageContract(summary) {
  assert.equal(summary.contract.format, "lean-vir-ir-package-set");
  assert.equal(summary.contract.version, 2);
  assert.deepEqual(
    summary.members.map(({ module, role }) => [module, role]),
    [
      ["CacheFixture.Base", "dependency"],
      ["CacheFixture.Hidden", "dependency"],
      ["CacheFixture.Root", "root"],
    ],
  );
  for (const member of summary.members) {
    assert.equal(
      member.descriptorSha256, member.actualSha256,
      `${member.module}: descriptor sha256 mismatch`,
    );
    assert.equal(
      member.descriptorByteLength, member.actualByteLength,
      `${member.module}: descriptor byteLength mismatch`,
    );
    assert.deepEqual(member.owner, {
      module: member.module,
      role: member.role,
    });
  }
  assert.deepEqual(summary.members[0].exports, []);
  assert.deepEqual(summary.members[1].exports, []);
  assert.deepEqual(summary.members[2].exports, [
    {
      entry: "CacheFixture.Root.answer",
      startup: false,
      source: "module CacheFixture.Root",
    },
  ]);
}

function assertRejectsStaleDescriptorIntegrity() {
  const original = readFileSync(descriptorPath);
  try {
    for (const [field, value] of [
      ["sha256", "0".repeat(64)], ["byteLength", 0],
    ]) {
      const descriptor = JSON.parse(original);
      descriptor.packages[1][field] = value;
      writeFileSync(descriptorPath, JSON.stringify(descriptor));
      assert.throws(
        () => packageSummary(), new RegExp(`descriptor ${field} mismatch`),
      );
    }
  } finally {
    writeFileSync(descriptorPath, original);
  }
}

function outputSnapshot() {
  const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
  const files = [
    descriptorPath,
    descriptorPath.replace(/[.]irpkg-set[.]json$/, ".report.md"),
    setupPath,
    ...descriptor.packages.map((entry) =>
      path.join(path.dirname(descriptorPath), entry.path),
    ),
  ];
  return files.map((file) => ({
    file: path.relative(consumer, file),
    sha256: sha256(readFileSync(file)),
    mtimeNs: statSync(file, { bigint: true }).mtimeNs.toString(),
  }));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function assertRuntimeResult(label, expected) {
  if (!options.wasm) return;
  const { createVirRuntime } = await import("../../web/src/vir-runtime-node.js");
  const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
  const irPackageSet = descriptor.packages.map(({ path: memberPath }) =>
    readFileSync(path.join(path.dirname(descriptorPath), memberPath)),
  );
  const runtime = await createVirRuntime({ wasmBytes, irPackageSet });
  try {
    assert.equal(runtime.call("CacheFixture.Root.answer"), expected, label);
    console.log(`VIR Lake cache Wasm ${label}: ${expected}`);
  } finally {
    runtime.dispose();
  }
}
