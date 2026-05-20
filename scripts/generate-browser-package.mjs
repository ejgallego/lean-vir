/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const manifestPath = new URL("../fixtures/manifest.json", import.meta.url);
const packagePath = process.argv[2] ?? "build/generated/vir-demo.irpkg";
const reportPath = process.argv[3] ?? "build/generated/ir-provider-report.md";

const demoTargets = [
  {
    source: "examples/Fib.lean",
    roots: ["fib", "fib._boxed"],
  },
  {
    source: "examples/Tamagotchi.lean",
    roots: [
      "Tamagotchi.step",
      "Tamagotchi.step._boxed",
      "Tamagotchi.run",
      "Tamagotchi.run._boxed",
      "Tamagotchi.trace",
      "Tamagotchi.trace._boxed",
      "Tamagotchi.demoScript",
    ],
  },
  {
    source: "examples/MergeSort.lean",
    roots: ["SortDemo.demo", "SortDemo.demoFromArray"],
  },
];

function rootsFor(fixture) {
  return fixture.roots?.length ? fixture.roots : [fixture.entry];
}

function addTarget(targets, source, roots) {
  const existing = targets.get(source) ?? [];
  targets.set(source, [...existing, ...roots]);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const targets = new Map();

for (const target of demoTargets) {
  addTarget(targets, target.source, target.roots);
}

for (const fixture of manifest.fixtures ?? []) {
  addTarget(targets, fixture.source, rootsFor(fixture));
}

const targetArgs = [];
for (const [source, roots] of targets) {
  targetArgs.push("--target", source, ...new Set(roots));
}

const result = spawnSync(
  "lean",
  ["--run", "tools/GeneratePackage.lean", packagePath, reportPath, ...targetArgs],
  {
    cwd: root,
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
