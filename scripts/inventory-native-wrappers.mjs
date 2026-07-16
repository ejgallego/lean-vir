#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

import { parseNativeExterns } from "./native-externs.mjs";
import { parseGeneratedWrapperMacros } from "./native-wrapper-macros.mjs";

const nativeExternsPath = new URL("../Vir/GeneratePackage/NativeExterns.lean", import.meta.url);
const nativeSymbolsPath = new URL("../wasm/upstream_shim/runtime/native_symbols.cpp", import.meta.url);
const nativeRegistryPath = new URL("../wasm/upstream_shim/runtime/native_symbols_registry.inc", import.meta.url);

const intentionalDirectWrapperExceptions = new Map([
  [
    "lean_array_uget_borrowed___boxed",
    "the raw element result is borrowed and must be retained before the array is released",
  ],
]);

// Migration ratchet, not wrapper metadata: lower these counts whenever another
// macro-generated family moves to Lean's compiler. The check prevents the
// handwritten ordinary-wrapper population from growing again between batches.
const expectedMacroGeneratedWrapperCounts = new Map([
  ["generated-helper", 70],
  ["generated-direct", 43],
]);

const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (!["--all", "--check", "--json", "--regular-direct-shapes"].includes(arg)) {
    console.error(`unknown argument: ${arg}`);
    console.error(
      "usage: node scripts/inventory-native-wrappers.mjs [--all] [--check] [--json] [--regular-direct-shapes]",
    );
    process.exit(2);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRegistry(source) {
  const entries = [];
  const constants = [];
  const entryRegex = /^\s*(X|X_CONST)\("([^"]+)",\s*"([^"]+)",\s*([A-Za-z0-9_&]+)\)\s*\\?$/gm;
  for (const match of source.matchAll(entryRegex)) {
    const kind = match[1];
    const entry = {
      leanName: match[2],
      symbol: match[3],
      wrapper: match[4].replace(/^&/, ""),
    };
    if (kind === "X_CONST") {
      constants.push(entry);
    } else {
      entries.push(entry);
    }
  }
  return { entries, constants };
}

function parseWrappers(source) {
  const wrappers = new Map();
  const wrapperRegex =
    /^extern "C" lean_object \* ([A-Za-z0-9_]+___boxed)\(([\s\S]*?)\) \{\n([\s\S]*?)^}/gm;
  for (const match of source.matchAll(wrapperRegex)) {
    wrappers.set(match[1], {
      name: match[1],
      params: match[2].trim(),
      body: match[3],
    });
  }
  for (const wrapper of parseGeneratedWrapperMacros(source)) {
    wrappers.set(wrapper.name, wrapper);
  }
  return wrappers;
}

function entriesByWrapper(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const group = grouped.get(entry.wrapper) ?? [];
    group.push(entry);
    grouped.set(entry.wrapper, group);
  }
  return grouped;
}

function mentionsRegisteredSymbol(body, entries) {
  return entries.some((entry) => new RegExp(`\\b${escapeRegExp(entry.symbol)}\\b`).test(body));
}

function callsRegisteredSymbol(body, entries) {
  return entries.some((entry) => new RegExp(`\\b${escapeRegExp(entry.symbol)}\\s*\\(`).test(body));
}

function customMarker(body) {
  const markers = [
    ["control flow", /\b(if|for|while)\s*\(/],
    ["allocation or constructor access", /\blean_(alloc|ctor)_/],
    ["reference object internals", /\b(lean_ref_object|lean_to_ref|LeanRef)\b/],
    ["interpreter callback", /\brun_boxed\b/],
    ["trap", /__builtin_trap\b/],
    ["raw memory comparison", /\bmemcmp\s*\(/],
    ["shim global state", /\bg_vir_/],
    ["task runtime policy", /\blean_task_map_core\b/],
  ];
  return markers.find(([, pattern]) => pattern.test(body))?.[0] ?? null;
}

function classifyGeneratedWrapper(wrapper, entries, kind, mismatchLabel, reason) {
  if (!entries.every((entry) => entry.symbol === wrapper.symbol)) {
    return {
      kind: `${kind}-mismatch`,
      reason: `${mismatchLabel} wraps ${wrapper.symbol}, but registry has ${formatSymbols(entries)}`,
    };
  }
  return { kind, reason };
}

function classifyGeneratedDirectWrapper(wrapper, entries, reason) {
  return classifyGeneratedWrapper(wrapper, entries, "generated-direct", "generated direct wrapper", reason);
}

function classifyWrapper(wrapper, entries) {
  if (!wrapper) {
    return { kind: "missing", reason: "registry entry has no boxed wrapper definition" };
  }

  if (wrapper.generatedHelper) {
    return classifyGeneratedWrapper(
      wrapper,
      entries,
      "generated-helper",
      "generated helper",
      `macro-generated ${wrapper.arity} helper via ${wrapper.helper}`,
    );
  }

  if (wrapper.generatedDropTypeObject) {
    return classifyGeneratedDirectWrapper(
      wrapper,
      entries,
      `macro-generated drop-type ${wrapper.arity} object forwarder`,
    );
  }

  if (wrapper.generatedBorrowedObject) {
    const prefix = wrapper.dropType ? "drop-type borrowed-object" : "borrowed-object";
    return classifyGeneratedDirectWrapper(
      wrapper,
      entries,
      `macro-generated ${prefix} ${wrapper.arity} forwarder`,
    );
  }

  if (wrapper.generatedBorrowedScalar) {
    const prefix = wrapper.dropType ? "drop-type borrowed-object" : "borrowed-object";
    return classifyGeneratedDirectWrapper(
      wrapper,
      entries,
      `macro-generated ${prefix} ${wrapper.arity} forwarder returning ${wrapper.resultType}`,
    );
  }

  if (wrapper.generatedOwnedScalarScalar) {
    return classifyGeneratedDirectWrapper(
      wrapper,
      entries,
      `macro-generated owned-scalar ${wrapper.arity} forwarder ${wrapper.paramType} -> ${wrapper.resultType}`,
    );
  }

  if (wrapper.generatedOwnedScalarObjectlike) {
    return classifyGeneratedDirectWrapper(
      wrapper,
      entries,
      `macro-generated owned-scalar ${wrapper.arity} forwarder ${wrapper.paramType} -> objectlike`,
    );
  }

  if (wrapper.generatedOwnedObjectlike) {
    return classifyGeneratedDirectWrapper(
      wrapper,
      entries,
      `macro-generated owned-objectlike ${wrapper.arity} forwarder`,
    );
  }

  if (wrapper.generatedOwnedObjectlikeScalar) {
    return classifyGeneratedDirectWrapper(
      wrapper,
      entries,
      `macro-generated owned-objectlike/scalar ${wrapper.arity} forwarder ${wrapper.paramType}`,
    );
  }

  const compactBody = wrapper.body.trim().replace(/\s+/g, " ");
  const mentionsSymbol = mentionsRegisteredSymbol(wrapper.body, entries);
  const callsSymbol = callsRegisteredSymbol(wrapper.body, entries);
  const marker = customMarker(wrapper.body);

  if (/^return box_[A-Za-z0-9_]+\([^;]*\);$/.test(compactBody) && mentionsSymbol) {
    return { kind: "regular-helper", reason: "one-line box_* helper wrapper" };
  }

  if (/^return [A-Za-z0-9_]+___boxed\([^;]*\);$/.test(compactBody)) {
    return { kind: "custom-alias", reason: "forwards to another boxed wrapper" };
  }

  if (!marker && callsSymbol) {
    if (/\blean_inc\s*\(\s*result\s*\)/.test(wrapper.body)) {
      return { kind: "regular-direct-retain", reason: "direct native call plus result retain" };
    }
    return { kind: "regular-direct", reason: "direct native call with local box/unbox/dec plumbing" };
  }

  return {
    kind: "custom",
    reason: marker ?? "does not call the registered native symbol directly",
  };
}

function formatEntryNames(entries) {
  if (entries.length <= 3) {
    return entries.map((entry) => `\`${entry.leanName}\``).join(", ");
  }
  const first = entries.slice(0, 3).map((entry) => `\`${entry.leanName}\``).join(", ");
  return `${first}, ... (${entries.length} entries)`;
}

function formatSymbols(entries) {
  const symbols = [...new Set(entries.map((entry) => entry.symbol))];
  return symbols.map((symbol) => `\`${symbol}\``).join(", ");
}

function formatNativeExternParam(param) {
  return `${param.borrow ? "borrowed" : "owned"} ${param.type}`;
}

function formatNativeExternSignature(nativeExtern) {
  const params = nativeExtern.params.map(formatNativeExternParam).join(", ");
  return `${params || "no params"} -> ${nativeExtern.resultType}`;
}

const scalarTypes = new Set(["float", "float32", "uint8", "uint16", "uint32", "uint64", "usize"]);
const objectLikeTypes = new Set(["object", "tagged", "tobject"]);

function modelType(type) {
  if (scalarTypes.has(type)) {
    return "scalar";
  }
  if (objectLikeTypes.has(type)) {
    return "objectlike";
  }
  return type;
}

function formatNativeExternModelParam(param) {
  return `${param.borrow ? "borrowed" : "owned"} ${modelType(param.type)}`;
}

function formatNativeExternModelSignature(nativeExtern) {
  const params = nativeExtern.params.map(formatNativeExternModelParam).join(", ");
  return `${params || "no params"} -> ${modelType(nativeExtern.resultType)}`;
}

function nativeExternSignaturesForItem(item) {
  const signatures = [];
  for (const entry of item.entries) {
    const nativeExtern = nativeExterns.get(entry.leanName);
    signatures.push(
      nativeExtern ? formatNativeExternSignature(nativeExtern) : `${entry.leanName}: missing extern`,
    );
  }
  return [...new Set(signatures)];
}

function nativeExternModelSignaturesForItem(item) {
  const signatures = [];
  for (const entry of item.entries) {
    const nativeExtern = nativeExterns.get(entry.leanName);
    signatures.push(
      nativeExtern ? formatNativeExternModelSignature(nativeExtern) : `${entry.leanName}: missing extern`,
    );
  }
  return [...new Set(signatures)];
}

function helperForSignature(nativeExtern) {
  const types = nativeExtern.params.map((param) => param.type);
  if (types.length === 1) {
    const type = types[0];
    if (type === "tobject" && nativeExtern.resultType === "tobject") return "box_object_unary";
    if (type === "uint8" && nativeExtern.resultType === "uint8") return "box_uint8_unary";
    if (type === "uint16" && nativeExtern.resultType === "uint16") return "box_uint16_unary";
    if (type === "uint32" && nativeExtern.resultType === "uint32") return "box_uint32_unary";
    if (type === "uint64" && nativeExtern.resultType === "uint64") return "box_uint64_unary";
  } else if (types.length === 2 && types[0] === types[1]) {
    const type = types[0];
    const result = nativeExtern.resultType;
    if (type === "tobject" && result === "tobject") return "box_object_binary";
    if (type === "tobject" && result === "uint8") return "box_object_predicate";
    if (type === "uint8" && result === "uint8") return "box_uint8_binary";
    if (type === "uint16" && result === "uint16") return "box_uint16_binary";
    if (type === "uint16" && result === "uint8") return "box_uint16_predicate";
    if (type === "uint32" && result === "uint32") return "box_uint32_binary";
    if (type === "uint32" && result === "uint8") return "box_uint32_predicate";
    if (type === "uint64" && result === "uint64") return "box_uint64_binary";
    if (type === "uint64" && result === "uint8") return "box_uint64_predicate";
    if (type === "usize" && result === "usize") return "box_usize_binary";
    if (type === "usize" && result === "uint8") return "box_usize_predicate";
  }
  return null;
}

function paramCountForArity(arity) {
  switch (arity) {
    case "unary":
      return 1;
    case "binary":
      return 2;
    case "ternary":
      return 3;
    default:
      return null;
  }
}

function validateArityParamCount(nativeExtern, arity, extraParamCount = 0) {
  const forwardedParamCount = paramCountForArity(arity);
  if (forwardedParamCount === null) {
    return { reason: `unsupported generated direct arity ${arity}` };
  }

  const expectedParamCount = forwardedParamCount + extraParamCount;
  if (nativeExtern.params.length !== expectedParamCount) {
    return {
      reason: `expected ${expectedParamCount} params, found ${nativeExtern.params.length}`,
    };
  }
  return { forwardedParamCount };
}

function validateDropTypeObjectSignature(nativeExtern, arity) {
  const paramCount = validateArityParamCount(nativeExtern, arity, 1);
  if (paramCount.reason) {
    return paramCount.reason;
  }
  const [typeParam, ...forwardedParams] = nativeExtern.params;
  if (typeParam.type !== "erased") {
    return `first param is ${typeParam.type}, expected erased`;
  }
  if (typeParam.borrow) {
    return "first param is borrowed; generated forwarder drops an owned erased param";
  }
  for (const param of forwardedParams) {
    if (param.borrow) {
      return `param ${param.index} is borrowed; generated forwarder only supports owned params`;
    }
    if (!["object", "tobject"].includes(param.type)) {
      return `param ${param.index} is ${param.type}, expected object or tobject`;
    }
  }
  if (!["object", "tobject"].includes(nativeExtern.resultType)) {
    return `result is ${nativeExtern.resultType}, expected object or tobject`;
  }
  return null;
}

function validateBorrowedObjectParams(nativeExtern, arity, dropType, wrapperLabel) {
  const paramCount = validateArityParamCount(nativeExtern, arity, dropType ? 1 : 0);
  if (paramCount.reason) {
    return paramCount.reason;
  }

  const forwardedParams = dropType ? nativeExtern.params.slice(1) : nativeExtern.params;
  if (dropType) {
    const typeParam = nativeExtern.params[0];
    if (typeParam.type !== "erased") {
      return `first param is ${typeParam.type}, expected erased`;
    }
    if (typeParam.borrow) {
      return "first param is borrowed; generated forwarder drops an owned erased param";
    }
  }

  for (const param of forwardedParams) {
    if (!param.borrow) {
      return `param ${param.index} is owned; ${wrapperLabel} only supports borrowed params`;
    }
    if (!["object", "tobject"].includes(param.type)) {
      return `param ${param.index} is ${param.type}, expected object or tobject`;
    }
  }
  return null;
}

function validateBorrowedObjectSignature(nativeExtern, arity, dropType) {
  const reason = validateBorrowedObjectParams(
    nativeExtern,
    arity,
    dropType,
    "generated borrowed forwarder",
  );
  if (reason) {
    return reason;
  }
  if (!["object", "tobject", "tagged"].includes(nativeExtern.resultType)) {
    return `result is ${nativeExtern.resultType}, expected object, tobject, or tagged`;
  }
  return null;
}

function validateBorrowedScalarSignature(nativeExtern, arity, resultType, dropType) {
  const reason = validateBorrowedObjectParams(
    nativeExtern,
    arity,
    dropType,
    "generated borrowed scalar wrapper",
  );
  if (reason) {
    return reason;
  }
  if (nativeExtern.resultType !== resultType) {
    return `result is ${nativeExtern.resultType}, expected ${resultType}`;
  }
  return null;
}

function validateOwnedScalarScalarSignature(nativeExtern, arity, paramType, resultType) {
  const paramCount = validateArityParamCount(nativeExtern, arity);
  if (paramCount.reason) {
    return paramCount.reason;
  }
  const [param] = nativeExtern.params;
  if (param.borrow) {
    return `param ${param.index} is borrowed; generated owned scalar wrapper only supports owned params`;
  }
  if (param.type !== paramType) {
    return `param ${param.index} is ${param.type}, expected ${paramType}`;
  }
  if (nativeExtern.resultType !== resultType) {
    return `result is ${nativeExtern.resultType}, expected ${resultType}`;
  }
  return null;
}

function validateOwnedScalarObjectlikeSignature(nativeExtern, arity, paramType) {
  const paramCount = validateArityParamCount(nativeExtern, arity);
  if (paramCount.reason) {
    return paramCount.reason;
  }
  const [param] = nativeExtern.params;
  if (param.borrow) {
    return `param ${param.index} is borrowed; generated owned scalar wrapper only supports owned params`;
  }
  if (param.type !== paramType) {
    return `param ${param.index} is ${param.type}, expected ${paramType}`;
  }
  if (!objectLikeTypes.has(nativeExtern.resultType)) {
    return `result is ${nativeExtern.resultType}, expected objectlike`;
  }
  return null;
}

function validateOwnedObjectlikeSignature(nativeExtern, arity) {
  const paramCount = validateArityParamCount(nativeExtern, arity);
  if (paramCount.reason) {
    return paramCount.reason;
  }
  const [param] = nativeExtern.params;
  if (param.borrow) {
    return `param ${param.index} is borrowed; generated owned objectlike wrapper only supports owned params`;
  }
  if (!["object", "tobject"].includes(param.type)) {
    return `param ${param.index} is ${param.type}, expected object or tobject`;
  }
  if (!["object", "tobject"].includes(nativeExtern.resultType)) {
    return `result is ${nativeExtern.resultType}, expected object or tobject`;
  }
  return null;
}

function validateOwnedObjectlikeScalarSignature(nativeExtern, arity, scalarType) {
  const paramCount = validateArityParamCount(nativeExtern, arity);
  if (paramCount.reason) {
    return paramCount.reason;
  }
  const [objectParam, scalarParam] = nativeExtern.params;
  if (objectParam.borrow) {
    return `param ${objectParam.index} is borrowed; generated owned objectlike/scalar wrapper only supports owned objectlike params`;
  }
  if (!["object", "tobject"].includes(objectParam.type)) {
    return `param ${objectParam.index} is ${objectParam.type}, expected object or tobject`;
  }
  if (scalarParam.borrow) {
    return `param ${scalarParam.index} is borrowed; generated owned objectlike/scalar wrapper only supports owned scalar params`;
  }
  if (scalarParam.type !== scalarType) {
    return `param ${scalarParam.index} is ${scalarParam.type}, expected ${scalarType}`;
  }
  if (!["object", "tobject"].includes(nativeExtern.resultType)) {
    return `result is ${nativeExtern.resultType}, expected object or tobject`;
  }
  return null;
}

function validateGeneratedDirectSignature(wrapper, nativeExtern) {
  if (wrapper.generatedDropTypeObject) {
    return validateDropTypeObjectSignature(nativeExtern, wrapper.arity);
  }
  if (wrapper.generatedBorrowedObject) {
    return validateBorrowedObjectSignature(nativeExtern, wrapper.arity, wrapper.dropType);
  }
  if (wrapper.generatedBorrowedScalar) {
    return validateBorrowedScalarSignature(
      nativeExtern,
      wrapper.arity,
      wrapper.resultType,
      wrapper.dropType,
    );
  }
  if (wrapper.generatedOwnedScalarScalar) {
    return validateOwnedScalarScalarSignature(
      nativeExtern,
      wrapper.arity,
      wrapper.paramType,
      wrapper.resultType,
    );
  }
  if (wrapper.generatedOwnedScalarObjectlike) {
    return validateOwnedScalarObjectlikeSignature(nativeExtern, wrapper.arity, wrapper.paramType);
  }
  if (wrapper.generatedOwnedObjectlike) {
    return validateOwnedObjectlikeSignature(nativeExtern, wrapper.arity);
  }
  if (wrapper.generatedOwnedObjectlikeScalar) {
    return validateOwnedObjectlikeScalarSignature(nativeExtern, wrapper.arity, wrapper.paramType);
  }
  return "unsupported generated direct wrapper macro";
}

function parseWrapperParamNames(params) {
  return [...params.matchAll(/\blean_object\s*\*\s*([A-Za-z0-9_]+)/g)].map((match) => match[1]);
}

function uniqueMatches(source, regex) {
  return [...new Set([...source.matchAll(regex)].map((match) => match[0]))].sort();
}

function decedParamNames(body, params) {
  return params.filter((param) => new RegExp(`\\blean_dec\\s*\\(\\s*${escapeRegExp(param)}\\s*\\)`).test(body));
}

function nativeCallStyle(body, entries) {
  const compactBody = body.trim().replace(/\s+/g, " ");
  for (const entry of entries) {
    const symbol = escapeRegExp(entry.symbol);
    if (new RegExp(`^return\\s+${symbol}\\s*\\(`).test(compactBody)) {
      return "call=direct-return";
    }
    if (new RegExp(`\\bresult\\s*=\\s*${symbol}\\s*\\(`).test(compactBody)) {
      return "call=result-assignment";
    }
    if (new RegExp(`\\b${symbol}\\s*\\(`).test(compactBody)) {
      return "call=direct";
    }
  }
  return "call=unknown";
}

function resultReturnStyle(body) {
  const compactBody = body.trim().replace(/\s+/g, " ");
  const boxedResult = /\breturn\s+(lean_box(?:_[A-Za-z0-9]+)?)\s*\(\s*result\s*\)\s*;/.exec(
    compactBody,
  );
  if (boxedResult) {
    return `return=${boxedResult[1]}(result)`;
  }
  if (/\breturn\s+result\s*;/.test(compactBody)) {
    return "return=result";
  }
  if (/\breturn\s+[A-Za-z0-9_]+\s*\([^;]*\)\s*;/.test(compactBody)) {
    return "return=call";
  }
  return "return=custom";
}

function resultReturnModel(body) {
  const compactBody = body.trim().replace(/\s+/g, " ");
  if (/\breturn\s+lean_box(?:_[A-Za-z0-9]+)?\s*\(\s*result\s*\)\s*;/.test(compactBody)) {
    return "return=boxed-scalar";
  }
  if (/\breturn\s+result\s*;/.test(compactBody)) {
    return "return=result";
  }
  if (/\breturn\s+[A-Za-z0-9_]+\s*\([^;]*\)\s*;/.test(compactBody)) {
    return "return=call";
  }
  return "return=custom";
}

function decModel(decedCount, paramCount) {
  if (decedCount === 0) {
    return "decs=none";
  }
  if (decedCount === paramCount) {
    return "decs=all";
  }
  return "decs=partial";
}

function wrapperPlumbingSignature(wrapper, entries) {
  const params = parseWrapperParamNames(wrapper.params);
  const decs = decedParamNames(wrapper.body, params);
  const unboxes = uniqueMatches(wrapper.body, /\blean_unbox(?:_[A-Za-z0-9]+)?\b/g);
  const parts = [
    nativeCallStyle(wrapper.body, entries),
    resultReturnStyle(wrapper.body),
    `unbox=${unboxes.length === 0 ? "none" : unboxes.join("+")}`,
    `decs=${decs.length}/${params.length}`,
  ];
  return parts.join("; ");
}

function wrapperPlumbingModel(wrapper, entries) {
  const params = parseWrapperParamNames(wrapper.params);
  const decs = decedParamNames(wrapper.body, params);
  const unboxes = uniqueMatches(wrapper.body, /\blean_unbox(?:_[A-Za-z0-9]+)?\b/g);
  const parts = [
    nativeCallStyle(wrapper.body, entries),
    resultReturnModel(wrapper.body),
    `unbox=${unboxes.length === 0 ? "none" : "scalar"}`,
    decModel(decs.length, params.length),
  ];
  return parts.join("; ");
}

function buildRegularDirectShapes(inventory) {
  const byShape = new Map();
  for (const item of inventory) {
    if (item.kind !== "regular-direct") {
      continue;
    }
    const wrapper = wrappers.get(item.wrapper);
    const exactSignatures = nativeExternSignaturesForItem(item);
    const modelSignatures = nativeExternModelSignaturesForItem(item);
    const model = modelSignatures.join(" | ");
    const plumbing = wrapper ? wrapperPlumbingModel(wrapper, item.entries) : "missing wrapper";
    const detail = wrapper ? wrapperPlumbingSignature(wrapper, item.entries) : "missing wrapper";
    const key = `${model}\n${plumbing}`;
    const group = byShape.get(key) ?? {
      model,
      plumbing,
      exactSignatures: new Set(),
      details: new Set(),
      items: [],
    };
    for (const signature of exactSignatures) {
      group.exactSignatures.add(signature);
    }
    group.details.add(detail);
    group.items.push(item);
    byShape.set(key, group);
  }
  return [...byShape.values()]
    .map((shape) => ({
      ...shape,
      exactSignatures: [...shape.exactSignatures].sort(),
      details: [...shape.details].sort(),
    }))
    .sort(
      (lhs, rhs) =>
        rhs.items.length - lhs.items.length ||
        lhs.model.localeCompare(rhs.model) ||
        lhs.plumbing.localeCompare(rhs.plumbing),
    );
}

function printRegularDirectShapes(shapes) {
  console.log("\n## regular-direct shapes");
  for (const shape of shapes) {
    console.log(`\n- ${shape.items.length} wrapper(s): ${shape.model}`);
    console.log(`  plumbing: ${shape.plumbing}`);
    console.log(`  exact signatures: ${shape.exactSignatures.join(" | ")}`);
    if (shape.details.length > 1) {
      console.log(`  detail variants: ${shape.details.join(" | ")}`);
    }
    for (const item of shape.items) {
      console.log(`  - \`${item.wrapper}\`: ${formatEntryNames(item.entries)}`);
    }
  }
}

const [nativeExternsSource, nativeSymbols, nativeRegistry] = await Promise.all([
  readFile(nativeExternsPath, "utf8"),
  readFile(nativeSymbolsPath, "utf8"),
  readFile(nativeRegistryPath, "utf8"),
]);

const nativeExterns = new Map(
  parseNativeExterns(nativeExternsSource).map((nativeExtern) => [nativeExtern.name, nativeExtern]),
);
const compilerGeneratedExterns = [...nativeExterns.values()].filter(
  (nativeExtern) => nativeExtern.generateBoxedWrapper,
);
const { entries, constants } = parseRegistry(nativeRegistry);
const wrappers = parseWrappers(nativeSymbols);
const grouped = entriesByWrapper(entries);
const inventory = [];

for (const [wrapperName, groupEntries] of grouped.entries()) {
  const wrapper = wrappers.get(wrapperName);
  const item = {
    wrapper: wrapperName,
    entries: groupEntries,
    ...classifyWrapper(wrapper, groupEntries),
  };
  if (item.kind === "generated-helper") {
    const expectedHelpers = new Set();
    for (const entry of groupEntries) {
      const nativeExtern = nativeExterns.get(entry.leanName);
      if (!nativeExtern) {
        item.kind = "generated-helper-mismatch";
        item.reason = `${entry.leanName}: no native extern entry found`;
        break;
      }
      const expectedHelper = helperForSignature(nativeExtern);
      if (!expectedHelper) {
        item.kind = "generated-helper-mismatch";
        item.reason = `${entry.leanName}: no helper mapping for ${nativeExtern.params
          .map((param) => param.type)
          .join(", ")} -> ${nativeExtern.resultType}`;
        break;
      }
      expectedHelpers.add(expectedHelper);
    }
    if (item.kind === "generated-helper") {
      const expected = [...expectedHelpers];
      if (expected.length !== 1 || expected[0] !== wrapper.helper) {
        item.kind = "generated-helper-mismatch";
        item.reason = `macro uses ${wrapper.helper}, expected ${expected.join(" or ")}`;
      }
    }
  }
  if (item.kind === "generated-direct") {
    for (const entry of groupEntries) {
      const nativeExtern = nativeExterns.get(entry.leanName);
      if (!nativeExtern) {
        item.kind = "generated-direct-mismatch";
        item.reason = `${entry.leanName}: no native extern entry found`;
        break;
      }
      const reason = validateGeneratedDirectSignature(wrapper, nativeExtern);
      if (reason) {
        item.kind = "generated-direct-mismatch";
        item.reason = `${entry.leanName}: ${reason}`;
        break;
      }
    }
  }
  inventory.push(item);
}

for (const nativeExtern of compilerGeneratedExterns) {
  inventory.push({
    wrapper: `${nativeExtern.name}._boxed`,
    entries: [{
      leanName: nativeExtern.name,
      symbol: nativeExtern.symbol,
      wrapper: `${nativeExtern.name}._boxed`,
    }],
    kind: "compiler-generated",
    reason: "emitted by Lean's standard LCNF boxing and C emission pipeline",
  });
}

for (const wrapperName of wrappers.keys()) {
  if (!grouped.has(wrapperName)) {
    inventory.push({
      wrapper: wrapperName,
      entries: [],
      kind: "extra",
      reason: "boxed wrapper is not referenced by the native registry",
    });
  }
}

const kindOrder = [
  "compiler-generated",
  "generated-helper",
  "generated-direct",
  "regular-helper",
  "regular-direct",
  "regular-direct-retain",
  "custom-alias",
  "custom",
  "generated-helper-mismatch",
  "generated-direct-mismatch",
  "missing",
  "extra",
];
const byKind = new Map(kindOrder.map((kind) => [kind, []]));
for (const item of inventory) {
  const group = byKind.get(item.kind) ?? [];
  group.push(item);
  byKind.set(item.kind, group);
}

const regularDirectShapes = args.has("--regular-direct-shapes") ? buildRegularDirectShapes(inventory) : [];

if (args.has("--json")) {
  const payload = args.has("--regular-direct-shapes")
    ? { constants, inventory, regularDirectShapes }
    : { constants, inventory };
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(
    `native wrapper inventory: ${inventory.length} boxed wrappers, ${entries.length} boxed registry entries, ` +
      `${compilerGeneratedExterns.length} compiler-generated registry entries, ` +
      `${constants.length} native constants`,
  );
  for (const kind of kindOrder) {
    const group = byKind.get(kind) ?? [];
    if (group.length !== 0) {
      console.log(`${kind}: ${group.length}`);
    }
  }

  const shapeOnly = args.has("--regular-direct-shapes") && !args.has("--all") && !args.has("--check");
  const shouldList = (kind) =>
    !shapeOnly &&
    (args.has("--all") ||
    (args.has("--check")
      ? ["generated-helper-mismatch", "generated-direct-mismatch", "missing", "extra"].includes(kind)
      : [
          "generated-helper-mismatch",
          "generated-direct-mismatch",
          "regular-direct-retain",
          "custom-alias",
          "custom",
          "missing",
          "extra",
        ].includes(kind)));

  for (const kind of kindOrder) {
    const group = byKind.get(kind) ?? [];
    if (group.length === 0 || !shouldList(kind)) {
      continue;
    }
    console.log(`\n## ${kind}`);
    for (const item of group) {
      const names = item.entries.length === 0 ? "(none)" : formatEntryNames(item.entries);
      const symbols = item.entries.length === 0 ? "(none)" : formatSymbols(item.entries);
      console.log(`- \`${item.wrapper}\`: ${names}; symbols ${symbols}; ${item.reason}`);
    }
  }

  if (args.has("--regular-direct-shapes")) {
    printRegularDirectShapes(regularDirectShapes);
  }
}

if (args.has("--check")) {
  const failures = inventory.filter((item) =>
    ["generated-helper-mismatch", "generated-direct-mismatch", "missing", "extra"].includes(item.kind)
  );
  const directPolicyFailures = [];
  const foundDirectExceptions = new Set();
  for (const item of inventory) {
    if (item.kind === "regular-helper" || item.kind === "regular-direct") {
      directPolicyFailures.push(
        `${item.wrapper}: ordinary adapter must be compiler-generated or explicitly custom`,
      );
    } else if (item.kind === "regular-direct-retain") {
      const reason = intentionalDirectWrapperExceptions.get(item.wrapper);
      if (reason) {
        foundDirectExceptions.add(item.wrapper);
      } else {
        directPolicyFailures.push(`${item.wrapper}: unapproved direct ownership adapter`);
      }
    }
  }
  for (const [wrapper, reason] of intentionalDirectWrapperExceptions) {
    if (!foundDirectExceptions.has(wrapper)) {
      directPolicyFailures.push(`${wrapper}: expected direct ownership exception is missing (${reason})`);
    }
  }
  for (const [kind, expected] of expectedMacroGeneratedWrapperCounts) {
    const actual = (byKind.get(kind) ?? []).length;
    if (actual !== expected) {
      directPolicyFailures.push(
        `${kind}: expected ${expected} handwritten wrapper(s), found ${actual}; update the migration ratchet with the intentional conversion`,
      );
    }
  }
  if (failures.length !== 0 || directPolicyFailures.length !== 0) {
    if (args.has("--json")) {
      console.error(
        `native wrapper inventory check failed: ${failures.length + directPolicyFailures.length} failure(s)`,
      );
    }
    for (const failure of directPolicyFailures) {
      console.error(`native wrapper policy failure: ${failure}`);
    }
    process.exit(1);
  }
}
