/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";

import { repositoryRoot } from "../repository-paths.mjs";
import { elapsedSeconds, timerStart } from "../timing-utils.mjs";

export function virIrpkgLakeBuildArgs(lakeTargets = []) {
  return ["build", "vir_irpkg", ...lakeTargets];
}

/** Resolve an already-built tool for callers packaging a separate project. */
export function resolveVirIrpkgPathSync() {
  const generator = prepareVirIrpkgSync({ noBuild: true });
  if (!generator.ok) throw new Error(irpkgGeneratorFailureMessage(generator));
  return generator.path;
}

/** Build this repository's generator and resolve its matching Lake environment. */
export function prepareVirIrpkgSync({
  lakeTargets = [],
  modules = [],
  noBuild = false,
} = {}) {
  const generatorStart = timerStart();
  if (lakeTargets.length && !noBuild) {
    const built = spawnSync("lake", ["build", ...lakeTargets], {
      cwd: repositoryRoot,
      stdio: "inherit",
    });
    if ((built.status ?? 1) !== 0) {
      return failed("vir-irpkg", built, {
        generatorSeconds: elapsedSeconds(generatorStart),
      });
    }
  }
  const resolved = spawnSync(
    "lake",
    [
      "run",
      "virPrepare",
      ...(noBuild ? ["--no-build"] : []),
      ...new Set(modules),
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const generatorSeconds = elapsedSeconds(generatorStart);
  if ((resolved.status ?? 1) !== 0) {
    return failed("compiled-inputs", resolved, { generatorSeconds });
  }
  const result = JSON.parse(resolved.stdout);
  return {
    ok: true,
    path: result.path,
    setupArgs: result.setup === null ? [] : ["--setup", result.setup],
    env: {
      ...process.env,
      LEAN_PATH: result.leanPath,
    },
    generatorSeconds,
  };
}

export function irpkgGeneratorFailureMessage(result) {
  switch (result.phase) {
    case "vir-irpkg":
      return "vir_irpkg generator build failed";
    case "compiled-inputs":
      return "could not acquire the Lake-resolved generator and compiled inputs";
    default:
      return "vir_irpkg generator preparation failed";
  }
}

function failed(phase, result, timing) {
  return {
    ok: false,
    phase,
    status: result.status ?? 1,
    ...timing,
  };
}
