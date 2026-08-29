/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const leanKeywords = new Set([
  "abbrev",
  "as",
  "axiom",
  "by",
  "class",
  "declare_syntax_cat",
  "decreasing_by",
  "def",
  "deriving",
  "do",
  "elab",
  "else",
  "end",
  "example",
  "export",
  "extends",
  "for",
  "forall",
  "from",
  "fun",
  "have",
  "if",
  "import",
  "in",
  "inductive",
  "infix",
  "infixl",
  "infixr",
  "instance",
  "let",
  "local",
  "macro",
  "macro_rules",
  "match",
  "mutual",
  "namespace",
  "noncomputable",
  "notation",
  "opaque",
  "open",
  "partial",
  "precedence",
  "private",
  "protected",
  "public",
  "return",
  "scoped",
  "section",
  "set_option",
  "structure",
  "syntax",
  "then",
  "theorem",
  "termination_by",
  "universe",
  "unsafe",
  "variable",
  "where",
  "with",
]);

export function validateLeanIdentifier(value, context) {
  if (!/^[\p{L}_][\p{L}\p{N}_']*$/u.test(value)) {
    throw new Error(`${context} is not a supported Lean identifier: ${JSON.stringify(value)}`);
  }
  return value;
}

export function leanBinderIdentifier(value, context) {
  validateLeanIdentifier(value, context);
  return leanKeywords.has(value) ? `«${value}»` : value;
}
