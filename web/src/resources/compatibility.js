/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  PACKAGE_FORMAT_VERSION,
  RUNTIME_ABI_VERSION,
  RESOURCE_JS_API_VERSION,
} from "../runtime/versions.js";

// Compiler identity is checked separately against the actual program/build.
export function assertResourceCompatibility(profile) {
  if (
    profile.runtimeAbi !== String(RUNTIME_ABI_VERSION) ||
    profile.jsApiVersion !== RESOURCE_JS_API_VERSION ||
    profile.irFormatVersion !== PACKAGE_FORMAT_VERSION
  ) {
    throw new Error(
      `unsupported resource runtime compatibility: expected ABI ${RUNTIME_ABI_VERSION}, JS API ${RESOURCE_JS_API_VERSION}, IR format ${PACKAGE_FORMAT_VERSION}`,
    );
  }
}
