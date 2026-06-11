/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function encodeExpr(writer, value, label) {
  if (typeof value === "string") {
    value = { kind: "const", name: value, levels: [] };
  }
  switch (value?.kind) {
    case "bvar":
      writer.u8(0);
      writer.string(normalizeDecimal(value.index ?? value.deBruijnIndex, `${label}.index`, { signed: false }));
      return;
    case "fvar":
      writer.u8(1);
      writer.string(requireString(value.name, `${label}.name`));
      return;
    case "mvar":
      writer.u8(2);
      writer.string(requireString(value.name, `${label}.name`));
      return;
    case "sort":
      writer.u8(3);
      encodeLevel(writer, value.level ?? value.u, `${label}.level`);
      return;
    case "const":
      writer.u8(4);
      writer.string(requireString(value.name, `${label}.name`));
      encodeLevels(writer, value.levels ?? [], `${label}.levels`);
      return;
    case "app":
      writer.u8(5);
      encodeExpr(writer, value.fn, `${label}.fn`);
      encodeExpr(writer, value.arg, `${label}.arg`);
      return;
    case "lam":
    case "lambda":
      writer.u8(6);
      writer.string(requireString(value.name ?? value.binderName, `${label}.name`));
      encodeExpr(writer, value.type ?? value.binderType, `${label}.type`);
      encodeExpr(writer, value.body, `${label}.body`);
      writer.u8(normalizeBinderInfo(value.binderInfo ?? "default", `${label}.binderInfo`));
      return;
    case "forall":
    case "forallE":
      writer.u8(7);
      writer.string(requireString(value.name ?? value.binderName, `${label}.name`));
      encodeExpr(writer, value.type ?? value.binderType, `${label}.type`);
      encodeExpr(writer, value.body, `${label}.body`);
      writer.u8(normalizeBinderInfo(value.binderInfo ?? "default", `${label}.binderInfo`));
      return;
    case "let":
    case "letE":
      writer.u8(8);
      writer.string(requireString(value.name ?? value.declName, `${label}.name`));
      encodeExpr(writer, value.type, `${label}.type`);
      encodeExpr(writer, value.value, `${label}.value`);
      encodeExpr(writer, value.body, `${label}.body`);
      writer.u8(value.nondep ? 1 : 0);
      return;
    case "lit":
      writer.u8(9);
      encodeLiteral(writer, value.literal ?? value.value, `${label}.literal`);
      return;
    case "mdata":
      writer.u8(10);
      encodeExpr(writer, value.expr, `${label}.expr`);
      return;
    case "proj":
      writer.u8(11);
      writer.string(requireString(value.typeName, `${label}.typeName`));
      writer.string(normalizeDecimal(value.index ?? value.idx, `${label}.index`, { signed: false }));
      encodeExpr(writer, value.struct ?? value.expr, `${label}.struct`);
      return;
    default:
      throw new Error(`${label} has unsupported Lean.Expr kind ${value?.kind}`);
  }
}

export function decodeExpr(reader) {
  const kind = reader.u8();
  switch (kind) {
    case 0:
      return { kind: "bvar", index: reader.string() };
    case 1:
      return { kind: "fvar", name: reader.string() };
    case 2:
      return { kind: "mvar", name: reader.string() };
    case 3:
      return { kind: "sort", level: decodeLevel(reader) };
    case 4:
      return { kind: "const", name: reader.string(), levels: decodeLevels(reader) };
    case 5:
      return { kind: "app", fn: decodeExpr(reader), arg: decodeExpr(reader) };
    case 6:
      return {
        kind: "lam",
        name: reader.string(),
        type: decodeExpr(reader),
        body: decodeExpr(reader),
        binderInfo: decodeBinderInfo(reader.u8()),
      };
    case 7:
      return {
        kind: "forall",
        name: reader.string(),
        type: decodeExpr(reader),
        body: decodeExpr(reader),
        binderInfo: decodeBinderInfo(reader.u8()),
      };
    case 8:
      return {
        kind: "let",
        name: reader.string(),
        type: decodeExpr(reader),
        value: decodeExpr(reader),
        body: decodeExpr(reader),
        nondep: reader.u8() !== 0,
      };
    case 9:
      return { kind: "lit", literal: decodeLiteral(reader) };
    case 10:
      return { kind: "mdata", expr: decodeExpr(reader) };
    case 11:
      return { kind: "proj", typeName: reader.string(), index: reader.string(), struct: decodeExpr(reader) };
    default:
      throw new Error(`unsupported Lean.Expr result kind ${kind}`);
  }
}

function encodeLevel(writer, value, label) {
  const level = typeof value === "string" ? { kind: value } : value ?? { kind: "zero" };
  switch (level.kind) {
    case "zero":
      writer.u8(0);
      return;
    case "succ":
      writer.u8(1);
      encodeLevel(writer, level.of ?? level.level, `${label}.of`);
      return;
    case "max":
      writer.u8(2);
      encodeLevel(writer, level.left ?? level.lhs, `${label}.left`);
      encodeLevel(writer, level.right ?? level.rhs, `${label}.right`);
      return;
    case "imax":
      writer.u8(3);
      encodeLevel(writer, level.left ?? level.lhs, `${label}.left`);
      encodeLevel(writer, level.right ?? level.rhs, `${label}.right`);
      return;
    case "param":
      writer.u8(4);
      writer.string(requireString(level.name, `${label}.name`));
      return;
    case "mvar":
      writer.u8(5);
      writer.string(requireString(level.name, `${label}.name`));
      return;
    default:
      throw new Error(`${label} has unsupported Lean.Level kind ${level.kind}`);
  }
}

function decodeLevel(reader) {
  const kind = reader.u8();
  switch (kind) {
    case 0:
      return { kind: "zero" };
    case 1:
      return { kind: "succ", of: decodeLevel(reader) };
    case 2:
      return { kind: "max", left: decodeLevel(reader), right: decodeLevel(reader) };
    case 3:
      return { kind: "imax", left: decodeLevel(reader), right: decodeLevel(reader) };
    case 4:
      return { kind: "param", name: reader.string() };
    case 5:
      return { kind: "mvar", name: reader.string() };
    default:
      throw new Error(`unsupported Lean.Level result kind ${kind}`);
  }
}

function encodeLevels(writer, levels, label) {
  const values = levels == null ? [] : normalizeArray(levels, label);
  writer.u32(values.length);
  values.forEach((level, index) => encodeLevel(writer, level, `${label}[${index}]`));
}

function decodeLevels(reader) {
  const len = reader.u32();
  return Array.from({ length: len }, () => decodeLevel(reader));
}

function encodeLiteral(writer, value, label) {
  const literal = typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? { kind: typeof value === "string" ? "string" : "nat", value }
    : value;
  switch (literal?.kind) {
    case "nat":
      writer.u8(0);
      writer.string(normalizeDecimal(literal.value, `${label}.value`, { signed: false }));
      return;
    case "string":
      writer.u8(1);
      writer.string(requireString(literal.value, `${label}.value`));
      return;
    default:
      throw new Error(`${label} has unsupported Lean.Literal kind ${literal?.kind}`);
  }
}

function decodeLiteral(reader) {
  const kind = reader.u8();
  switch (kind) {
    case 0:
      return { kind: "nat", value: reader.string() };
    case 1:
      return { kind: "string", value: reader.string() };
    default:
      throw new Error(`unsupported Lean.Literal result kind ${kind}`);
  }
}

function normalizeBinderInfo(value, label) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3) return value;
  switch (value) {
    case "default":
      return 0;
    case "implicit":
      return 1;
    case "strictImplicit":
      return 2;
    case "instImplicit":
      return 3;
    default:
      throw new Error(`${label} must be default, implicit, strictImplicit, or instImplicit`);
  }
}

function decodeBinderInfo(value) {
  return ["default", "implicit", "strictImplicit", "instImplicit"][value] ?? String(value);
}

function normalizeDecimal(value, label, { signed }) {
  if (typeof value === "bigint") {
    if (!signed && value < 0n) throw new Error(`${label} must be non-negative`);
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer or decimal string`);
    if (!signed && value < 0) throw new Error(`${label} must be non-negative`);
    return String(value);
  }
  if (typeof value === "string") {
    const pattern = signed ? /^-?\d+$/ : /^\d+$/;
    if (!pattern.test(value.trim())) throw new Error(`${label} must be a decimal string`);
    return value.trim();
  }
  throw new Error(`${label} must be an integer, BigInt, or decimal string`);
}

function normalizeArray(value, label) {
  if (value == null || typeof value[Symbol.iterator] !== "function") {
    throw new Error(`${label} must be iterable`);
  }
  return Array.from(value);
}

function requireString(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}
