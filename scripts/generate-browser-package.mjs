/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const manifestPath = new URL("../fixtures/manifest.json", import.meta.url);
const packageConfigPath = new URL("../fixtures/browser-packages.json", import.meta.url);

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

const libResult = spawnSync("bash", ["scripts/build-lean-lib.sh"], {
  cwd: root,
  stdio: "inherit",
});

if ((libResult.status ?? 1) !== 0) {
  process.exit(libResult.status ?? 1);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const packageConfig = JSON.parse(await readFile(packageConfigPath, "utf8"));
const packageSpecs = packageConfig.packages ?? [];

await mkdir(new URL("../build/generated/", import.meta.url), { recursive: true });

for (const spec of packageSpecs) {
  const { targets, packageTargets } = targetsForSpec(spec, manifest.fixtures ?? []);
  const packagePath = packagePathFor(spec);
  const reportPath = spec.report ?? packagePath.replace(/\.irpkg$/, ".report.md");
  const result = spawnSync(
    "lean",
    ["--run", "tools/GeneratePackage.lean", packagePath, reportPath, ...targetArgsFor(targets, packageTargets)],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        LEAN_PATH: process.env.LEAN_PATH ? `build/lean-lib:${process.env.LEAN_PATH}` : "build/lean-lib",
      },
    },
  );

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
