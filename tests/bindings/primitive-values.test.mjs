/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { typeScriptDiagnostics } from "../support/typescript-probe.mjs";
import { createJsValueHostBindings } from "../../web/src/host/vir-js-value-bindings.js";

const bindings = createJsValueHostBindings();

test("string bindings preserve native UTF-16 operations and default positions", () => {
  const loneHigh = "\ud800";
  const loneLow = "\udc00";

  assert.equal(bindings["js.string.equal"](loneHigh, loneHigh), true);
  assert.equal(bindings["js.string.equal"](loneHigh, loneLow), false);
  assert.equal(bindings["js.string.concat"](loneHigh, loneLow), loneHigh + loneLow);
  assert.equal(bindings["js.string.slice"](`a${loneHigh}b`, 1, 2), loneHigh);
  assert.equal(bindings["js.string.slice"]("abcd", 1.9, undefined), "bcd");
  assert.equal(bindings["js.string.includes"]("abc", "a"), true);
  assert.equal(bindings["js.string.startsWith"]("abc", "a"), true);
  assert.equal(bindings["js.string.endsWith"]("abc", "c"), true);
  assert.equal(bindings["js.string.trim"]("\u00a0 x \u00a0"), "x");
  assert.equal(bindings["js.string.toLowerCase"]("İ"), "i\u0307");
  assert.equal(bindings["js.string.toUpperCase"]("ß"), "SS");
});

test("primitive bindings retain native IEEE-754 and bigint behavior", () => {
  assert.equal(bindings["js.number.add"](1, 2), 3);
  assert.equal(bindings["js.number.sub"](1, 2), -1);
  assert.equal(bindings["js.number.mul"](3, 2), 6);
  assert.equal(bindings["js.number.div"](1, 0), Infinity);
  assert.ok(Number.isNaN(bindings["js.number.rem"](0, 0)));
  assert.ok(Object.is(bindings["js.number.neg"](0), -0));
  assert.equal(bindings["js.number.equal"](NaN, NaN), false);
  assert.equal(bindings["js.number.equal"](-0, 0), true);
  assert.equal(bindings["js.number.lt"](NaN, 1), false);
  assert.equal(bindings["js.number.le"](1, Infinity), true);
  assert.equal(bindings["js.number.isNaN"](NaN), true);
  assert.equal(bindings["js.number.isFinite"](Infinity), false);
  assert.equal(bindings["js.number.isInteger"](3.5), false);

  const huge = 2n ** 512n + 17n;
  assert.equal(bindings["js.nat.mul"](huge, huge), huge * huge);
  assert.equal(bindings["js.nat.equal"](huge, huge), true);
  assert.equal(bindings["js.nat.lt"](0n, huge), true);
  assert.equal(bindings["js.nat.le"](huge, huge), true);
  assert.equal(bindings["js.boolean.not"](false), true);
  assert.equal(bindings["js.boolean.equal"](true, false), false);
});

test("primitive bindings leave native kind errors and receiver exceptions untouched", () => {
  assert.throws(() => bindings["js.number.add"](1, 1n), TypeError);
  assert.throws(() => bindings["js.nat.mul"](1n, 1), TypeError);
  assert.equal(bindings["js.string.concat"]("x", 1), "x1");

  const exception = new Error("native receiver error");
  assert.throws(
    () => bindings["js.string.trim"]({ trim() { throw exception; } }),
    error => error === exception,
  );
});

test("primitive operation metadata distinguishes native methods from VIR-owned operators", async () => {
  assert.equal(typeScriptDiagnostics("export const slice = (value: string, start: number, end: number | undefined) => value.slice(start, end);").length, 0);
  assert.equal(typeScriptDiagnostics("export const includes = (value: string, search: string) => value.includes(search);").length, 0);
  assert.equal(typeScriptDiagnostics("export const isInteger = (value: number) => Number.isInteger(value);").length, 0);
  assert.equal(typeScriptDiagnostics("export const mul = (left: bigint, right: bigint): bigint => left * right;").length, 0);
  assert.ok(typeScriptDiagnostics("export const mixed = (left: bigint, right: number): bigint => left * right;").length > 0);

  const config = JSON.parse(await readFile(new URL("../../Vir/Js.bindings.json", import.meta.url), "utf8"));
  const operations = new Map(config.generation.protocolOperations.map(operation => [operation.target, operation]));
  assert.equal(operations.get("js.string.slice").arguments.length, 3);
  assert.equal(operations.get("js.string.slice").arguments[2].type.lean, "Lean.Vir.Js.UndefinedOr Float");
  assert.deepEqual(operations.get("js.number.isNaN").upstreamRelation, { kind: "upstream-adapter", member: "NumberConstructor.isNaN", semantics: "preserving" });
  assert.deepEqual(operations.get("js.number.add").upstreamRelation, { kind: "vir-owned" });
  assert.deepEqual(operations.get("js.boolean.equal").upstreamRelation, { kind: "vir-owned" });
  assert.ok(config.roots.find(root => root.id === "string").upstream.declarations.includes("node_modules/typescript/lib/lib.es2015.core.d.ts"));
  const numberRoot = config.roots.find(root => root.id === "number").upstream;
  assert.ok(numberRoot.declarations.includes("node_modules/typescript/lib/lib.es2015.core.d.ts"));
  assert.deepEqual(numberRoot.roots, ["Number", "NumberConstructor"]);
});
