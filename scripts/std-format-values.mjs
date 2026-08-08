/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const stdFormat = Object.freeze({
  nil: () => ({ kind: "nil" }),
  line: () => ({ kind: "line" }),
  align: (force) => ({ kind: "align", value: force }),
  text: (value) => ({ kind: "text", value }),
  nest: (indent, f) => ({ kind: "nest", fields: { indent, f } }),
  append: (arg1, arg2) => ({ kind: "append", fields: { arg1, arg2 } }),
  group: (arg1, behavior = "fill") => ({ kind: "group", fields: { arg1, behavior } }),
  tag: (arg1, arg2) => ({ kind: "tag", fields: { arg1, arg2 } }),
});

export function balancedStdFormatAppend(formats) {
  if (formats.length === 0) return stdFormat.nil();
  let level = formats.slice();
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(index + 1 < level.length
        ? stdFormat.append(level[index], level[index + 1])
        : level[index]);
    }
    level = next;
  }
  return level[0];
}

export function taggedStdFormatChunks(depth, chunks) {
  return balancedStdFormatAppend(Array.from({ length: chunks }, (_unused, chunk) => {
    let format = stdFormat.text("x");
    for (let tag = 0; tag < depth; tag += 1) {
      format = stdFormat.tag(String(chunk * depth + tag + 1), format);
    }
    return format;
  }));
}
