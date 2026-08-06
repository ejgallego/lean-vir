import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  createTar,
  fileRecords,
  inside,
  requiredArtifactFiles,
  sha256,
  validateSeed,
  verifyArtifactSet,
} from "./artifact-set-lib.mjs";
import { artifactSetConfig, readBuildDatabase } from "./artifact-build-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const options = {
    seed: "_artifacts/seed",
    database: "artifact-builds.json",
    build: "prettyM",
    outputDir: "_artifacts/releases",
    lock: "artifact-set.lock.json",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--seed") options.seed = argv[++index];
    else if (argument === "--database") options.database = argv[++index];
    else if (argument === "--build") options.build = argv[++index];
    else if (argument === "--output-dir") options.outputDir = argv[++index];
    else if (argument === "--lock") options.lock = argv[++index];
    else if (argument === "--help" || argument === "-h") {
      console.log(`Usage: node scripts/pack-artifact-set.mjs [options]

Build a deterministic release tar and prototype lock from a validated seed.
Every input and output path must remain inside this application directory.

  --seed PATH          component seed (default: _artifacts/seed)
  --database PATH      canonical source/build database
  --build ID           database build to pack (default: prettyM)
  --output-dir PATH    ignored release directory
  --lock PATH          lockfile to write (default: artifact-set.lock.json)`);
      process.exit(0);
    } else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

async function copyFile(sourceRoot, destinationRoot, path) {
  const target = resolve(destinationRoot, path);
  await mkdir(dirname(target), { recursive: true });
  await cp(resolve(sourceRoot, path), target);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const seed = inside(appRoot, options.seed, "read artifact seed");
  const databasePath = inside(
    appRoot,
    options.database,
    "read artifact build database",
  );
  const outputDir = inside(appRoot, options.outputDir, "write release");
  const lockPath = inside(appRoot, options.lock, "write lockfile");
  const database = await readBuildDatabase(databasePath);
  const config = artifactSetConfig(database, options.build);
  if (
    config.schemaVersion !== 1 ||
    !/^prettyM-[a-zA-Z0-9.-]+$/.test(config.setId)
  ) {
    throw new Error("unsupported artifact-set config or unsafe set ID");
  }

  const { native, llvm } = await validateSeed(seed);
  const components = config.components;
  if (
    !components ||
    Object.values(components).some(
      (component) => component.boundary !== "prettyM-web/bounded-runtime/v1",
    )
  ) {
    throw new Error(
      "every component must declare the bounded-runtime boundary",
    );
  }
  if (
    native.capabilities?.inputLayout?.leanVersion !==
      components.native?.lean?.version ||
    llvm.toolchain?.lean?.version !== components.llvm?.lean?.version ||
    llvm.toolchain?.lean?.commit !== components.llvm?.lean?.commit
  ) {
    throw new Error(
      "producer metadata does not match its component-local Lean pin",
    );
  }

  const assembly = inside(
    appRoot,
    `_artifacts/pack/${config.setId}`,
    "assemble artifact set",
  );
  await rm(assembly, { recursive: true, force: true });
  await mkdir(assembly, { recursive: true });
  for (const path of requiredArtifactFiles)
    await copyFile(seed, assembly, path);

  const virFiles = await fileRecords(assembly, [
    "lean-vir/js/vir-runtime.js",
    "lean-vir/wasm/vir-upstream.wasm",
  ]);
  const virComponent = {
    schemaVersion: 1,
    kind: "prettyM-artifact-component",
    id: "vir",
    ...components.vir,
    files: virFiles,
  };
  await writeFile(
    resolve(assembly, "lean-vir/COMPONENT.json"),
    canonicalJson(virComponent),
  );

  const payloadPaths = [...requiredArtifactFiles, "lean-vir/COMPONENT.json"];
  const files = await fileRecords(assembly, payloadPaths);
  const manifest = {
    schemaVersion: 1,
    kind: "prettyM-artifact-set",
    setId: config.setId,
    benchmarkContract: config.benchmarkContract,
    components: {
      vir: {
        boundary: components.vir.boundary,
        manifest: "lean-vir/COMPONENT.json",
        lean: components.vir.lean,
        runtime: components.vir.runtime,
        workload: components.vir.workload,
      },
      native: {
        boundary: components.native.boundary,
        manifest: "lean-native/BUILD.json",
        lean: components.native.lean,
        runtime: {
          pipeline: "lean-lcnf-to-fir-native-wasm",
          sourceCommit: native.sourceCommit,
          sourceDirty: native.sourceDirty,
          functionImports: native.functionImports,
          memoryOwner: native.capabilities?.memoryOwner,
        },
        workload: {
          entry: native.entry,
          inputAbi: native.capabilities?.inputLayout?.version,
          adapterApi: native.capabilities?.browserAdapter?.apiVersion,
          output: native.capabilities?.output,
        },
      },
      llvm: {
        boundary: components.llvm.boundary,
        manifest: "lean-llvm/prettyM.manifest.json",
        lean: components.llvm.lean,
        runtime: {
          pipeline: llvm.pipeline,
          emscripten: llvm.toolchain?.emscripten,
          capabilities: llvm.runtime,
        },
        workload: {
          entry: llvm.sources?.entry,
          abi: llvm.abi,
        },
      },
    },
    files,
  };
  const manifestBody = canonicalJson(manifest);
  await writeFile(resolve(assembly, "ARTIFACT_SET.json"), manifestBody);

  const checksummedPaths = ["ARTIFACT_SET.json", ...payloadPaths].sort();
  const checksums = await fileRecords(assembly, checksummedPaths);
  const checksumBody = `${checksummedPaths
    .map((path) => `${checksums[path].sha256}  ${path}`)
    .join("\n")}\n`;
  await writeFile(resolve(assembly, "SHA256SUMS"), checksumBody);

  const archivePaths = [...checksummedPaths, "SHA256SUMS"];
  const archive = await createTar(assembly, archivePaths);
  const archiveDigest = sha256(archive);
  const archiveName = `${config.setId}-${archiveDigest.slice(0, 16)}.tar`;
  await mkdir(outputDir, { recursive: true });
  const archivePath = resolve(outputDir, archiveName);
  await writeFile(archivePath, archive);
  await writeFile(
    `${archivePath}.sha256`,
    `${archiveDigest}  ${archiveName}\n`,
  );
  await cp(
    resolve(assembly, "ARTIFACT_SET.json"),
    resolve(outputDir, `${config.setId}.manifest.json`),
  );

  const lock = {
    schemaVersion: 1,
    status: "local-prototype",
    setId: config.setId,
    archive: {
      file: archiveName,
      format: "ustar",
      bytes: archive.length,
      sha256: archiveDigest,
      url: null,
    },
    manifestSha256: sha256(Buffer.from(manifestBody)),
  };
  await writeFile(lockPath, canonicalJson(lock));
  await verifyArtifactSet(assembly, lock);
  console.log(`artifact set: ${config.setId}`);
  console.log(`archive: ${relative(appRoot, archivePath)}`);
  console.log(`archive SHA-256: ${archiveDigest}`);
  console.log(`lockfile: ${relative(appRoot, lockPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
