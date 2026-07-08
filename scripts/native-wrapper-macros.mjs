/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function parseGeneratedWrapperMacros(source) {
  const wrappers = [];

  const generatedHelperRegex =
    /^VIR_DEFINE_BOX_(UNARY|BINARY)_WRAPPER\(([A-Za-z0-9_]+),\s*([A-Za-z0-9_]+)\)$/gm;
  for (const match of source.matchAll(generatedHelperRegex)) {
    const symbol = match[2];
    wrappers.push({
      name: `${symbol}___boxed`,
      generatedHelper: true,
      arity: match[1].toLowerCase(),
      symbol,
      helper: match[3],
    });
  }

  const generatedDropTypeObjectRegex =
    /^VIR_DEFINE_DROP_TYPE_OBJECT_(UNARY|BINARY)_WRAPPER\(([A-Za-z0-9_]+)\)$/gm;
  for (const match of source.matchAll(generatedDropTypeObjectRegex)) {
    const symbol = match[2];
    wrappers.push({
      name: `${symbol}___boxed`,
      generatedDropTypeObject: true,
      arity: match[1].toLowerCase(),
      symbol,
    });
  }

  const generatedBorrowedObjectRegex =
    /^VIR_DEFINE_(DROP_TYPE_)?BORROWED_OBJECT_(UNARY|BINARY|TERNARY)_WRAPPER\(([A-Za-z0-9_]+)\)$/gm;
  for (const match of source.matchAll(generatedBorrowedObjectRegex)) {
    const symbol = match[3];
    wrappers.push({
      name: `${symbol}___boxed`,
      generatedBorrowedObject: true,
      dropType: match[1] !== undefined,
      arity: match[2].toLowerCase(),
      symbol,
    });
  }

  const generatedBorrowedScalarRegex =
    /^VIR_DEFINE_BORROWED_OBJECT_(UINT8|UINT32|UINT64)_(UNARY|BINARY)_WRAPPER\(([A-Za-z0-9_]+)\)$/gm;
  for (const match of source.matchAll(generatedBorrowedScalarRegex)) {
    const symbol = match[3];
    wrappers.push({
      name: `${symbol}___boxed`,
      generatedBorrowedScalar: true,
      resultType: match[1].toLowerCase(),
      arity: match[2].toLowerCase(),
      symbol,
    });
  }

  return wrappers;
}

export function generatedWrapperNames(source) {
  return new Set(parseGeneratedWrapperMacros(source).map((wrapper) => wrapper.name));
}
