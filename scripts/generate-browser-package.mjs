/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { copyFile, mkdir, readFile } from "node:fs/promises";

import { packageSpecs } from "./browser-package-config.mjs";
import { prepareVirIrpkgSync } from "./irpkg-generator.mjs";
import { runSync } from "./process-utils.mjs";
import { elapsedSeconds, formatSeconds, timerStart } from "./timing-utils.mjs";

const root = new URL("..", import.meta.url);
const manifestPath = new URL("../fixtures/manifest.json", import.meta.url);
const scriptStart = timerStart();
const args = parseArgs(process.argv.slice(2));

function usage() {
  return [
    "usage: node scripts/generate-browser-package.mjs [--package <id-or-file>]... [--copy-public]",
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

function rootsFor(fixture) {
  return fixture.roots?.length ? fixture.roots : [fixture.entry];
}

function addTarget(targets, source, roots) {
  const existing = targets.get(source) ?? [];
  targets.set(source, [...existing, ...roots]);
}

function targetArgsFor(targets, packageTargets) {
  const targetArgs = [];
  for (const [source, roots] of targets) {
    targetArgs.push("--target", source, ...new Set(roots));
  }
  for (const [source, roots] of packageTargets) {
    targetArgs.push("--package-target", source, ...new Set(roots));
  }
  return targetArgs;
}

function packagePathFor(spec) {
  return `build/generated/${spec.file}`;
}

function publicPackagePathFor(spec) {
  return `web/public/${spec.file}`;
}

function packageFixtureSources(spec) {
  return new Set(spec.fixtureSources ?? []);
}

function targetsForSpec(spec, fixtures) {
  const targets = new Map();
  const packageTargets = new Map();
  const fixtureSources = packageFixtureSources(spec);

  for (const target of spec.targets ?? []) {
    addTarget(target.packageOnly ? packageTargets : targets, target.source, target.roots ?? []);
  }

  for (const fixture of fixtures) {
    if (fixtureSources.has(fixture.source)) {
      addTarget(targets, fixture.source, rootsFor(fixture));
    }
  }

  return { targets, packageTargets };
}

const generator = prepareVirIrpkgSync(root);
if (!generator.ok) {
  process.exit(generator.status);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const selectedPackageSpecs = args.packages.size === 0
  ? packageSpecs
  : packageSpecs.filter((spec) => args.packages.has(spec.id) || args.packages.has(spec.file));

if (selectedPackageSpecs.length !== (args.packages.size === 0 ? packageSpecs.length : args.packages.size)) {
  const available = packageSpecs.map((spec) => `${spec.id} (${spec.file})`).join(", ");
  throw new Error(`unknown package filter; available packages: ${available}`);
}

await mkdir(new URL("../build/generated/", import.meta.url), { recursive: true });
if (args.copyPublic) {
  await mkdir(new URL("../web/public/", import.meta.url), { recursive: true });
}

const packageTimings = [];
for (const spec of selectedPackageSpecs) {
  const { targets, packageTargets } = targetsForSpec(spec, manifest.fixtures ?? []);
  const packagePath = packagePathFor(spec);
  const reportPath = spec.report ?? packagePath.replace(/\.irpkg$/, ".report.md");
  const packageStart = timerStart();
  try {
    runSync(generator.path, [packagePath, reportPath, ...targetArgsFor(targets, packageTargets)], {
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
    await copyFile(new URL(`../${packagePath}`, import.meta.url), new URL(`../${publicPackagePathFor(spec)}`, import.meta.url));
  }
}

const packagesSeconds = packageTimings.reduce((sum, timing) => sum + timing.seconds, 0);
const packageSummary = packageTimings
  .map((timing) => `${timing.id}=${formatSeconds(timing.seconds)}s`)
  .join(", ");
console.log(
  `browser package timing: lean-lib=${formatSeconds(generator.libSeconds)}s `
  + `generator=${formatSeconds(generator.generatorSeconds)}s packages=${formatSeconds(packagesSeconds)}s `
  + `total=${formatSeconds(elapsedSeconds(scriptStart))}s`,
);
console.log(`browser package files: ${packageSummary}`);
