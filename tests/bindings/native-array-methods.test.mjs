/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { typeScriptDiagnostics } from "../support/typescript-probe.mjs";
import { loadBindingConfig } from "../../scripts/bindings/binding-config.mjs";
import { createJsCollectionHostBindings } from "../../web/src/host/vir-js-collection-bindings.js";

const bindings = createJsCollectionHostBindings();
const config = await loadBindingConfig(new URL("../../Vir/Js.bindings.json", import.meta.url).pathname);
const operation = (target) => config.generation.protocolOperations.find((entry) => entry.target === target);

test("native array providers preserve callback values, indexes, source and truthiness", () => {
  const array = ["zero", "one", "two"];
  const calls = [];
  const predicate = function (value, index, source) {
    calls.push([arguments.length, value, index, source, this]);
    return index === 1 ? "truthy" : 0;
  };

  assert.deepEqual(bindings["js.array.filter"](array, predicate), ["one"]);
  assert.equal(bindings["js.array.find"](array, predicate), "one");
  assert.equal(bindings["js.array.some"](array, predicate), true);
  assert.equal(bindings["js.array.every"](array, predicate), false);
  assert.deepEqual(calls, [
    [3, "zero", 0, array, undefined], [3, "one", 1, array, undefined], [3, "two", 2, array, undefined],
    [3, "zero", 0, array, undefined], [3, "one", 1, array, undefined],
    [3, "zero", 0, array, undefined], [3, "one", 1, array, undefined],
    [3, "zero", 0, array, undefined],
  ]);
});

test("native array providers retain native holes, mutations, short-circuiting and errors", () => {
  const sparse = [, "present"];
  const filterVisits = [];
  assert.deepEqual(bindings["js.array.filter"](sparse, (value, index) => {
    filterVisits.push([value, index]);
    return true;
  }), ["present"]);
  assert.deepEqual(filterVisits, [["present", 1]], "filter skips sparse holes");

  const findVisits = [];
  assert.equal(bindings["js.array.find"](sparse, (value, index) => {
    findVisits.push([value, index]);
    return false;
  }), undefined);
  assert.deepEqual(findVisits, [[undefined, 0], ["present", 1]], "find visits sparse holes");

  const mutable = [0, 1, 2];
  assert.deepEqual(bindings["js.array.filter"](mutable, (value, index, source) => {
    if (index === 0) {
      source.push(3);
      delete source[2];
    }
    return true;
  }), [0, 1], "the native initial bound and deleted slot behavior remain intact");

  const shortCircuit = [];
  assert.equal(bindings["js.array.some"]([0, 1, 2], (value) => {
    shortCircuit.push(value);
    return value;
  }), true);
  assert.deepEqual(shortCircuit, [0, 1]);
  const error = new Error("exact callback error");
  assert.throws(() => bindings["js.array.forEach"]([1], () => { throw error; }), caught => caught === error);
});

test("native array join forwards explicit undefined and native null/hole coercion", () => {
  const array = ["left", null, undefined, , "right"];
  assert.equal(bindings["js.array.join"](array, undefined), "left,,,,right");
  assert.equal(bindings["js.array.join"](array, "|"), "left||||right");
  assert.equal(bindings["js.array.join"](array, null), "leftnullnullnullnullright");
});

test("array method contracts retain generic predicate results, find absence and explicit join separator", () => {
  for (const target of ["js.array.filter", "js.array.find", "js.array.some", "js.array.every"]) {
    const candidate = operation(target);
    assert.deepEqual(candidate.typeParameters, ["α", "β"]);
    assert.match(candidate.arguments[1].type.lean, /Function3 \(Lean\.Vir\.Js α\) \(Lean\.Vir\.Js Float\) \(Lean\.Vir\.Js\.Array α\) \(Lean\.Vir\.Js β\)/u);
    assert.doesNotMatch(candidate.arguments[1].type.lean, /Bool/u);
  }
  assert.equal(operation("js.array.find").result.type.lean, "Lean.Vir.Js.UndefinedOr α");
  assert.equal(operation("js.array.join").arguments[1].type.lean, "Lean.Vir.Js.UndefinedOr String");
  assert.ok(config.roots.find((root) => root.id === "array").upstream.declarations
    .includes("node_modules/typescript/lib/lib.es2015.core.d.ts"), "Array.find provenance includes its ES2015 declaration root");

  const wrappers = `
    export function filter<T, R>(array: T[], predicate: (value: T, index: number, source: T[]) => R): T[] { return array.filter(predicate); }
    export function find<T, R>(array: T[], predicate: (value: T, index: number, source: T[]) => R): T | undefined { return array.find(predicate); }
    export function some<T, R>(array: T[], predicate: (value: T, index: number, source: T[]) => R): boolean { return array.some(predicate); }
    export function every<T, R>(array: T[], predicate: (value: T, index: number, source: T[]) => R): boolean { return array.every(predicate); }
    export function join<T>(array: T[], separator: string | undefined): string { return array.join(separator); }
  `;
  assert.deepEqual(typeScriptDiagnostics(wrappers), [], "the selected TypeScript overloads accept generic truthy results without type-guard narrowing");
});
