/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";
import { performance } from "node:perf_hooks";

import { packageSpecs } from "./browser-package-config.mjs";

const root = new URL("..", import.meta.url);
const manifestPath = new URL("../fixtures/manifest.json", import.meta.url);
const irpkgGeneratorPath = new URL("../.lake/build/bin/vir_irpkg", import.meta.url);
const scriptStart = performance.now();

function elapsedSeconds(start) {
  return (performance.now() - start) / 1000;
}

function formatSeconds(seconds) {
  return seconds.toFixed(2);
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

const libStart = performance.now();
const libResult = spawnSync("bash", ["scripts/build-lean-lib.sh"], {
  cwd: root,
  stdio: "inherit",
});
const libSeconds = elapsedSeconds(libStart);

if ((libResult.status ?? 1) !== 0) {
  process.exit(libResult.status ?? 1);
}

const generatorStart = performance.now();
const generatorResult = spawnSync("lake", ["build", "vir_irpkg"], {
  cwd: root,
  stdio: "inherit",
});
const generatorSeconds = elapsedSeconds(generatorStart);

if ((generatorResult.status ?? 1) !== 0) {
  process.exit(generatorResult.status ?? 1);
}

const leanPrefixResult = spawnSync("lean", ["--print-prefix"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});

if ((leanPrefixResult.status ?? 1) !== 0) {
  process.exit(leanPrefixResult.status ?? 1);
}

const generatorEnv = {
  ...process.env,
  LEAN_PATH: [
    "build/lean-lib",
    ".lake/build/lib/lean",
    `${leanPrefixResult.stdout.trim()}/lib/lean`,
    process.env.LEAN_PATH,
  ].filter(Boolean).join(delimiter),
};

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

await mkdir(new URL("../build/generated/", import.meta.url), { recursive: true });

const packageTimings = [];
for (const spec of packageSpecs) {
  const { targets, packageTargets } = targetsForSpec(spec, manifest.fixtures ?? []);
  const packagePath = packagePathFor(spec);
  const reportPath = spec.report ?? packagePath.replace(/\.irpkg$/, ".report.md");
  const packageStart = performance.now();
  const result = spawnSync(
    irpkgGeneratorPath.pathname,
    [packagePath, reportPath, ...targetArgsFor(targets, packageTargets)],
    {
      cwd: root,
      stdio: "inherit",
      env: generatorEnv,
    },
  );

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
  packageTimings.push({
    id: spec.id ?? spec.file,
    seconds: elapsedSeconds(packageStart),
  });
}

const packagesSeconds = packageTimings.reduce((sum, timing) => sum + timing.seconds, 0);
const packageSummary = packageTimings
  .map((timing) => `${timing.id}=${formatSeconds(timing.seconds)}s`)
  .join(", ");
console.log(
  `browser package timing: lean-lib=${formatSeconds(libSeconds)}s `
  + `generator=${formatSeconds(generatorSeconds)}s packages=${formatSeconds(packagesSeconds)}s `
  + `total=${formatSeconds(elapsedSeconds(scriptStart))}s`,
);
console.log(`browser package files: ${packageSummary}`);
