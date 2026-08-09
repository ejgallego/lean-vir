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
  console.log(`Usage: node scripts/stage-illuminate-artifacts.mjs [options] SET

Stage a verified Illuminate artifact set for the unified browser application.
SET and the destination must remain inside this application directory.

  --destination PATH  staged root (default: artifacts/illuminate)
  -h, --help          show this help`);
}

function parseArgs(argv) {
  const options = {
    destination: "artifacts/illuminate",
    source: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--destination") options.destination = argv[++index];
    else if (argument === "--help" || argument === "-h") {
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
  const source = inside(
    appRoot,
    options.source,
    "read Illuminate artifact set",
  );
  const destination = inside(
    appRoot,
    options.destination,
    "stage Illuminate artifacts",
  );
  const manifest = await verifyArtifactSet(source);
  if (
    manifest.schemaVersion !== 2 ||
    manifest.kind !== "browser-benchmarks/artifact-set" ||
    manifest.example?.id !== "illuminate" ||
    manifest.example?.stageAdapter !== "illuminate"
  ) {
    throw new Error(
      "artifact set does not select the Illuminate stage adapter",
    );
  }

  const prefix = "illuminate/";
  const files = Object.keys(manifest.files ?? {}).sort();
  if (files.length === 0 || files.some((path) => !path.startsWith(prefix))) {
    throw new Error(
      "Illuminate artifact files must use the illuminate/ namespace",
    );
  }
  const required = [
    "illuminate/workload/anim_core.js",
    "illuminate/workload/vir-player-trace.mjs",
    "illuminate/workload/examples.json",
    "illuminate/vir/sdk/js/vir-runtime.js",
    "illuminate/vir/sdk/wasm/vir-upstream.wasm",
    "illuminate/vir/module-sets/Illuminate/Animation/Vir.irpkg-set.json",
    "illuminate/native/BUILD.json",
    "illuminate/native/illuminate-player-browser-adapter.mjs",
    "illuminate/native/illuminate-player.wasm",
    "illuminate/native/illuminate-player.wasm.json",
    "illuminate/selection/BUILD.json",
    "illuminate/selection/illuminate-selection-player-browser-adapter.mjs",
    "illuminate/selection/illuminate-selection-player.wasm",
    "illuminate/selection/illuminate-selection-player.wasm.json",
  ];
  for (const path of required) {
    if (!manifest.files[path]) {
      throw new Error(`Illuminate artifact set omits required file: ${path}`);
    }
  }

  const next = `${destination}.next`;
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
    `Staged Illuminate artifacts from ${relative(appRoot, source)} to ${relative(
      appRoot,
      destination,
    )}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
