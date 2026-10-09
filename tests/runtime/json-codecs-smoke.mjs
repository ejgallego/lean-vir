/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { createPrimitiveRuntimeFactory } from "../../web/src/runtime/primitive-factory.js";
import { createCommonHostBindings } from "../../web/src/host/vir-common-host-bindings.js";
import { generateIrPackage } from "./shared.mjs";

const huge = 900719925474099312345678901234567890n;
const cases = [
  {
    wire: {
      amount: "0",
      nested: { kind: "none" },
      marker: { kind: "none" },
      label: "plain",
    },
    amount: 0n,
    nestedKind: 0n,
    nestedAmount: 0n,
    markerPresent: false,
  },
  {
    wire: {
      amount: "900719925474099312345678901234567890",
      nested: { kind: "some", value: { kind: "none" } },
      marker: { kind: "some", value: null },
      label: "α雪",
    },
    amount: huge,
    nestedKind: 1n,
    nestedAmount: 0n,
    markerPresent: true,
  },
  {
    wire: {
      amount: "900719925474099312345678901234567892",
      nested: {
        kind: "some",
        value: { kind: "some", value: "900719925474099312345678901234567891" },
      },
      marker: { kind: "none" },
      label: "nested",
    },
    amount: huge + 2n,
    nestedKind: 2n,
    nestedAmount: huge + 1n,
    markerPresent: false,
  },
];

const directory = await mkdtemp(join(tmpdir(), "vir-json-codecs-"));
try {
  const packagePath = join(directory, "codec.irpkg");
  await generateIrPackage(
    "JsonCodecs",
    new URL("../../fixtures/runtime/JsonCodecs.lean", import.meta.url),
    packagePath,
    "marked",
  );
  const packageBytes = await readFile(packagePath);
  const sourceWasm = new URL("../../web/public/", import.meta.url);
  const factories = [
    ["public source", createVirRuntimeFactory, sourceWasm],
    [
      "managed core",
      (options) =>
        createPrimitiveRuntimeFactory({
          ...options,
          defaultHostBindings: createCommonHostBindings,
        }),
      sourceWasm,
    ],
  ];
  if (process.env.VIR_JSON_CODECS_SDK) {
    const sdk = pathToFileURL(`${process.env.VIR_JSON_CODECS_SDK}/`);
    const { createVirRuntimeFactory: sdkFactory } = await import(
      new URL("js/vir-runtime-node.js", sdk)
    );
    factories.push(["extracted SDK", sdkFactory, new URL("wasm/", sdk)]);
  }

  function observe(call, value, expected) {
    assert.equal(call("amount", value), expected.amount);
    assert.equal(call("nestedKind", value), expected.nestedKind);
    assert.equal(call("nestedAmount", value), expected.nestedAmount);
    assert.equal(call("markerPresent", value), expected.markerPresent);
    assert.equal(call("label", value), expected.wire.label);
  }

  for (const [composition, createFactory, wasmDirectory] of factories) {
    for (const profile of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
      const wasmBytes = await readFile(new URL(profile, wasmDirectory));
      const runtime = await createFactory({ wasmBytes }).createRuntime({
        irPackageSet: [packageBytes],
      });
      const host = runtime.hostState;
      const retained = [];
      let original;
      const call = (name, ...args) =>
        runtime.call(`JsonCodecs.${name}`, ...args);
      try {
        // Admission contains only primitive and opaque boundaries. The model itself
        // is never interpreted by the optional automatic object converter.
        for (const entry of runtime.interfaceManifest.exports) {
          for (const type of [
            ...entry.args.map((arg) => arg.type),
            entry.result,
          ]) {
            assert.ok(
              ["Nat", "Bool", "String", "Js"].includes(type.type),
              `unexpected structural boundary ${type.type}`,
            );
          }
        }
        for (const [index, expected] of cases.entries()) {
          const parsed = call("fromJsonText", JSON.stringify(expected.wire));
          retained.push(parsed);
          if (index === 1) original = parsed;
          observe(call, parsed, expected);
          const encoded = call("toJsonText", parsed);
          assert.deepEqual(JSON.parse(encoded), expected.wire);
          const roundTrip = call("fromJsonText", encoded);
          retained.push(roundTrip);
          observe(call, roundTrip, expected);
          assert.equal(call("toJsonText", roundTrip), encoded);

          const compiled = call("sample", BigInt(index));
          retained.push(compiled);
          observe(call, compiled, expected);
          assert.deepEqual(
            JSON.parse(call("toJsonText", compiled)),
            expected.wire,
          );
        }

        const branch = call("advance", original, 7n);
        retained.push(branch);
        observe(call, original, cases[1]);
        observe(call, branch, { ...cases[1], amount: huge + 7n });
        assert.deepEqual(JSON.parse(call("toJsonText", branch)), {
          ...cases[1].wire,
          amount: "900719925474099312345678901234567897",
        });

        const invalid = [
          ["{", /./],
          ["{}", /./],
          [JSON.stringify({ ...cases[0].wire, amount: 1 }), /String expected/],
          [JSON.stringify({ ...cases[0].wire, amount: "-1" }), /decimal Nat/],
          [
            JSON.stringify({ ...cases[0].wire, amount: "01" }),
            /canonical decimal Nat/,
          ],
          [
            JSON.stringify({ ...cases[0].wire, nested: { kind: "other" } }),
            /unknown Option/,
          ],
          [JSON.stringify({ ...cases[0].wire, nested: { kind: "some" } }), /./],
          [
            JSON.stringify({
              ...cases[0].wire,
              marker: { kind: "some", value: {} },
            }),
            /null for Unit/,
          ],
        ];
        const live = host.leanObjectHandleCells.size;
        for (let repeat = 0; repeat < 3; repeat++) {
          for (const [text, pattern] of invalid) {
            assert.throws(() => call("fromJsonText", text), pattern);
            assert.equal(runtime.failure, null);
            assert.equal(host.leanObjectHandleCells.size, live);
            observe(call, original, cases[1]);
          }
        }
        const afterFailure = call(
          "fromJsonText",
          JSON.stringify(cases[2].wire),
        );
        retained.push(afterFailure);
        observe(call, afterFailure, cases[2]);

        assert.equal(call("standardNestedNone"), "null");
        assert.equal(call("standardNestedSomeNone"), "null");
        assert.equal(call("standardUnitNone"), "null");
        assert.equal(call("standardUnitSome"), "{}");
        const standardNat = call("standardLargeNat");
        assert.equal(standardNat, "900719925474099312345678901234567890");
        assert.equal(call("standardDecodeNat", standardNat), huge);
        assert.notEqual(BigInt(JSON.parse(standardNat)), huge);
        for (const [text, expected] of [
          ["0", 0n],
          [standardNat, huge],
        ]) {
          const scalar = call("standardFromJsonText", text);
          retained.push(scalar);
          assert.equal(call("standardValue", scalar), expected);
          assert.equal(call("standardToJsonText", scalar), text);
        }
        assert.equal(host.leanObjectHandleCells.size, retained.length);
        assert.equal(runtime.exports.vir_resource_roots_active(), 0);
        assert.equal(runtime.failure, null);
      } finally {
        runtime.dispose();
      }
      assert.equal(host.leanObjectHandleCells.size, 0);
      assert.throws(
        () => call("amount", retained[0]),
        /disposed|fresh runtime/,
      );
      console.log(
        `${composition}, ${profile}: lossless model, Lean operations, failures/reuse and disposal PASS`,
      );
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
