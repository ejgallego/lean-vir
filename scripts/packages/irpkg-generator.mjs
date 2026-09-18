/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { repositoryPath, repositoryRoot } from "../repository-paths.mjs";
import { elapsedSeconds, timerStart } from "../timing-utils.mjs";
import { normalizeModulePackageConfig } from "./module-package-config.mjs";

export const virIrpkgPath = repositoryPath(
  ".lake",
  "build",
  "bin",
  "vir_irpkg",
);

export function virIrpkgLakeBuildArgs(lakeTargets = []) {
  return ["build", "Vir", "vir_irpkg", ...lakeTargets];
}

/** Pure acquisition request. Selection and output paths are separate inputs. */
export function virInputsQueryArgs(modules) {
  if (!Array.isArray(modules) || modules.length === 0) {
    throw new Error("resolved VIR inputs require at least one module");
  }
  const names = [...new Set(modules.map((module) =>
    normalizeModulePackageConfig({ version: 2, module }).module))];
  return ["query", "--json", ...names.map((module) => `+${module}:virInputs`)];
}

/** Acquire compiled inputs in the selected Lake workspace, never an SDK/package.
 * Paths come from Lake's query result; JavaScript never reads artifact layout.
 */
export function resolveVirInputsSync({ modules, cwd = repositoryRoot }) {
  const args = virInputsQueryArgs(modules);
  const result = spawnSync("lake", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
  });
  if ((result.status ?? 1) !== 0) return failed("vir-inputs", result, {});
  const paths = parseQueryPaths(result.stdout, args.length - 2, cwd);
  return { ok: true, inputArgs: paths.flatMap((path) => ["--setup", path]) };
}

function parseQueryPaths(stdout, count, cwd) {
  const paths = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  if (paths.length !== count || paths.some((path) =>
    typeof path !== "string" || path.length === 0)) {
    throw new Error("Lake query did not return the requested VIR artifact paths");
  }
  return paths.map((path) => resolve(cwd, path));
}

/** Build the native generator with Lake. Named modules also acquire resolved
 * inputs; callers without modules deliberately retain standalone lookup.
 */
export function prepareVirIrpkgSync({ lakeTargets = [], modules = [] } = {}) {
  if (!Array.isArray(modules)) throw new Error("VIR input modules must be an array");
  if (modules.length > 0) virInputsQueryArgs(modules);
  const generatorStart = timerStart();
  const generatorResult = spawnSync(
    "lake",
    virIrpkgLakeBuildArgs(lakeTargets),
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  const generatorSeconds = elapsedSeconds(generatorStart);

  if ((generatorResult.status ?? 1) !== 0) {
    return failed("vir-irpkg", generatorResult, {
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
    return failed("lake-env", leanPath, { generatorSeconds });
  }

  const executable = spawnSync("lake", ["query", "--json", "vir_irpkg"], {
    cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
  });
  if ((executable.status ?? 1) !== 0) {
    return failed("vir-irpkg", executable, { generatorSeconds });
  }
  const inputs = modules.length > 0
    ? resolveVirInputsSync({ modules })
    : { ok: true, inputArgs: [] };
  if (!inputs.ok) return { ...inputs, generatorSeconds };

  return {
    ok: true,
    path: parseQueryPaths(executable.stdout, 1, repositoryRoot)[0],
    inputArgs: inputs.inputArgs,
    env: {
      ...process.env,
      LEAN_PATH: leanPath.stdout,
    },
    generatorSeconds,
  };
}

export function irpkgGeneratorFailureMessage(result) {
  switch (result.phase) {
    case "vir-irpkg":
      return "vir_irpkg generator build failed";
    case "lake-env":
      return "could not resolve the Lake module search path";
    case "vir-inputs":
      return "could not acquire Lake-resolved VIR inputs";
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
