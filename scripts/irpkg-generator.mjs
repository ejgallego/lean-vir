/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";

import { elapsedSeconds, timerStart } from "./timing-utils.mjs";

export const virIrpkgPath = new URL("../.lake/build/bin/vir_irpkg", import.meta.url).pathname;

export function virIrpkgLakeBuildArgs(lakeTargets = []) {
  return ["build", "Vir", "vir_irpkg", ...lakeTargets];
}

export function leanPathWithGenerator(leanPrefix, existing = process.env.LEAN_PATH) {
  return [
    ".lake/build/lib/lean",
    "build/lean-lib",
    `${leanPrefix}/lib/lean`,
    existing,
  ].filter(Boolean).join(delimiter);
}

export function prepareVirIrpkgSync(root, { lakeTargets = [], skipBuild = false } = {}) {
  let libSeconds = 0;
  let generatorSeconds = 0;
  if (!skipBuild) {
    const libStart = timerStart();
    const libResult = spawnSync("bash", ["scripts/build-lean-lib.sh"], {
      cwd: root,
      stdio: "inherit",
    });
    libSeconds = elapsedSeconds(libStart);

    if ((libResult.status ?? 1) !== 0) {
      return failed("lean-lib", libResult, { libSeconds, generatorSeconds });
    }

    const generatorStart = timerStart();
    const generatorResult = spawnSync(
      "lake",
      virIrpkgLakeBuildArgs(lakeTargets),
      { cwd: root, stdio: "inherit" },
    );
    generatorSeconds = elapsedSeconds(generatorStart);

    if ((generatorResult.status ?? 1) !== 0) {
      return failed("vir-irpkg", generatorResult, { libSeconds, generatorSeconds });
    }
  }

  const leanPrefix = spawnSync("lean", ["--print-prefix"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  if ((leanPrefix.status ?? 1) !== 0) {
    return failed("lean-prefix", leanPrefix, { libSeconds, generatorSeconds });
  }

  return {
    ok: true,
    path: virIrpkgPath,
    env: {
      ...process.env,
      LEAN_PATH: leanPathWithGenerator(leanPrefix.stdout.trim()),
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
    case "lean-prefix":
      return "could not find Lean prefix";
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
