/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const IR_CODEC_TAG_GROUPS = [
  {
    leanPrefix: "name",
    cppEnum: "name_tag",
    tags: [
      ["Anonymous", 0],
      ["String", 1],
      ["Numeral", 2],
    ],
  },
  {
    leanPrefix: "irType",
    cppEnum: "ir_type_tag",
    tags: [
      ["Float", 0],
      ["UInt8", 1],
      ["UInt16", 2],
      ["UInt32", 3],
      ["UInt64", 4],
      ["USize", 5],
      ["Erased", 6],
      ["Object", 7],
      ["TObject", 8],
      ["Float32", 9],
      ["Tagged", 12],
      ["Void", 13],
    ],
    reserved: [
      [10, "Lean.IR.IRType.struct is not supported by the package codec"],
      [11, "Lean.IR.IRType.union is not supported by the package codec"],
    ],
  },
  {
    leanPrefix: "arg",
    cppEnum: "arg_tag",
    tags: [
      ["Var", 0],
      ["Erased", 1],
    ],
  },
  {
    leanPrefix: "lit",
    cppEnum: "literal_tag",
    tags: [
      ["Num", 0],
      ["String", 1],
    ],
  },
  {
    leanPrefix: "expr",
    cppEnum: "expr_tag",
    tags: [
      ["Ctor", 0],
      ["Reset", 1],
      ["Reuse", 2],
      ["Proj", 3],
      ["UProj", 4],
      ["SProj", 5],
      ["Fap", 6],
      ["Pap", 7],
      ["Ap", 8],
      ["Box", 9],
      ["Unbox", 10],
      ["Lit", 11],
      ["IsShared", 12],
    ],
  },
  {
    leanPrefix: "alt",
    cppEnum: "alt_tag",
    tags: [
      ["Ctor", 0],
      ["Default", 1],
    ],
  },
  {
    leanPrefix: "body",
    cppEnum: "body_tag",
    tags: [
      ["VDecl", 0],
      ["JDecl", 1],
      ["Set", 2],
      ["SetTag", 3],
      ["USet", 4],
      ["SSet", 5],
      ["Inc", 6],
      ["Dec", 7],
      ["Del", 8],
      ["Case", 9],
      ["Ret", 10],
      ["Jmp", 11],
      ["Unreachable", 12],
    ],
  },
  {
    leanPrefix: "decl",
    cppEnum: "decl_tag",
    tags: [
      ["Fun", 0],
      ["Extern", 1],
    ],
  },
];
