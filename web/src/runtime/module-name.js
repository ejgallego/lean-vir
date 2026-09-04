/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function requireNormalizedModuleName(moduleName, label) {
  if (typeof moduleName !== "string" || moduleName.trim() === "") {
    throw new Error(`${label} has no module`);
  }
  if (
    moduleName !== moduleName.trim() ||
    /[\u0000-\u001f\u007f/\\:#?%]/u.test(moduleName)
  ) {
    throw new Error(`${label}.module must be a normalized Lean module name`);
  }
  let offset = 0;
  while (offset < moduleName.length) {
    if (moduleName[offset] === "«") {
      const end = moduleName.indexOf("»", offset + 1);
      if (end === offset + 1 || end < 0) {
        throw new Error(
          `${label}.module must be a normalized Lean module name`,
        );
      }
      offset = end + 1;
    } else {
      const end = moduleName.indexOf(".", offset);
      const component = moduleName.slice(
        offset,
        end < 0 ? moduleName.length : end,
      );
      if (component === "" || /[\s«»]/u.test(component)) {
        throw new Error(
          `${label}.module must be a normalized Lean module name`,
        );
      }
      offset += component.length;
    }
    if (offset === moduleName.length) return;
    if (moduleName[offset] !== "." || offset + 1 === moduleName.length) {
      throw new Error(`${label}.module must be a normalized Lean module name`);
    }
    offset += 1;
  }
}
