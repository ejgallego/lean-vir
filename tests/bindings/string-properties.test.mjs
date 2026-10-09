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

test("String.length retains the pinned TypeScript numeric property contract", async () => {
  assert.equal(typeScriptDiagnostics("export const length = (s: string): number => s.length;").length, 0);
  assert.ok(typeScriptDiagnostics("export const length = (s: string): string => s.length;").length > 0);
  const config = JSON.parse(await readFile(new URL("../../Vir/Js.bindings.json", import.meta.url), "utf8"));
  const operation = config.generation.protocolOperations.find(op => op.target === "js.string.length");
  assert.equal(operation.arguments[0].type.lean, "Lean.Vir.Js String");
  assert.equal(operation.result.type.lean, "Lean.Vir.Js Float");
  assert.equal(operation.upstreamRelation.member, "String.length");
  const generated = await readFile(new URL("../../Vir/Js/Generated.lean", import.meta.url), "utf8");
  assert.match(generated, /opaque length\s+\(value : @& Lean\.Vir\.Js String\) :\s+RuntimeM \(Lean\.Vir\.Js Float\)/u);
});

test("String.length reads native UTF-16 length without coercion or repeated access", () => {
  const length = createJsValueHostBindings()["js.string.length"];
  for (const [text, expected] of [["", 0], ["abc", 3], ["😀", 2], ["e\u0301", 2]]) {
    assert.equal(length(text), expected);
  }
  const failure = new Error("length getter");
  let reads = 0;
  assert.throws(() => length({ get length() { reads++; throw failure; } }), error => error === failure);
  assert.equal(reads, 1);
});
