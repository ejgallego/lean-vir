import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { readBuildDatabase } from "./artifact-build-lib.mjs";
import {
  discoverExampleCatalog,
  readExampleTestPackage,
} from "./example-catalog-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function usage() {
  console.log(`Usage: node scripts/run-example.mjs [options] EXAMPLE [VARIANT]

Select one self-contained example variant, compile its catalogued artifacts,
and run every declared differential test. The benchmark suite is registered
but is not measured by this command.

  --test-only              use the currently staged artifacts
  --plan                   print the selected build and tests without running
  --sources-dir PATH       forward the candidate source checkout root
  --toolchain [NAME=]PATH  forward a FIR/VIR toolchain selection
  --toolchain-config PATH  forward a toolchain config
  --prepare                run catalogued producer setup
  -h, --help               show this help`);
}

function parseArgs(argv) {
  const options = {
    example: null,
    variant: "default",
    plan: false,
    testOnly: false,
    candidateArgs: [],
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--plan") options.plan = true;
    else if (argument === "--test-only") options.testOnly = true;
    else if (argument === "--prepare") options.candidateArgs.push(argument);
    else if (
      ["--sources-dir", "--toolchain", "--toolchain-config"].includes(argument)
    ) {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} requires a value`);
      options.candidateArgs.push(argument, value);
    } else if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    } else if (argument.startsWith("-")) {
      throw new Error(`unknown argument: ${argument}`);
    } else positional.push(argument);
  }
  if (positional.length < 1 || positional.length > 2) {
    throw new Error("select EXAMPLE and optionally VARIANT");
  }
  options.example = positional[0];
  options.variant = positional[1] ?? "default";
  return options;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      BENCH_PORT:
        process.env.BENCH_PORT ?? String(19000 + (process.pid % 1000)),
    },
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${result.status ?? 1}`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const catalog = await discoverExampleCatalog(appRoot);
  const example = catalog.examples.find(
    (candidate) => candidate.id === options.example,
  );
  if (!example) throw new Error(`unknown example ${options.example}`);
  const testPackage = await readExampleTestPackage(appRoot, example);
  const variant = testPackage.variants.find(
    (candidate) => candidate.id === options.variant,
  );
  if (!variant) {
    throw new Error(`example ${example.id} has no variant ${options.variant}`);
  }

  let build = null;
  if (variant.build !== null) {
    const database = await readBuildDatabase(
      `${appRoot}/artifact-builds.json`,
    );
    build = database.builds[variant.build];
    if (
      !build ||
      build.example.id !== example.id ||
      build.example.variant !== variant.id
    ) {
      throw new Error(
        `variant ${example.id}/${variant.id} references invalid build ${variant.build}`,
      );
    }
  }

  console.log(`example: ${example.id}`);
  console.log(`variant: ${variant.id} · ${variant.title}`);
  console.log(`build: ${variant.build ?? "not catalogued"}`);
  for (const test of variant.tests) {
    console.log(
      `test: ${test.id} · ${test.study} · ${test.backends.join(", ")} · oracle ${test.oracle ?? "none"}`,
    );
  }
  console.log(`benchmark: ${variant.benchmark.study} (not measured)`);
  if (options.plan) return;
  if (!options.testOnly) {
    if (!build) {
      throw new Error(
        `${example.id}/${variant.id} has no catalogued build; use --test-only with staged rehearsal artifacts`,
      );
    }
    run(process.execPath, [
      "scripts/build-artifact-candidate.mjs",
      variant.build,
      ...options.candidateArgs,
    ]);
    return;
  }
  run("npm", ["run", "test:example", "--", example.id, variant.id]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
