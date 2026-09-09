/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { copyFile, mkdir, readFile } from "node:fs/promises";

import { validateFixtureManifest } from "../../fixtures/fixture-manifest.mjs";
import { repositoryRootUrl } from "../repository-paths.mjs";
import {
  packageSpecs,
  validateFixturePackageCoverage,
} from "./browser-package-config.mjs";
import { prepareVirIrpkgSync } from "./irpkg-generator.mjs";
import { runSync } from "../process-utils.mjs";
import { elapsedSeconds, formatSeconds, timerStart } from "../timing-utils.mjs";
import {
  planBrowserPackage,
  selectBrowserPackages,
} from "./browser-package-plan.mjs";

const root = repositoryRootUrl;
const manifestPath = new URL("fixtures/manifest.json", repositoryRootUrl);
const scriptStart = timerStart();
const args = parseArgs(process.argv.slice(2));

function usage() {
  return [
    "usage: node scripts/packages/generate-browser-package.mjs [--package <id-or-file>]... [--copy-public]",
    "",
    "When --package is omitted, all browser packages are generated.",
  ].join("\n");
}

function parseArgs(argv) {
  const packages = new Set();
  let copyPublic = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (arg === "--copy-public") {
      copyPublic = true;
    } else if (arg === "--package") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--package requires an id or file name");
      }
      packages.add(value);
      i += 1;
    } else if (arg.startsWith("--package=")) {
      packages.add(arg.slice("--package=".length));
    } else {
      throw new Error(`unknown argument: ${arg}\n${usage()}`);
    }
  }
  return { packages, copyPublic };
}

function packagePathFor(spec) {
  return `build/generated/${spec.file}`;
}

function publicPackagePathFor(spec) {
  return `web/public/${spec.file}`;
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const manifestFixtures = validateFixturePackageCoverage(
  validateFixtureManifest(manifest),
);
const plans = selectBrowserPackages(packageSpecs, args.packages).map(
  (spec) => ({
    spec,
    ...planBrowserPackage(spec, manifestFixtures),
  }),
);

const lakeTargets = [
  ...new Set(
    plans.flatMap(({ spec, modules }) => [
      ...(spec.lakeTargets ?? []),
      ...modules.map((module) => `+${module}`),
    ]),
  ),
];
const generator = prepareVirIrpkgSync({ lakeTargets });
if (!generator.ok) {
  process.exit(generator.status);
}

await mkdir(new URL("build/generated/", repositoryRootUrl), {
  recursive: true,
});
if (args.copyPublic) {
  await mkdir(new URL("web/public/", repositoryRootUrl), { recursive: true });
}

const packageTimings = [];
for (const { spec, targetArgs } of plans) {
  const packagePath = packagePathFor(spec);
  const reportPath =
    spec.report ?? packagePath.replace(/\.irpkg$/, ".report.md");
  const packageStart = timerStart();
  try {
    runSync(generator.path, [packagePath, reportPath, ...targetArgs], {
      cwd: root,
      env: generator.env,
    });
  } catch (error) {
    process.exit(error.status ?? 1);
  }
  packageTimings.push({
    id: spec.id ?? spec.file,
    seconds: elapsedSeconds(packageStart),
  });
  if (args.copyPublic) {
    await copyFile(
      new URL(packagePath, repositoryRootUrl),
      new URL(publicPackagePathFor(spec), repositoryRootUrl),
    );
  }
}

const packagesSeconds = packageTimings.reduce(
  (sum, timing) => sum + timing.seconds,
  0,
);
const packageSummary = packageTimings
  .map((timing) => `${timing.id}=${formatSeconds(timing.seconds)}s`)
  .join(", ");
console.log(
  `browser package timing: lean-lib=${formatSeconds(generator.libSeconds)}s ` +
    `generator=${formatSeconds(generator.generatorSeconds)}s packages=${formatSeconds(packagesSeconds)}s ` +
    `total=${formatSeconds(elapsedSeconds(scriptStart))}s`,
);
console.log(`browser package files: ${packageSummary}`);
