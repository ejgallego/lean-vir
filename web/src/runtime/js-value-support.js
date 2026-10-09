/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { INTERFACE_TAG } from "./interface-tags.js";

export function directJsArgumentSupported(type) {
  if (directJsValueSupported(type)) {
    return true;
  }
  if (type?.interfaceTag !== INTERFACE_TAG.FUNCTION) {
    return false;
  }
  const args = type.args;
  return (
    args.every((arg) => directJsValueSupported(arg.type)) &&
    directJsValueSupported(type.result)
  );
}

export function directJsResultSupported(type) {
  return directJsValueSupported(type);
}

function directJsValueSupported(type) {
  switch (type?.interfaceTag) {
    case INTERFACE_TAG.UNIT:
    case INTERFACE_TAG.RESOURCE:
      return true;
    default:
      return false;
  }
}
