/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function typeAnchorFragment(id) {
  return id.toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "") || "anchor";
}

export function typeScriptAnchorId(anchor) {
  return anchor.id ?? `${typeAnchorFragment(anchor.lean)}_to_${typeAnchorFragment(anchor.ts)}`;
}

export function validateTypeScriptAnchors(anchors, symbolIds) {
  if (!Array.isArray(anchors)) throw new Error("anchors must be an array");
  const anchorFields = new Set(["id", "lean", "ts", "relation", "note"]);
  const ids = new Set();
  for (const [index, anchor] of anchors.entries()) {
    if (anchor === null || typeof anchor !== "object" || Array.isArray(anchor)) {
      throw new Error(`anchors[${index}] must be an object`);
    }
    const unknown = Object.keys(anchor).find((field) => !anchorFields.has(field));
    if (unknown !== undefined) {
      throw new Error(`anchors[${index}].${unknown} is not a structural anchor field`);
    }
    if (typeof anchor.lean !== "string" || anchor.lean.length === 0) {
      throw new Error(`anchors[${index}].lean must be a non-empty string`);
    }
    if (typeof anchor.ts !== "string" || anchor.ts.length === 0) {
      throw new Error(`anchors[${index}].ts must be a non-empty string`);
    }
    if (!symbolIds.has(anchor.ts)) {
      throw new Error(`anchors[${index}].ts references missing TypeScript symbol ${anchor.ts}`);
    }
    if (anchor.relation !== undefined && !["audit", "coverageGap"].includes(anchor.relation)) {
      throw new Error(`anchors[${index}].relation must be audit or coverageGap`);
    }
    for (const field of ["id", "note"]) {
      if (anchor[field] !== undefined &&
          (typeof anchor[field] !== "string" || anchor[field].length === 0)) {
        throw new Error(`anchors[${index}].${field} must be a non-empty string`);
      }
    }
    const id = typeScriptAnchorId(anchor);
    const fragment = typeAnchorFragment(id);
    if (ids.has(fragment)) throw new Error(`duplicate anchor id ${id}`);
    ids.add(fragment);
  }
}
