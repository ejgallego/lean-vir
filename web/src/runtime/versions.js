/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// JavaScript build/runtime contract. The ABI guard checks the Lean mirror.
import { IR_PACKAGE_VERSION } from "./ir-package.js";
import { INTERFACE_MANIFEST_VERSION } from "./interface-manifest.js";

export { INTERFACE_MANIFEST_VERSION };
export const PACKAGE_FORMAT_VERSION = IR_PACKAGE_VERSION;
export const RUNTIME_ABI_VERSION = 4;
// Combined resource contract; advance for breaking client API, runtime ABI or
// accepted program-format changes. This is not the runtime ABI number.
export const VIR_COMPATIBILITY_VERSION = 6;

export const PACKAGE_VERSIONS = Object.freeze({
  packageFormatVersion: PACKAGE_FORMAT_VERSION,
  manifestVersion: INTERFACE_MANIFEST_VERSION,
  runtimeAbiVersion: RUNTIME_ABI_VERSION,
});
