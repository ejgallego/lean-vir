import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inside,
  safeArchivePath,
  verifyArtifactSet,
} from "./artifact-set-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function usage() {
  console.log(`Usage: node scripts/stage-artifact-set.mjs [options] SET

Stage one verified artifact set under artifacts/<example-id>. Existing sibling
examples are preserved. All paths must remain inside this application.

  --artifacts-dir PATH  staged examples root (default: artifacts)
  -h, --help            show this help`);
}

function parseArgs(argv) {
  const options = {
    artifactsDir: "artifacts",
    source: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--artifacts-dir") {
      options.artifactsDir = argv[++index];
    } else if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    } else if (argument.startsWith("-")) {
      throw new Error(`unknown argument: ${argument}`);
    } else if (options.source) {
      throw new Error("only one artifact set may be staged");
    } else options.source = argument;
  }
  if (!options.source) throw new Error("select an artifact set directory");
  return options;
}

async function replaceDirectory(next, destination) {
  const previous = `${destination}.previous`;
  await rm(previous, { recursive: true, force: true });
  const existing = await stat(destination).catch(() => null);
  if (existing) await rename(destination, previous);
  try {
    await rename(next, destination);
  } catch (error) {
    if (existing) await rename(previous, destination);
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const source = inside(appRoot, options.source, "read artifact set");
  const artifactsDir = inside(
    appRoot,
    options.artifactsDir,
    "stage artifact examples",
  );
  const manifest = await verifyArtifactSet(source);
  if (
    manifest.schemaVersion !== 2 ||
    manifest.kind !== "browser-benchmarks/artifact-set"
  ) {
    throw new Error("only namespaced artifact-set v2 manifests can be staged");
  }

  const exampleId = manifest.example.id;
  const prefix = `${exampleId}/`;
  const files = Object.keys(manifest.files).sort();
  if (files.length === 0 || files.some((path) => !path.startsWith(prefix))) {
    throw new Error(
      `artifact files must use the ${exampleId}/ namespace`,
    );
  }

  const destination = resolve(artifactsDir, exampleId);
  const next = resolve(artifactsDir, `.${exampleId}.next-${process.pid}`);
  await rm(next, { recursive: true, force: true });
  await mkdir(next, { recursive: true });
  for (const path of files) {
    const local = safeArchivePath(path.slice(prefix.length));
    const target = resolve(next, local);
    await mkdir(dirname(target), { recursive: true });
    await cp(resolve(source, path), target);
  }
  await cp(
    resolve(source, "ARTIFACT_SET.json"),
    resolve(next, "ARTIFACT_SET.json"),
  );
  await replaceDirectory(next, destination);
  console.log(
    `staged ${exampleId}: ${relative(appRoot, source)} -> ${relative(
      appRoot,
      destination,
    )}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
