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
      ["anonymous", "Anonymous", 0],
      ["string", "String", 1],
      ["numeral", "Numeral", 2],
    ],
  },
  {
    leanPrefix: "irType",
    cppEnum: "ir_type_tag",
    tags: [
      ["float", "Float", 0],
      ["uint8", "UInt8", 1],
      ["uint16", "UInt16", 2],
      ["uint32", "UInt32", 3],
      ["uint64", "UInt64", 4],
      ["usize", "USize", 5],
      ["erased", "Erased", 6],
      ["object", "Object", 7],
      ["tobject", "TObject", 8],
      ["float32", "Float32", 9],
      ["tagged", "Tagged", 12],
      ["void", "Void", 13],
    ],
  },
  {
    leanPrefix: "arg",
    cppEnum: "arg_tag",
    tags: [
      ["var", "Var", 0],
      ["erased", "Erased", 1],
    ],
  },
  {
    leanPrefix: "lit",
    cppEnum: "literal_tag",
    tags: [
      ["num", "Num", 0],
      ["string", "String", 1],
    ],
  },
  {
    leanPrefix: "expr",
    cppEnum: "expr_tag",
    tags: [
      ["ctor", "Ctor", 0],
      ["reset", "Reset", 1],
      ["reuse", "Reuse", 2],
      ["proj", "Proj", 3],
      ["uproj", "UProj", 4],
      ["sproj", "SProj", 5],
      ["fap", "Fap", 6],
      ["pap", "Pap", 7],
      ["ap", "Ap", 8],
      ["box", "Box", 9],
      ["unbox", "Unbox", 10],
      ["lit", "Lit", 11],
      ["isShared", "IsShared", 12],
    ],
  },
  {
    leanPrefix: "alt",
    cppEnum: "alt_tag",
    tags: [
      ["ctor", "Ctor", 0],
      ["default", "Default", 1],
    ],
  },
  {
    leanPrefix: "body",
    cppEnum: "body_tag",
    tags: [
      ["vdecl", "VDecl", 0],
      ["jdecl", "JDecl", 1],
      ["set", "Set", 2],
      ["setTag", "SetTag", 3],
      ["uset", "USet", 4],
      ["sset", "SSet", 5],
      ["inc", "Inc", 6],
      ["dec", "Dec", 7],
      ["del", "Del", 8],
      ["case", "Case", 9],
      ["ret", "Ret", 10],
      ["jmp", "Jmp", 11],
      ["unreachable", "Unreachable", 12],
    ],
  },
  {
    leanPrefix: "decl",
    cppEnum: "decl_tag",
    tags: [
      ["fun", "Fun", 0],
      ["extern", "Extern", 1],
    ],
  },
];
