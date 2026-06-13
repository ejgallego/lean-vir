/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function copyFileWithDirs(source, dest) {
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(source, dest);
}
