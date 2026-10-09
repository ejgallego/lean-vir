/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { requireInterfaceEffect, formatInterfaceEffectPrefix } from "./interface-effects.js";

const primitiveTags = new Set(["nat", "int", "string", "byteArray", "unsigned", "float"]);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (label, message) => { throw new Error(`${label} ${message}`); };
const uint = (value, label) => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) fail(label, "must be a non-negative 32-bit integer");
};
function object(value, allowed, label) {
  if (!record(value)) fail(label, "must be an object");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}.${key}`, "is not supported");
}
function string(value, label) {
  if (typeof value !== "string" || !value) fail(label, "must be a non-empty string");
}
function array(value, label) {
  if (!Array.isArray(value)) fail(label, "must be an array");
}

// Admit compiler facts and the chosen value mapping at the package boundary.
// Runtime codecs consume these immutable facts without repeating admission.
export function validateBoundaryInterface(pair, label = "interface type") {
  object(pair, ["native", "value"], label);
  validateNative(pair.native, [], `${label}.native`);
  validateView(pair.native, pair.value, [], `${label}.value`);
  return pair;
}

function validateNative(native, owners, label) {
  if (record(native) && Object.hasOwn(native, "ref")) {
    object(native, ["ref"], label);
    uint(native.ref, `${label}.ref`);
    if (owners[native.ref] === undefined) fail(`${label}.ref`, "has no enclosing recursive descriptor");
    return;
  }
  object(native, ["type", "metadata"], label);
  object(native.type, ["tag", "width"], `${label}.type`);
  const tag = native.type.tag;
  if (!primitiveTags.has(tag) && tag !== "leanObject" && tag !== "resource") fail(`${label}.type.tag`, "is not supported");
  if (tag === "unsigned") {
    if (![8, 16, 32, 64, "usize"].includes(native.type.width)) fail(`${label}.type.width`, "is not supported");
  } else if (tag === "float") {
    if (![32, 64].includes(native.type.width)) fail(`${label}.type.width`, "must be 32 or 64");
  } else if (native.type.width !== undefined) fail(`${label}.type.width`, "is not supported");
  const metadata = native.metadata;
  if (metadata === undefined) return;
  object(metadata, ["declaration", "constructors", "arrayElement", "signature"], `${label}.metadata`);
  if (metadata.declaration !== undefined) string(metadata.declaration, `${label}.metadata.declaration`);
  if (tag !== "leanObject" && ["constructors", "arrayElement", "signature"].some(key => metadata[key] !== undefined))
    fail(`${label}.metadata`, "requires a Lean-object type");
  const storageForms = ["constructors", "arrayElement", "signature"].filter(key => metadata[key] !== undefined);
  if (storageForms.length > 1) fail(`${label}.metadata`, "has conflicting storage facts");
  if (metadata.arrayElement !== undefined) validateNative(metadata.arrayElement, owners, `${label}.metadata.arrayElement`);
  if (metadata.signature !== undefined) {
    const signature = metadata.signature, at = `${label}.metadata.signature`;
    object(signature, ["args", "result", "effect"], at);
    array(signature.args, `${at}.args`);
    signature.args.forEach((arg, i) => validateNative(arg, [], `${at}.args[${i}]`));
    validateNative(signature.result, [], `${at}.result`);
    requireInterfaceEffect(signature.effect, `${at}.effect`);
  }
  if (metadata.constructors !== undefined) {
    array(metadata.constructors, `${label}.metadata.constructors`);
    if (!metadata.constructors.length) fail(`${label}.metadata.constructors`, "must be non-empty");
    const names = new Set(), scope = [native, ...owners];
    metadata.constructors.forEach((ctor, i) => {
      const at = `${label}.metadata.constructors[${i}]`;
      object(ctor, ["name", "representation", "storage", "fields"], at);
      string(ctor.name, `${at}.name`);
      if (names.has(ctor.name)) fail(`${at}.name`, "duplicates another constructor");
      names.add(ctor.name);
      array(ctor.fields, `${at}.fields`);
      if (ctor.representation === "immediate") {
        if (ctor.fields.length || ctor.storage !== undefined) fail(at, "immediate constructor must have no storage or fields");
      } else if (ctor.representation === "identity") {
        if (metadata.constructors.length !== 1 || ctor.fields.length !== 1 || ctor.storage !== undefined)
          fail(at, "identity constructor requires one constructor and one field without storage");
      } else if (ctor.representation === "object") {
        object(ctor.storage, ["objectFieldCount", "usizeFieldCount", "scalarByteSize"], `${at}.storage`);
        for (const key of ["objectFieldCount", "usizeFieldCount", "scalarByteSize"]) uint(ctor.storage[key], `${at}.storage.${key}`);
      } else fail(`${at}.representation`, "is not supported");
      const fieldNames = new Set(), objects = new Set(), usizes = new Set(), scalars = [];
      ctor.fields.forEach((field, j) => {
        const fieldLabel = `${at}.fields[${j}]`;
        object(field, ctor.representation === "identity" ? ["name", "type"] : ["name", "type", "location"], fieldLabel);
        string(field.name, `${fieldLabel}.name`);
        if (fieldNames.has(field.name)) fail(`${fieldLabel}.name`, "duplicates another field");
        fieldNames.add(field.name);
        validateNative(field.type, scope, `${fieldLabel}.type`);
        if (ctor.representation === "object") validateLocation(field, ctor.storage, objects, usizes, scalars, fieldLabel);
      });
      if (ctor.representation === "object" && (objects.size !== ctor.storage.objectFieldCount || usizes.size !== ctor.storage.usizeFieldCount))
        fail(at, "fields must cover every object and usize slot");
    });
  }
}

function validateLocation(field, storage, objects, usizes, scalars, label) {
  const at = field.location, native = field.type;
  object(at, ["tag", "index", "offset", "size"], `${label}.location`);
  if (at.tag === "object" || at.tag === "usize") {
    uint(at.index, `${label}.location.index`);
    if (at.offset !== undefined || at.size !== undefined) fail(`${label}.location`, "has unexpected scalar facts");
    const seen = at.tag === "object" ? objects : usizes;
    const count = at.tag === "object" ? storage.objectFieldCount : storage.usizeFieldCount;
    if (at.index >= count || seen.has(at.index)) fail(`${label}.location.index`, "is out of range or duplicates a slot");
    if (at.tag === "usize" && (native.type?.tag !== "unsigned" || native.type.width !== "usize"))
      fail(`${label}.type`, "must be USize for usize storage");
    seen.add(at.index);
  } else if (at.tag === "scalar") {
    uint(at.offset, `${label}.location.offset`); uint(at.size, `${label}.location.size`);
    if (at.index !== undefined || ![1, 2, 4, 8].includes(at.size) || at.offset + at.size > storage.scalarByteSize)
      fail(`${label}.location`, "has unsupported scalar layout");
    const type = native.type;
    const immediate = native.metadata?.constructors?.every(ctor => ctor.representation === "immediate");
    if (!immediate && !((type?.tag === "unsigned" || type?.tag === "float") && type.width === at.size * 8))
      fail(`${label}.type`, "does not support this scalar layout");
    if (scalars.some(([start, end]) => at.offset < end && start < at.offset + at.size)) fail(`${label}.location`, "overlaps scalar storage");
    scalars.push([at.offset, at.offset + at.size]);
  } else fail(`${label}.location.tag`, "is not supported");
}

function validateView(native, view, owners, label) {
  if (!record(view)) fail(label, "must be an object");
  if (Object.hasOwn(native, "ref")) {
    object(view, ["tag"], label);
    if (view.tag !== "recursive") fail(`${label}.tag`, "must be recursive for a metadata reference");
    return;
  }
  const tag = native.type.tag, metadata = native.metadata;
  const requireTag = accepted => { if (!accepted.includes(view.tag)) fail(`${label}.tag`, `is incompatible with ${tag}`); };
  if (primitiveTags.has(tag)) {
    object(view, ["tag"], label);
    if (tag === "nat" || tag === "int") requireTag(["bigint", "safeInteger"]);
    else if (tag === "unsigned") requireTag(native.type.width === 64 ? ["bigint"] : ["number"]);
    else requireTag([{ string: "string", byteArray: "bytes", float: "number" }[tag]]);
    return;
  }
  if (tag === "resource") { object(view, ["tag"], label); requireTag(["jsReference"]); return; }
  const constructors = metadata?.constructors, scope = [native, ...owners];
  switch (view.tag) {
    case "leanReference": object(view, ["tag"], label); return;
    case "expr":
      object(view, ["tag"], label);
      if (metadata?.declaration !== "Lean.Expr") fail(label, "requires Lean.Expr metadata");
      return;
    case "function": {
      object(view, ["tag", "args", "result"], label);
      const signature = metadata?.signature;
      if (signature === undefined) fail(label, "requires callable signature metadata");
      array(view.args, `${label}.args`);
      if (view.args.length !== signature.args.length) fail(`${label}.args`, "must cover every callable argument");
      view.args.forEach((arg, i) => validateView(signature.args[i], arg, [], `${label}.args[${i}]`));
      validateView(signature.result, view.result, [], `${label}.result`);
      return;
    }
    case "sequence": {
      object(view, ["tag", "element", "chain"], label);
      if (view.chain === undefined) {
        if (metadata?.arrayElement === undefined) fail(label, "requires native-array metadata");
        validateView(metadata.arrayElement, view.element, owners, `${label}.element`);
      } else {
        object(view.chain, ["nil", "cons", "head", "tail"], `${label}.chain`);
        for (const key of ["nil", "cons", "head", "tail"]) uint(view.chain[key], `${label}.chain.${key}`);
        const { nil, cons, head, tail } = view.chain;
        const empty = constructors?.[nil], cell = constructors?.[cons];
        if (constructors?.length !== 2 || nil === cons || empty?.representation !== "immediate" || cell?.representation !== "object" ||
          cell.fields.length !== 2 || head === tail || !cell.fields[head] || cell.fields[tail]?.type.ref !== 0 ||
          cell.storage.objectFieldCount !== 2 || cell.storage.usizeFieldCount || cell.storage.scalarByteSize ||
          !cell.fields.every(field => field.location.tag === "object")) fail(`${label}.chain`, "does not describe a supported linked sequence");
        validateView(cell.fields[head].type, view.element, scope, `${label}.element`);
      }
      return;
    }
    case "unit": case "boolean": case "enum": {
      object(view, view.tag === "boolean" ? ["tag", "false", "true"] : view.tag === "enum" ? ["tag", "cases"] : ["tag"], label);
      if (constructors === undefined || !constructors.every(ctor => ctor.representation === "immediate")) fail(label, "requires immediate constructor metadata");
      if (view.tag === "unit" && constructors.length !== 1) fail(label, "requires one constructor");
      if (view.tag === "boolean" && (constructors.length !== 2 || ![0, 1].includes(view.false) || view.true !== 1 - view.false)) fail(label, "has invalid boolean constructor mappings");
      if (view.tag === "enum") {
        array(view.cases, `${label}.cases`);
        if (view.cases.length !== constructors.length) fail(`${label}.cases`, "must cover every constructor");
        const names = new Set();
        view.cases.forEach((name, i) => { string(name, `${label}.cases[${i}]`); if (names.has(name)) fail(`${label}.cases[${i}]`, "duplicates a spelling"); names.add(name); });
      }
      return;
    }
    case "record": {
      object(view, ["tag", "fields"], label);
      if (constructors?.length !== 1) fail(label, "requires one constructor");
      validateMappings(native, constructors[0].fields, view.fields, scope, label);
      return;
    }
    case "variant": {
      object(view, ["tag", "cases"], label);
      array(view.cases, `${label}.cases`);
      if (constructors === undefined || constructors.length !== view.cases.length) fail(label, "must cover every constructor");
      const names = new Set();
      view.cases.forEach((item, i) => {
        const at = `${label}.cases[${i}]`, fields = constructors[i].fields;
        object(item, ["kind", "payload", "value", "fields"], at);
        string(item.kind, `${at}.kind`);
        if (names.has(item.kind)) fail(`${at}.kind`, "duplicates a spelling"); names.add(item.kind);
        if (item.payload === "none") { if (fields.length || item.value !== undefined || item.fields !== undefined) fail(at, "requires a nullary constructor"); }
        else if (item.payload === "value") {
          if (fields.length !== 1 || item.fields !== undefined) fail(at, "requires one field");
          validateView(fields[0].type, item.value, scope, `${at}.value`);
        } else if (item.payload === "fields") {
          if (item.value !== undefined) fail(at, "has unexpected value mapping");
          validateMappings(native, fields, item.fields, scope, at);
        } else fail(`${at}.payload`, "is not supported");
      });
      return;
    }
    default: fail(`${label}.tag`, "is not supported");
  }
}

function validateMappings(native, fields, mappings, scope, label) {
  array(mappings, `${label}.fields`);
  const keys = new Set(), paths = [];
  for (const [index, mapping] of mappings.entries()) {
    const at = `${label}.fields[${index}]`;
    object(mapping, ["key", "path", "value"], at);
    if (typeof mapping.key !== "string" || keys.has(mapping.key)) fail(`${at}.key`, "must be a unique string"); keys.add(mapping.key);
    array(mapping.path, `${at}.path`);
    if (!mapping.path.length) fail(`${at}.path`, "must be non-empty");
    let targetFields = fields, child, owners = scope;
    mapping.path.forEach((position, depth) => {
      uint(position, `${at}.path[${depth}]`);
      child = targetFields[position]?.type;
      if (child === undefined) fail(`${at}.path`, "has an unknown field");
      if (depth + 1 !== mapping.path.length) {
        const ctors = child.metadata?.constructors;
        if (ctors?.length !== 1) fail(`${at}.path`, "must traverse single-constructor objects");
        targetFields = ctors[0].fields; owners = [child, ...owners];
      }
    });
    validateView(child, mapping.value, owners, `${at}.value`);
    paths.push(mapping.path);
  }
  function coverage(current, selected) {
    for (let i = 0; i < current.length; i++) {
      const group = selected.filter(path => path[0] === i).map(path => path.slice(1));
      if (!group.length) fail(label, "must cover every native field");
      if (group.some(path => !path.length)) {
        if (group.length !== 1) fail(label, "has overlapping field paths");
      } else coverage(current[i].type.metadata.constructors[0].fields, group);
    }
  }
  coverage(fields, paths);
}

// Canonical key ignores property insertion order. All admitted descriptor facts
// and mappings participate; parameter display names are outside the pair.
export function boundaryInterfaceShape(value) {
  if (Array.isArray(value)) return value.map(boundaryInterfaceShape);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, boundaryInterfaceShape(value[key])]));
  return value;
}

export function formatBoundaryInterface({ native, value }) {
  if (native.ref !== undefined) return `Recursive<${native.ref}>`;
  const metadata = native.metadata;
  if (value.tag === "function") return `(${metadata.signature.args.map((arg, i) => formatBoundaryInterface({ native: arg, value: value.args[i] })).join(", ")}) -> ${formatInterfaceEffectPrefix(metadata.signature.effect)}${formatBoundaryInterface({ native: metadata.signature.result, value: value.result })}`;
  if (metadata?.arrayElement && value.tag === "sequence")
    return `Array<${formatBoundaryInterface({ native: metadata.arrayElement, value: value.element })}>`;
  if (metadata?.declaration) return metadata.declaration;
  const type = native.type;
  return type.tag === "unsigned" ? (type.width === "usize" ? "USize" : `UInt${type.width}`)
    : type.tag === "float" ? (type.width === 32 ? "Float32" : "Float")
    : ({ nat: "Nat", int: "Int", string: "String", byteArray: "ByteArray", leanObject: "LeanObject", resource: "Resource" }[type.tag]);
}
