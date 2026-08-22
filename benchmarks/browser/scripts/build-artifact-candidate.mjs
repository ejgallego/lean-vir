import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

import {
  checkoutSources,
  readBuildDatabase,
  selectBuild,
} from "./artifact-build-lib.mjs";
import {
  canonicalJson,
  fileRecord,
  inside,
  readJson,
} from "./artifact-set-lib.mjs";
import { appRoot } from "./package-root.mjs";
import { runSync } from "./process-utils.mjs";
import {
  parsePathAssignment,
  readToolchainConfig,
  resolveBuildCheckoutPaths,
} from "./toolchain-config-lib.mjs";

function usage() {
  console.log(`Usage: node scripts/build-artifact-candidate.mjs [options] BUILD

Build, pack, re-import, test, and collect an ephemeral artifact candidate.
Fallback source checkouts must already exist below the controlled source
directory.

  --database PATH     build database (default: artifact-builds.json)
  --sources-dir PATH  checkout root (default: _sources)
  --toolchain [NAME=]PATH
                      select FIR by default, or a named FIR/VIR toolchain
  --toolchain-config PATH
                      read toolchains and checkout paths from JSON
  --prepare           run catalogued producer setup before building
  --plan              print inputs and outputs without building
  -h, --help          show this help`);
}

function parseArgs(argv) {
  const options = {
    database: "artifact-builds.json",
    sourcesDir: "_sources",
    toolchains: new Map(),
    toolchainConfig: null,
    prepare: false,
    plan: false,
    buildId: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--database") options.database = argv[++index];
    else if (argument === "--sources-dir")
      options.sourcesDir = argv[++index];
    else if (argument === "--toolchain") {
      const { name, path } = parsePathAssignment(argv[++index], {
        defaultName: "fir",
        label: "--toolchain",
      });
      if (options.toolchains.has(name))
        throw new Error(`duplicate toolchain: ${name}`);
      options.toolchains.set(name, path);
    } else if (argument === "--toolchain-config") {
      options.toolchainConfig = argv[++index];
    } else if (argument === "--prepare") options.prepare = true;
    else if (argument === "--plan") options.plan = true;
    else if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    } else if (argument.startsWith("-"))
      throw new Error(`unknown argument: ${argument}`);
    else if (options.buildId)
      throw new Error("only one build ID may be selected");
    else options.buildId = argument;
  }
  if (!options.buildId) throw new Error("select a build ID");
  return options;
}

function run(command, args, { capture = false } = {}) {
  return runSync(command, args, { cwd: appRoot, capture });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const databasePath = inside(
    appRoot,
    options.database,
    "read artifact build database",
  );
  const sourcesDir = inside(
    appRoot,
    options.sourcesDir,
    "read artifact sources",
  );
  const database = await readBuildDatabase(databasePath);
  const build = selectBuild(database, options.buildId);
  const sources = checkoutSources(database, options.buildId);
  const toolchainConfig = await readToolchainConfig(
    appRoot,
    options.toolchainConfig,
  );
  const checkoutSelection = resolveBuildCheckoutPaths(build, sources, {
    sourcesDir,
    toolchains: options.toolchains,
    config: toolchainConfig,
  });
  const candidateRoot = inside(
    appRoot,
    `_artifacts/candidates/${options.buildId}`,
    "write artifact candidate",
  );
  const releaseDir = resolve(candidateRoot, "releases");
  const candidateLock = resolve(candidateRoot, "artifact-set.lock.json");
  const uploadDir = resolve(candidateRoot, "upload");
  console.log(`build: ${options.buildId}`);
  for (const [checkoutId, source] of Object.entries(sources)) {
    const destination = relative(
      appRoot,
      checkoutSelection.paths.get(checkoutId),
    );
    console.log(
      `source ${checkoutId}: ${source.repository} @ ${source.revision} -> ${destination}`,
    );
  }
  for (const [name, checkoutId] of checkoutSelection.toolchainRoles) {
    console.log(
      `toolchain ${name}: ${checkoutSelection.paths.get(checkoutId)}`,
    );
  }
  if (toolchainConfig.path) {
    console.log(`toolchain config: ${toolchainConfig.path}`);
  }
  console.log(`candidate output: ${relative(appRoot, uploadDir)}`);
  if (options.plan) return;

  await rm(candidateRoot, { recursive: true, force: true });
  await mkdir(candidateRoot, { recursive: true });

  const buildArgs = [
    "scripts/build-artifacts.mjs",
    options.buildId,
    "--database",
    relative(appRoot, databasePath),
    "--sources-dir",
    relative(appRoot, sourcesDir),
  ];
  for (const [name, path] of options.toolchains) {
    buildArgs.push("--toolchain", `${name}=${path}`);
  }
  if (options.toolchainConfig) {
    buildArgs.push("--toolchain-config", options.toolchainConfig);
  }
  if (options.prepare) buildArgs.push("--prepare");
  run(process.execPath, buildArgs);

  run(process.execPath, [
    "scripts/pack-artifact-set.mjs",
    "--database",
    relative(appRoot, databasePath),
    "--build",
    options.buildId,
    "--output-dir",
    relative(appRoot, releaseDir),
    "--lock",
    relative(appRoot, candidateLock),
  ]);

  const lock = await readJson(candidateLock);
  if (lock.setId !== build.artifactSet.setId) {
    throw new Error("candidate lock does not match the selected artifact set");
  }
  const archive = resolve(releaseDir, lock.archive.file);
  run(process.execPath, [
    "scripts/fetch-artifact-set.mjs",
    "--lock",
    relative(appRoot, candidateLock),
    "--archive",
    relative(appRoot, archive),
    "--sets-dir",
    relative(appRoot, resolve(candidateRoot, "sets")),
  ]);

  const exampleTestReport = resolve(candidateRoot, "EXAMPLE_TEST.json");
  run("npm", ["run", "test:unit"]);
  run("npm", [
    "run",
    "test:example",
    "--",
    build.example.id,
    build.example.variant,
    "--output",
    relative(appRoot, exampleTestReport),
  ]);

  const receipt = inside(
    appRoot,
    `_artifacts/builds/${options.buildId}/BUILD.json`,
    "read source build receipt",
  );
  const checksum = `${archive}.sha256`;
  const manifest = resolve(releaseDir, `${lock.setId}.manifest.json`);
  await mkdir(uploadDir, { recursive: true });
  for (const source of [
    archive,
    checksum,
    manifest,
    receipt,
    candidateLock,
    exampleTestReport,
  ]) {
    const destination =
      source === receipt
        ? "BUILD.json"
        : source === candidateLock
          ? "artifact-set.lock.json"
          : basename(source);
    await cp(source, resolve(uploadDir, destination));
  }

  const repository = run("git", ["remote", "get-url", "origin"], {
    capture: true,
  });
  const commit = run("git", ["rev-parse", "HEAD"], { capture: true });
  const dirty = run("git", ["status", "--porcelain"], { capture: true });
  const [archiveRecord, receiptRecord, manifestRecord, testReportRecord] =
    await Promise.all([
    fileRecord(archive),
    fileRecord(receipt),
    fileRecord(manifest),
    fileRecord(exampleTestReport),
  ]);
  const candidate = {
    schemaVersion: 1,
    kind: "browser-benchmarks/artifact-candidate",
    build: options.buildId,
    example: structuredClone(build.example),
    artifactSet: lock.setId,
    orchestrator: {
      repository,
      commit,
      dirty: dirty !== "",
    },
    archive: {
      file: lock.archive.file,
      ...archiveRecord,
    },
    manifest: {
      file: `${lock.setId}.manifest.json`,
      ...manifestRecord,
    },
    sourceBuildReceipt: {
      file: "BUILD.json",
      ...receiptRecord,
    },
    exampleTestReport: {
      file: "EXAMPLE_TEST.json",
      ...testReportRecord,
    },
    validation: {
      sourcePackages: "passed",
      archiveImport: "passed",
      applicationUnitTests: "passed",
      exampleDifferential: "passed",
    },
  };
  await writeFile(
    resolve(uploadDir, "CANDIDATE.json"),
    canonicalJson(candidate),
  );
  console.log(`candidate upload bundle: ${relative(appRoot, uploadDir)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
