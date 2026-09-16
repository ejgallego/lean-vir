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

test("Nat.add retains bigint precision and native mixed-kind failures", () => {
  const add = createJsValueHostBindings()["js.nat.add"];
  const large = 2n ** 256n + 123n;

  assert.equal(add(0n, large), large);
  assert.equal(add(2n ** 53n + 1n, 2n ** 53n + 3n), 2n ** 54n + 4n);
  assert.throws(() => add(1n, 1), TypeError);
  assert.throws(() => add(1, 1n), TypeError);
});

test("Nat.add records the bounded VIR-owned bigint operator contract", async () => {
  assert.equal(typeScriptDiagnostics("export const add = (left: bigint, right: bigint): bigint => left + right;").length, 0);
  assert.ok(typeScriptDiagnostics("export const add = (left: bigint, right: number): bigint => left + right;").length > 0);

  const config = JSON.parse(await readFile(new URL("../../Vir/Js.bindings.json", import.meta.url), "utf8"));
  const operation = config.generation.protocolOperations.find(op => op.target === "js.nat.add");

  assert.deepEqual(operation, {
    id: "javascript.nat.add",
    group: "numeric-operations",
    target: "js.nat.add",
    lean: "Lean.Vir.Js.Nat.add",
    marker: "vir_js",
    reason: "VIR-owned native JavaScript bigint + operator for nonnegative bigint resources. TypeScript does not declare operators; addition closes the Nat subset without decoding, coercion, or checks.",
    upstreamRelation: { kind: "vir-owned" },
    effect: { id: "runtime", lean: "RuntimeM" },
    arguments: [
      { name: "left", type: { lean: "Js Nat", representation: "js-resource", resourceInner: "Nat" } },
      { name: "right", type: { lean: "Js Nat", representation: "js-resource", resourceInner: "Nat" } },
    ],
    result: { type: { lean: "Js Nat", representation: "js-resource", resourceInner: "Nat" } },
  });
  assert.deepEqual(config.roots.find(root => root.id === "numeric-operations"), {
    id: "numeric-operations",
    title: "Native numeric operations",
    targets: ["js.nat.add"],
    lean: { public: ["Lean.Vir.Js.Nat"] },
    upstream: { kind: "internal" },
  });
});
