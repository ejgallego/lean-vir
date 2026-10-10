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
  function mappings(fields, entries) {
    return entries.every(entry => {
      let child, current = fields, bindings = scope;
      entry.path.forEach((index, depth) => {
        child = current[index].type;
        if (depth + 1 !== entry.path.length) {
          current = child.metadata.constructors[0].fields; bindings = [child, ...bindings];
        }
      });
      return supported(child, entry.value, result, bindings);
    });
  }
  if (view.tag === "record") return mappings(constructors[0].fields, view.fields);
  if (view.tag === "variant") return view.cases.every((entry, i) => {
    const fields = constructors[i].fields;
    return entry.payload === "none" || (entry.payload === "value"
      ? supported(fields[0].type, entry.value, result, scope) : mappings(fields, entry.fields));
  });
  return false;
}
