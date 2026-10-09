/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { INTERFACE_TAG as T } from "../../web/src/runtime/interface-tags.js";
import { objectLayoutPlan } from "../../web/src/runtime/object-abi.js";
import { trivialStructureField } from "../../web/src/runtime/object-boundary.js";
import { compileNativeValueInterface } from "./native-value-interface-prototype.mjs";

// Temporary experiment input: preserve the real producer's compiled layouts,
// while expressing its default JS shapes using the draft pair grammar. This
// runs once at binding, outside value conversion. It is not a manifest reader
// or a second supported producer. The actual producer migration remains open.
export function snapshotNativeValueInterface(type, owners = [], nativeOwners = []) {
  const leaf = (tag, value, extra = {}) => ({ native: { type: { tag, ...extra } }, value: { tag: value } });
  switch (type.interfaceTag) {
    case T.NAT: return leaf("nat", "bigint");
    case T.INT: return leaf("int", "bigint");
    case T.STRING: return leaf("string", "string");
    case T.BYTE_ARRAY: return leaf("byteArray", "bytes");
    case T.RESOURCE: return { native: { type: { tag: "resource" }, metadata: { declaration: type.name } }, value: { tag: "jsReference" } };
    case T.UINT8: return leaf("unsigned", "number", { width: 8 });
    case T.UINT16: return leaf("unsigned", "number", { width: 16 });
    case T.UINT32: return leaf("unsigned", "number", { width: 32 });
    case T.UINT64: return leaf("unsigned", "bigint", { width: 64 });
    case T.USIZE: return leaf("unsigned", "number", { width: "usize" });
    case T.FLOAT: return leaf("float", "number", { width: 64 });
    case T.FLOAT32: return leaf("float", "number", { width: 32 });
    case T.RECURSIVE_REF: {
      const owner = owners[type.depth], depth = nativeOwners.indexOf(owner);
      if (owner === undefined || depth < 0) throw new Error("snapshot has unbound recursion");
      return { native: { ref: depth }, value: { tag: "recursive" } };
    }
    case T.ARRAY: {
      const child = snapshotNativeValueInterface(type.element, owners, nativeOwners);
      return { native: { type: { tag: "leanObject" }, metadata: { arrayElement: child.native } },
        value: { tag: "sequence", element: child.value } };
    }
    case T.UNIT:
      return { native: immediate("Unit", ["Unit.unit"]), value: { tag: "unit" } };
    case T.BOOL:
      return { native: immediate("Bool", ["Bool.false", "Bool.true"]),
        value: { tag: "boolean", false: 0, true: 1 } };
    case T.SIMPLE_ENUM:
      return { native: immediate(type.name, type.constructors.map(ctor => ctor.name)),
        value: { tag: "enum", cases: type.constructors.map(ctor => ctor.jsName) } };
    case T.STRUCTURE:
    case T.CUSTOM_INDUCTIVE:
    case T.TAGGED_UNION: {
      // Every native constructor table binds recursion. The old tagged-union
      // descriptor was transparent; references crossing it gain one depth.
      const oldScope = type.interfaceTag === T.TAGGED_UNION ? owners : [type, ...owners];
      const scope = [type, ...nativeOwners];
      const convert = child => snapshotNativeValueInterface(child, oldScope, scope);
      if (type.interfaceTag === T.STRUCTURE) {
        if (type.fields.some(field => field.subobject)) throw new Error("snapshot does not flatten inheritance");
        const trivial = trivialStructureField(type, type.fields);
        const item = trivial === null ? stored(type, convert) : {
          native: { name: `${type.name}.mk`, representation: "identity",
            fields: [{ name: trivial.name, type: convert(trivial.type).native }] },
          views: [{ key: trivial.name, path: [0], value: convert(trivial.type).value }],
        };
        return { native: { type: { tag: "leanObject" }, metadata: { declaration: type.name, constructors: [item.native] } },
          value: { tag: "record", fields: item.views } };
      }
      const items = type.constructors.map(ctor => {
        if (type.interfaceTag === T.CUSTOM_INDUCTIVE && ctor.fields.length === 0)
          return { native: { name: ctor.name, representation: "immediate", fields: [] }, views: [] };
        return stored(ctor, convert);
      });
      const native = { type: { tag: "leanObject" }, metadata: { declaration: type.name, constructors: items.map(item => item.native) } };
      // Default recipe selection is deliberately outside the conversion kernel.
      // The kernel uses these logical positions, never a Lean declaration name.
      if (type.interfaceTag === T.CUSTOM_INDUCTIVE && type.name === "List") {
        return { native, value: { tag: "sequence", chain: { nil: 0, cons: 1, head: 0, tail: 1 },
          element: items[1].views[0].value } };
      }
      return { native, value: { tag: "variant", cases: items.map((item, index) => {
        const kind = type.constructors[index].jsName;
        return item.views.length === 0 ? { kind, payload: "none" }
          : item.views.length === 1 ? { kind, payload: "value", value: item.views[0].value }
          : { kind, payload: "fields", fields: item.views };
      }) } };
    }
    default: throw new Error(`snapshot does not support interface tag ${type.interfaceTag}`);
  }
}

function immediate(name, constructors) {
  return { type: { tag: "leanObject" }, metadata: { declaration: name,
    constructors: constructors.map(name => ({ name, representation: "immediate", fields: [] })) } };
}
function stored(owner, convert) {
  const plan = objectLayoutPlan(owner, "benchmark snapshot");
  const children = plan.fields.map(field => convert(field.field.type));
  return {
    native: { name: owner.name, representation: "object",
      storage: { objectFieldCount: plan.objectFieldCount, usizeFieldCount: plan.usizeFieldCount,
        scalarByteSize: plan.scalarByteSize },
      fields: plan.fields.map((field, index) => ({ name: field.field.name,
        type: children[index].native, location: field.kind === "scalar"
          ? { tag: "scalar", offset: field.offset, size: field.field.layout.size }
          : { tag: field.kind, index: field.index } })),
    },
    views: plan.fields.map((field, index) => ({ key: field.field.name, path: [index], value: children[index].value })),
  };
}

// Preserve the normal call path, including entry lookup, argument ownership,
// native dispatch, result release, runtime health and disposal. Only its cached
// value-codec binding is replaced for this experiment, before any timed call.
export function installNativeValueInterfacePrototype(runtime) {
  const cache = new WeakMap();
  let bindings = 0;
  runtime.nativeValueCodec = type => {
    let codec = cache.get(type);
    if (codec === undefined) {
      const pair = snapshotNativeValueInterface(type);
      codec = compileNativeValueInterface(runtime, pair.native, pair.value);
      cache.set(type, codec); bindings++;
    }
    return codec;
  };
  return { get bindings() { return bindings; } };
}
