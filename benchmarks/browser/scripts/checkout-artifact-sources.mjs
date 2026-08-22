import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkoutSources,
  readBuildDatabase,
} from "./artifact-build-lib.mjs";
import { inside } from "./artifact-set-lib.mjs";
import { verifyGitCheckout } from "./git-checkout-lib.mjs";
import { runSync } from "./process-utils.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function usage() {
  console.log(`Usage: node scripts/checkout-artifact-sources.mjs [options] BUILD

Materialize the exact Git sources selected by artifact-builds.json below a
controlled, ignored directory in this application checkout.

  --database PATH     build database (default: artifact-builds.json)
  --sources-dir PATH  checkout root (default: _sources)
  --plan              print source destinations without cloning
  -h, --help          show this help`);
}

function parseArgs(argv) {
  const options = {
    database: "artifact-builds.json",
    sourcesDir: "_sources",
    plan: false,
    buildId: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--database") options.database = argv[++index];
    else if (argument === "--sources-dir")
      options.sourcesDir = argv[++index];
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

function run(command, args, { cwd, capture = false } = {}) {
  return runSync(command, args, { cwd, capture });
}

async function materializeCheckout(checkoutId, destination, source) {
  if (await stat(destination).catch(() => null)) {
    await verifyGitCheckout(checkoutId, destination, source);
    console.log(
      `reused ${checkoutId}: ${relative(appRoot, destination)} @ ${source.revision}`,
    );
    return;
  }

  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.partial-${process.pid}`;
  await rm(temporary, { recursive: true, force: true });
  try {
    await mkdir(temporary, { recursive: true });
    run("git", ["init", "--quiet", temporary]);
    run("git", ["-C", temporary, "remote", "add", "origin", source.repository]);
    run("git", [
      "-C",
      temporary,
      "fetch",
      "--depth",
      "1",
      "origin",
      source.revision,
    ]);
    run("git", ["-C", temporary, "checkout", "--detach", "FETCH_HEAD"]);
    await verifyGitCheckout(checkoutId, temporary, source);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  console.log(
    `materialized ${checkoutId}: ${relative(appRoot, destination)} @ ${source.revision}`,
  );
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
    "materialize artifact sources",
  );
  const database = await readBuildDatabase(databasePath);
  const sources = checkoutSources(database, options.buildId);

  console.log(`build: ${options.buildId}`);
  for (const [checkoutId, source] of Object.entries(sources)) {
    const destination = resolve(sourcesDir, checkoutId);
    console.log(
      `${checkoutId}: ${source.repository} @ ${source.revision} -> ${relative(appRoot, destination)}`,
    );
    if (!options.plan) {
      await materializeCheckout(checkoutId, destination, source);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
