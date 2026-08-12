import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  createTar,
  fileRecord,
  fileRecords,
  inside,
  readJson,
  sha256,
  validateSeed,
  verifyArtifactSet,
} from "./artifact-set-lib.mjs";
import {
  artifactSetConfig,
  checkoutSources,
  readBuildDatabase,
} from "./artifact-build-lib.mjs";
import { verifySourceBuildReceipt } from "./source-build-receipt-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const options = {
    seed: "_artifacts/seed",
    database: "artifact-builds.json",
    build: null,
    outputDir: "_artifacts/releases",
    lock: null,
    receipt: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--seed") options.seed = argv[++index];
    else if (argument === "--database") options.database = argv[++index];
    else if (argument === "--build") options.build = argv[++index];
    else if (argument === "--output-dir") options.outputDir = argv[++index];
    else if (argument === "--lock") options.lock = argv[++index];
    else if (argument === "--receipt") options.receipt = argv[++index];
    else if (argument === "--help" || argument === "-h") {
      console.log(`Usage: node scripts/pack-artifact-set.mjs [options]

Build a deterministic candidate tar and local import lock from a validated seed.
Every input and output path must remain inside this application directory.

  --seed PATH          component seed (default: _artifacts/seed)
  --database PATH      canonical source/build database
  --build ID           database build to pack (required)
  --output-dir PATH    ignored candidate output directory
  --lock PATH          lockfile to write (default: ignored candidate lock)
  --receipt PATH       source receipt (default: build receipt)`);
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
  if (!options.build) throw new Error("select a build with --build ID");
  const seed = inside(appRoot, options.seed, "read artifact seed");
  const databasePath = inside(
    appRoot,
    options.database,
    "read artifact build database",
  );
  const outputDir = inside(appRoot, options.outputDir, "write candidate");
  const database = await readBuildDatabase(databasePath);
  const config = artifactSetConfig(database, options.build);
  const examplePath = inside(
    appRoot,
    `examples/${config.example.id}/example.json`,
    "read example manifest",
  );
  const exampleManifest = await readJson(examplePath);
  const testPackagePath = inside(
    appRoot,
    exampleManifest.testPackage,
    "read example test package",
  );
  const testPackageRecord = await fileRecord(testPackagePath);
  const receiptPath = inside(
    appRoot,
    options.receipt ?? `_artifacts/builds/${options.build}/BUILD.json`,
    "read source-build receipt",
  );
  const lockPath = inside(
    appRoot,
    options.lock ?? `_artifacts/releases/${config.setId}.lock.json`,
    "write lockfile",
  );
  if (config.schemaVersion !== 2) {
    throw new Error("unsupported artifact-set config or unsafe set ID");
  }

  await verifySourceBuildReceipt({
    receiptPath,
    databasePath,
    examplePath,
    testPackagePath,
    databaseFile: relative(appRoot, databasePath),
    exampleFile: relative(appRoot, examplePath),
    testPackageFile: relative(appRoot, testPackagePath),
    exampleId: config.example.id,
    variantId: config.example.variant,
    buildId: options.build,
    setId: config.setId,
    sources: checkoutSources(database, options.build),
    components: database.builds[options.build].components,
    seed,
  });

  const metadata = await validateSeed(seed, config);
  const components = config.components;
  const packedComponents = {};
  for (const [componentId, component] of Object.entries(components)) {
    const producer = metadata[componentId];
    if (
      component.adapter === "fir-native" &&
      producer.capabilities?.inputLayout?.leanVersion !== component.lean?.version
    ) {
      throw new Error(`${componentId} metadata does not match its Lean pin`);
    }
    if (
      component.adapter === "fir-llvm" &&
      (producer.toolchain?.lean?.version !== component.lean?.version ||
        producer.toolchain?.lean?.commit !== component.lean?.commit)
    ) {
      throw new Error(`${componentId} metadata does not match its Lean pin`);
    }
    const {
      files: _files,
      producerManifest,
      adapter,
      ...packed
    } = component;
    if (adapter === "fir-native") {
      packed.runtime = {
        pipeline: "lean-lcnf-to-fir-native-wasm",
        sourceCommit: producer.sourceCommit,
        sourceDirty: producer.sourceDirty,
        functionImports: producer.functionImports,
        memoryOwner: producer.capabilities?.memoryOwner,
      };
      packed.workload = {
        entry: producer.entry,
        inputAbi: producer.capabilities?.inputLayout?.version,
        adapterApi: producer.capabilities?.browserAdapter?.apiVersion,
        output: producer.capabilities?.output,
      };
    } else if (adapter === "fir-llvm") {
      packed.runtime = {
        pipeline: producer.pipeline,
        emscripten: producer.toolchain?.emscripten,
        capabilities: producer.runtime,
      };
      packed.workload = {
        entry: producer.sources?.entry,
        abi: producer.abi,
      };
    }
    packedComponents[componentId] = {
      ...packed,
      adapter,
      producerManifest: producerManifest
        ? component.files[producerManifest]
        : null,
    };
  }

  const assembly = inside(
    appRoot,
    `_artifacts/pack/${config.setId}`,
    "assemble artifact set",
  );
  await rm(assembly, { recursive: true, force: true });
  await mkdir(assembly, { recursive: true });
  const artifactPaths = Object.values(components)
    .flatMap((component) => Object.values(component.files))
    .sort();
  for (const path of artifactPaths)
    await copyFile(seed, assembly, path);

  const componentManifestPaths = [];
  for (const [componentId, component] of Object.entries(components)) {
    const path = `${config.example.id}/components/${componentId}.json`;
    const componentFiles = await fileRecords(
      assembly,
      Object.values(component.files),
    );
    await mkdir(dirname(resolve(assembly, path)), { recursive: true });
    await writeFile(
      resolve(assembly, path),
      canonicalJson({
        schemaVersion: 1,
        kind: "browser-benchmarks/artifact-component",
        id: componentId,
        ...packedComponents[componentId],
        files: componentFiles,
      }),
    );
    packedComponents[componentId].manifest = path;
    componentManifestPaths.push(path);
  }

  const payloadPaths = [...artifactPaths, ...componentManifestPaths];
  const files = await fileRecords(assembly, payloadPaths);
  const manifest = {
    schemaVersion: 2,
    kind: "browser-benchmarks/artifact-set",
    example: config.example,
    testPackage: {
      file: exampleManifest.testPackage,
      ...testPackageRecord,
    },
    setId: config.setId,
    benchmarkContract: config.benchmarkContract,
    components: packedComponents,
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
    schemaVersion: 2,
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
