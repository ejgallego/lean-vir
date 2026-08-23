/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const IR_CODEC_TAG_GROUPS = [
  {
    leanPrefix: "name",
    cppEnum: "name_tag",
    tags: ["Anonymous", "String", "Numeral"],
  },
  {
    leanPrefix: "irType",
    cppEnum: "ir_type_tag",
    tags: [
      "Float", "UInt8", "UInt16", "UInt32", "UInt64", "USize",
      "Erased", "Object", "TObject", "Float32", "Tagged", "Void",
    ],
    reserved: [
      [10, "Lean.IR.IRType.struct is not supported by the package codec"],
      [11, "Lean.IR.IRType.union is not supported by the package codec"],
    ],
  },
  {
    leanPrefix: "arg",
    cppEnum: "arg_tag",
    tags: ["Var", "Erased"],
  },
  {
    leanPrefix: "lit",
    cppEnum: "literal_tag",
    tags: ["Num", "String"],
  },
  {
    leanPrefix: "expr",
    cppEnum: "expr_tag",
    tags: [
      "Ctor", "Reset", "Reuse", "Proj", "UProj", "SProj", "Fap",
      "Pap", "Ap", "Box", "Unbox", "Lit", "IsShared",
    ],
  },
  {
    leanPrefix: "alt",
    cppEnum: "alt_tag",
    tags: ["Ctor", "Default"],
  },
  {
    leanPrefix: "body",
    cppEnum: "body_tag",
    tags: [
      "VDecl", "JDecl", "Set", "SetTag", "USet", "SSet", "Inc",
      "Dec", "Del", "Case", "Ret", "Jmp", "Unreachable",
    ],
  },
  {
    leanPrefix: "decl",
    cppEnum: "decl_tag",
    tags: ["Fun", "Extern"],
  },
];
