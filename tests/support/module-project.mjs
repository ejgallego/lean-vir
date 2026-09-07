/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { repositoryRoot } from "../../scripts/repository-paths.mjs";

// This test helper deliberately accepts only simple module names, not Lean's
// full escaped-name grammar. Declaration names inside a module are unrestricted.
export function testModulePath(name) {
  if (
    typeof name !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/.test(name)
  ) {
    throw new Error(`invalid test module name: ${JSON.stringify(name)}`);
  }
  return `${name.replaceAll(".", "/")}.lean`;
}

/** Caller owns this scratch directory and its lifetime. Sources are not rewritten. */
export async function createTestModuleProject({
  directory,
  modules,
  dependencyRoot = repositoryRoot,
}) {
  directory = resolve(directory);
  dependencyRoot = resolve(dependencyRoot);
  const entries = Object.entries(modules);
  const names = entries.map(([name]) => name);
  const paths = entries.map(([name]) => testModulePath(name));
  if (names.length === 0)
    throw new Error("test module project requires modules");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "lean-toolchain"),
    await readFile(join(dependencyRoot, "lean-toolchain")),
  );
  await writeFile(
    join(directory, "lakefile.toml"),
    [
      'name = "vir_test_inputs"',
      "[[require]]",
      'name = "lean_vir"',
      `path = ${JSON.stringify(dependencyRoot)}`,
      "[[lean_lib]]",
      'name = "TestInputs"',
      `roots = ${JSON.stringify(names)}`,
      "",
    ].join("\n"),
  );
  for (const [index, [, source]] of entries.entries()) {
    const path = join(directory, paths[index]);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source);
  }
  function lake(args) {
    return spawnSync("lake", args, {
      cwd: directory,
      encoding: "utf8",
      timeout: 120_000,
    });
  }
  function build(selected = names) {
    if (selected.length === 0)
      throw new Error("test module build requires modules");
    for (const name of selected) {
      if (!names.includes(name))
        throw new Error(`unknown test module: ${name}`);
    }
    return lake(["build", ...new Set(selected.map((name) => `+${name}`))]);
  }
  // Keep Lake's relative paths paired with this project's cwd at every call.
  function env() {
    const result = lake([
      "env",
      process.execPath,
      "-e",
      "process.stdout.write(process.env.LEAN_PATH ?? '')",
    ]);
    if (result.status !== 0) {
      throw new Error(
        `test module environment failed: ${result.error ?? result.stderr ?? result.stdout}`,
      );
    }
    return { ...process.env, LEAN_PATH: result.stdout };
  }
  return Object.freeze({
    directory,
    build,
    env,
    sourcePath: (name) => join(directory, testModulePath(name)),
  });
}
