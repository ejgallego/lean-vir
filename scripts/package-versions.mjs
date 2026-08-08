/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  PACKAGE_FORMAT_VERSION,
  INTERFACE_MANIFEST_VERSION,
  RUNTIME_ABI_VERSION,
} from "../web/src/runtime/package-versions.js";

export {
  PACKAGE_FORMAT_VERSION,
  INTERFACE_MANIFEST_VERSION,
  RUNTIME_ABI_VERSION,
};

export const PACKAGE_VERSIONS = {
  packageFormatVersion: PACKAGE_FORMAT_VERSION,
  manifestVersion: INTERFACE_MANIFEST_VERSION,
  runtimeAbiVersion: RUNTIME_ABI_VERSION,
};
