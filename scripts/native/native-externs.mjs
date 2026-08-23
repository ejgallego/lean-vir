/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { repositoryRoot } from "../repository-paths.mjs";

const execFileAsync = promisify(execFile);

export async function loadNativeExterns() {
  await execFileAsync("lake", ["build", "vir_native_wrappers"], {
    cwd: repositoryRoot,
    maxBuffer: 16 * 1024 * 1024,
  });
  const { stdout } = await execFileAsync(
    "lake",
    ["env", ".lake/build/bin/vir_native_wrappers", "--catalog"],
    { cwd: repositoryRoot, maxBuffer: 16 * 1024 * 1024 },
  );
  const catalog = JSON.parse(stdout);
  if (catalog.format !== "lean-vir-native-extern-catalog" || catalog.version !== 1) {
    throw new Error("unsupported native extern catalog");
  }
  return catalog.externs;
}
