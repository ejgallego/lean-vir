import { spawnSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function usage() {
  console.log(`Usage: node scripts/build-artifact-candidate.mjs [options] BUILD

Build, pack, re-import, test, and collect a non-publishing artifact candidate.
Source checkouts must already exist below the controlled source directory.

  --database PATH     build database (default: artifact-builds.json)
  --sources-dir PATH  checkout root (default: _sources)
  --prepare           run catalogued producer setup before building
  --plan              print inputs and outputs without building
  -h, --help          show this help`);
}

function parseArgs(argv) {
  const options = {
    database: "artifact-builds.json",
    sourcesDir: "_sources",
    prepare: false,
    plan: false,
    buildId: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--database") options.database = argv[++index];
    else if (argument === "--sources-dir")
      options.sourcesDir = argv[++index];
    else if (argument === "--prepare") options.prepare = true;
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
  const result = spawnSync(command, args, {
    cwd: appRoot,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if ((result.status ?? 1) !== 0) {
    const detail = capture && result.stderr ? `\n${result.stderr.trim()}` : "";
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${result.status ?? 1}${detail}`,
    );
  }
  return capture ? result.stdout.trim() : "";
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
      resolve(sourcesDir, checkoutId),
    );
    console.log(
      `source ${checkoutId}: ${source.repository} @ ${source.revision} -> ${destination}`,
    );
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
  ];
  for (const checkoutId of Object.keys(sources)) {
    buildArgs.push(
      "--checkout",
      `${checkoutId}=${resolve(sourcesDir, checkoutId)}`,
    );
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

  run("npm", ["test"]);

  const receipt = inside(
    appRoot,
    `_artifacts/builds/${options.buildId}/BUILD.json`,
    "read source build receipt",
  );
  const checksum = `${archive}.sha256`;
  const manifest = resolve(releaseDir, `${lock.setId}.manifest.json`);
  await mkdir(uploadDir, { recursive: true });
  for (const source of [archive, checksum, manifest, receipt, candidateLock]) {
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
  const [archiveRecord, receiptRecord, manifestRecord] = await Promise.all([
    fileRecord(archive),
    fileRecord(receipt),
    fileRecord(manifest),
  ]);
  const candidate = {
    schemaVersion: 1,
    kind: "prettyM-web/artifact-candidate",
    build: options.buildId,
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
    validation: {
      sourcePackages: "passed",
      archiveImport: "passed",
      applicationTests: "passed",
    },
    promotion: {
      published: false,
      committedLockUpdated: false,
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
