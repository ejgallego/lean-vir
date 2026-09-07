/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { BinaryWriter } from "./vir-codec.js";
import { objectTypeNeedsBoxedBoundary } from "./object-abi.js";

const encoder = new TextEncoder();

/**
 * Project a validated manifest onto the fields independently stored in the
 * provider's binary call tables. This is a transient validation message, not
 * another package format. Keep its order aligned with validate_package_contract.
 */
export function encodePackageContract(manifest) {
  const writer = new BinaryWriter();
  const string = (value) => {
    const bytes = encoder.encode(value);
    writer.u32(bytes.length);
    for (const byte of bytes) writer.u8(byte);
  };
  writer.u32(manifest.exports.length);
  for (const entry of manifest.exports) {
    string(entry.entry);
    writer.u32(entry.args.length);
    writer.u8(entry.effect !== "pure" ? 1 : 0);
    writer.u8(
      entry.args.some((arg) => objectTypeNeedsBoxedBoundary(arg.type)) ||
        objectTypeNeedsBoxedBoundary(entry.result)
        ? 1
        : 0,
    );
  }
  const imports = manifest.hostImports ?? [];
  writer.u32(imports.length);
  for (const entry of imports) {
    string(entry.name);
    string(entry.target);
    string(entry.symbol);
    writer.u32(entry.arity);
    writer.u32(entry.erasedPrefixArgs);
    writer.u8(entry.effect !== "pure" ? 1 : 0);
  }
  return writer.take();
}
