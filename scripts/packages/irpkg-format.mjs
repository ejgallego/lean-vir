/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

import { readIrPackageInfo } from "../../web/src/runtime/ir-package.js";

export {
  IR_PACKAGE_MAGIC,
  IR_PACKAGE_SECTION,
  IR_PACKAGE_VERSION,
  encodeInvalidMagicPackage,
  readIrPackageInfo,
  replaceIrPackageManifest,
  validateIrPackageSetMembers,
} from "../../web/src/runtime/ir-package.js";

export async function readIrPackageFile(path) {
  return readIrPackageInfo(await readFile(path), { path });
}
