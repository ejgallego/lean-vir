/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";

import { repositoryPath, repositoryRoot } from "../repository-paths.mjs";
import { elapsedSeconds, timerStart } from "../timing-utils.mjs";

export const virIrpkgPath = repositoryPath(
  ".lake",
  "build",
  "bin",
  "vir_irpkg",
);

export function virIrpkgLakeBuildArgs(lakeTargets = []) {
  return ["build", "Vir", "vir_irpkg", ...lakeTargets];
}

/** Build this repository's generator and resolve its matching Lake environment. */
export function prepareVirIrpkgSync({ lakeTargets = [] } = {}) {
  const libStart = timerStart();
  const libResult = spawnSync("bash", ["scripts/build-lean-lib.sh"], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  const libSeconds = elapsedSeconds(libStart);

  if ((libResult.status ?? 1) !== 0) {
    return failed("lean-lib", libResult, { libSeconds, generatorSeconds: 0 });
  }

  const generatorStart = timerStart();
  const generatorResult = spawnSync(
    "lake",
    virIrpkgLakeBuildArgs(lakeTargets),
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  const generatorSeconds = elapsedSeconds(generatorStart);

  if ((generatorResult.status ?? 1) !== 0) {
    return failed("vir-irpkg", generatorResult, {
      libSeconds,
      generatorSeconds,
    });
  }

  // Lake owns search paths, including dependency packages and custom build dirs.
  const leanPath = spawnSync(
    "lake",
    [
      "env",
      process.execPath,
      "-e",
      "process.stdout.write(process.env.LEAN_PATH ?? '')",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );

  if ((leanPath.status ?? 1) !== 0) {
    return failed("lake-env", leanPath, { libSeconds, generatorSeconds });
  }

  return {
    ok: true,
    path: virIrpkgPath,
    env: {
      ...process.env,
      LEAN_PATH: leanPath.stdout,
    },
    libSeconds,
    generatorSeconds,
  };
}

export function irpkgGeneratorFailureMessage(result) {
  switch (result.phase) {
    case "lean-lib":
      return "Lean.Vir library build failed";
    case "vir-irpkg":
      return "vir_irpkg generator build failed";
    case "lake-env":
      return "could not resolve the Lake module search path";
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
