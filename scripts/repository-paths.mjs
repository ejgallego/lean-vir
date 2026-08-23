/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRootUrl = new URL("../", import.meta.url);
export const repositoryRoot = fileURLToPath(repositoryRootUrl);

export function repositoryPath(...segments) {
  return join(repositoryRoot, ...segments);
}
