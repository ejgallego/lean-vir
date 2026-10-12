/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Support predicates consume admitted pairs. They describe the selected codec,
// not a parallel descriptor schema or a core type taxonomy.
export function objectArgumentSupported(pair) { return supported(pair.native, pair.value, false, []); }
export function objectResultSupported(pair) { return supported(pair.native, pair.value, true, []); }

function supported(native, view, result, owners) {
  if (native.ref !== undefined) return native.ref < owners.length;
  if (native.type.tag !== "leanObject") return true;
  if (view.tag === "function") return result;
  if (["unit", "boolean", "enum", "expr", "leanReference"].includes(view.tag)) return true;
  const constructors = native.metadata?.constructors, scope = [native, ...owners];
  if (view.tag === "sequence") {
    const child = view.chain === undefined ? native.metadata.arrayElement
      : constructors[view.chain.cons].fields[view.chain.head].type;
    return supported(child, view.element, result, view.chain === undefined ? owners : scope);
  }
  function fieldSupported(field, value, bindings) {
    const location = field.location;
    if (location?.tag === "usize") {
      if (!packedSupported(field.type, value, true)) return false;
    } else if (location?.tag === "scalar") {
      if (!packedSupported(field.type, value, false)) return false;
    }
    return supported(field.type, value, result, bindings);
  }
  function mappings(fields, entries) {
    return entries.every(entry => {
      let field, current = fields, bindings = scope;
      for (const [depth, index] of entry.path.entries()) {
        field = current[index];
        if (depth + 1 !== entry.path.length) {
          if (field.location && field.location.tag !== "object") return false;
          current = field.type.metadata.constructors[0].fields; bindings = [field.type, ...bindings];
        }
      }
      return fieldSupported(field, entry.value, bindings);
    });
  }
  if (view.tag === "record") return mappings(constructors[0].fields, view.fields);
  if (view.tag === "variant") return view.cases.every((entry, i) => {
    const fields = constructors[i].fields;
    return entry.payload === "none" || (entry.payload === "value"
      ? fieldSupported(fields[0], entry.value, scope) : mappings(fields, entry.fields));
  });
  return false;
}

function packedSupported(native, view, usize) {
  const tag = native.type?.tag;
  if (tag === "unsigned") return !usize || native.type.width === "usize";
  if (!usize && (tag === "float" || ["unit", "boolean", "enum"].includes(view.tag))) return true;
  const constructors = native.metadata?.constructors;
  if (constructors?.length !== 1 || constructors[0].representation !== "identity") return false;
  const field = constructors[0].fields[0];
  let mappings;
  if (view.tag === "record") mappings = view.fields;
  else if (view.tag === "variant" && view.cases.length === 1) {
    const entry = view.cases[0];
    if (entry.payload === "value") return packedSupported(field.type, entry.value, usize);
    if (entry.payload !== "fields") return false;
    mappings = entry.fields;
  } else return false;
  const value = mappings.length === 1 && mappings[0].path.length === 1 ? mappings[0].value
    : { tag: "record", fields: mappings.map(mapping => ({ ...mapping, path: mapping.path.slice(1) })) };
  return packedSupported(field.type, value, usize);
}
