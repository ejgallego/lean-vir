/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { requireStructureFields } from "./vir-codec.js";
import { INTERFACE_TAG } from "./interface-tags.js";

export function objectTypeNeedsBoxedBoundary(type) {
  switch (type?.interfaceTag) {
    case INTERFACE_TAG.FLOAT:
    case INTERFACE_TAG.FLOAT32:
    case INTERFACE_TAG.UINT64:
      return true;
    case INTERFACE_TAG.STRUCTURE: {
      const fields = requireStructureFields(type, "object boundary");
      const trivial = trivialStructureField(type, fields);
      return trivial !== null && objectTypeNeedsBoxedBoundary(trivial.type);
    }
    default:
      return false;
  }
}

export function trivialStructureField(type, fields) {
  const index = type?.trivialFieldIndex;
  if (!Number.isInteger(index)) {
    return null;
  }
  if (index < 0 || index >= fields.length) {
    throw new Error(
      `${type?.type ?? "structure"} has invalid trivial field index`,
    );
  }
  return fields[index];
}
