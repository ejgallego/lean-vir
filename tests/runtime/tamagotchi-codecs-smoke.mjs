/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { createPrimitiveRuntimeFactory } from "../../web/src/runtime/primitive-factory.js";
import { createCommonHostBindings } from "../../web/src/host/vir-common-host-bindings.js";
import { generateIrPackage } from "./shared.mjs";

const initial = {
  name: "Octi",
  mood: "happy",
  trace: ["happy"],
  artwork: "octopus",
  turns: "0",
  care: "3",
};
const checkpoint = {
  name: "Octi",
  mood: "happy",
  trace: ["happy", "hungry", "happy"],
  artwork: "octopus",
  turns: "2",
  care: "4",
};
const finished = {
  name: "Octi",
  mood: "happy",
  trace: ["happy", "hungry", "happy", "sleepy", "asleep", "happy"],
  artwork: "octopus",
  turns: "5",
  care: "5",
};
const unusual = {
  name: "",
  mood: "happy",
  trace: [],
  artwork: "unknown",
  turns: "900719925474099312345678901234567890",
  care: "900719925474099312345678901234567890",
};
const normalizedByAction = {
  name: "Mochi",
  mood: "hungry",
  trace: ["hungry"],
  artwork: "pet",
  turns: "900719925474099312345678901234567891",
  care: "5",
};

const directory = await mkdtemp(join(tmpdir(), "vir-tamagotchi-codecs-"));
try {
  const packagePath = join(directory, "tamagotchi.irpkg");
  await generateIrPackage(
    "TamagotchiCodecs",
    new URL("../../fixtures/runtime/TamagotchiCodecs.lean", import.meta.url),
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

  const call = (runtime, name, ...args) =>
    runtime.call(`TamagotchiCodecs.${name}`, ...args);
  function observe(runtime, value, expected, turns, care) {
    for (const field of ["name", "mood", "artwork"]) {
      assert.equal(call(runtime, field, value), expected[field]);
    }
    assert.equal(call(runtime, "turns", value), turns);
    assert.equal(call(runtime, "care", value), care);
    assert.equal(
      call(runtime, "traceLength", value),
      BigInt(expected.trace.length),
    );
    expected.trace.forEach((mood, index) => {
      assert.equal(call(runtime, "traceAt", value, BigInt(index)), mood);
    });
    assert.deepEqual(JSON.parse(call(runtime, "toJsonText", value)), expected);
  }

  for (const [composition, createFactory, wasmDirectory] of factories) {
    for (const profile of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
      const factory = createFactory({
        wasmBytes: await readFile(new URL(profile, wasmDirectory)),
      });
      const first = await factory.createRuntime({
        irPackageSet: [packageBytes],
      });
      const firstHost = first.hostState;
      const retained = [];
      const keep = (value) => {
        retained.push(value);
        return value;
      };
      let savedCarrier, uninterrupted;
      const savedPath = join(
        directory,
        `${composition.replaceAll(" ", "-")}-${profile}.json`,
      );
      try {
        assert.deepEqual(
          first.interfaceManifest.hostImports
            .map((entry) => entry.target)
            .sort(),
          ["js.leanRef", "js.leanRef.value"],
        );
        for (const entry of first.interfaceManifest.exports) {
          for (const type of [
            ...entry.args.map((arg) => arg.type),
            entry.result,
          ]) {
            assert.ok(["Nat", "String", "Js"].includes(type.type));
          }
        }
        const original = keep(call(first, "create", "", "octopus"));
        observe(first, original, initial, 0n, 3n);
        const hungry = keep(call(first, "act", original, "ignore"));
        savedCarrier = keep(call(first, "act", hungry, "feed"));
        observe(first, savedCarrier, checkpoint, 2n, 4n);
        // Save ordinary JSON on disk. JavaScript parsing/stringification is permitted
        // by this application's decimal-string snapshot contract.
        const text = call(first, "toJsonText", savedCarrier);
        await writeFile(savedPath, JSON.stringify(JSON.parse(text)));
        let state = savedCarrier;
        for (const action of ["play", "nap", "wake"])
          state = keep(call(first, "act", state, action));
        observe(first, state, finished, 5n, 5n);
        observe(first, savedCarrier, checkpoint, 2n, 4n);
        observe(first, original, initial, 0n, 3n);
        uninterrupted = call(first, "toJsonText", state);
        assert.equal(firstHost.leanObjectHandleCells.size, retained.length);
      } finally {
        first.dispose();
      }
      assert.equal(firstHost.leanObjectHandleCells.size, 0);
      assert.throws(
        () => call(first, "toJsonText", savedCarrier),
        /disposed|fresh runtime/,
      );

      const restored = await factory.createRuntime({
        irPackageSet: [packageBytes],
      });
      const restoredHost = restored.hostState;
      const restoredValues = [];
      const hold = (value) => {
        restoredValues.push(value);
        return value;
      };
      try {
        assert.throws(
          () => call(restored, "toJsonText", savedCarrier),
          /live Lean object handle/,
        );
        assert.equal(restored.failure, null);
        const restoredCheckpoint = hold(
          call(restored, "fromJsonText", await readFile(savedPath, "utf8")),
        );
        observe(restored, restoredCheckpoint, checkpoint, 2n, 4n);
        let state = restoredCheckpoint;
        for (const action of ["play", "nap", "wake"])
          state = hold(call(restored, "act", state, action));
        observe(restored, state, finished, 5n, 5n);
        assert.equal(call(restored, "toJsonText", state), uninterrupted);

        const exact = hold(
          call(restored, "fromJsonText", JSON.stringify(unusual)),
        );
        observe(
          restored,
          exact,
          unusual,
          900719925474099312345678901234567890n,
          900719925474099312345678901234567890n,
        );
        const normalized = hold(call(restored, "act", exact, "ignore"));
        observe(
          restored,
          normalized,
          normalizedByAction,
          900719925474099312345678901234567891n,
          5n,
        );
        observe(
          restored,
          exact,
          unusual,
          900719925474099312345678901234567890n,
          900719925474099312345678901234567890n,
        );

        for (const mood of [
          "happy",
          "hungry",
          "sleepy",
          "angry",
          "asleep",
          "dead",
        ]) {
          const wire = { ...initial, name: "α雪", mood, trace: [mood] };
          const value = hold(
            call(restored, "fromJsonText", JSON.stringify(wire)),
          );
          observe(restored, value, wire, 0n, 3n);
          const text = call(restored, "toJsonText", value);
          const again = hold(call(restored, "fromJsonText", text));
          assert.equal(call(restored, "toJsonText", again), text);
        }

        const invalid = [
          ["{", /./],
          ["{}", /./],
          [JSON.stringify({ ...checkpoint, turns: 2 }), /String expected/],
          [JSON.stringify({ ...checkpoint, care: "-1" }), /decimal Nat/],
          [
            JSON.stringify({ ...checkpoint, turns: "02" }),
            /canonical decimal Nat/,
          ],
          [JSON.stringify({ ...checkpoint, mood: "Happy" }), /unknown mood/],
          [
            JSON.stringify({ ...checkpoint, trace: ["happy", "other"] }),
            /unknown mood/,
          ],
          [JSON.stringify({ ...checkpoint, trace: "happy" }), /array expected/],
        ];
        const live = restoredHost.leanObjectHandleCells.size;
        for (const [text, pattern] of invalid) {
          assert.throws(() => call(restored, "fromJsonText", text), pattern);
          assert.equal(restored.failure, null);
          assert.equal(restoredHost.leanObjectHandleCells.size, live);
          observe(restored, restoredCheckpoint, checkpoint, 2n, 4n);
        }
        assert.throws(
          () => call(restored, "act", restoredCheckpoint, "other"),
          /unknown action/,
        );
        assert.equal(restoredHost.leanObjectHandleCells.size, live);
        assert.equal(restored.failure, null);
        const afterFailure = hold(
          call(restored, "act", restoredCheckpoint, "play"),
        );
        assert.equal(call(restored, "mood", afterFailure), "sleepy");
        assert.equal(call(restored, "turns", afterFailure), 3n);
        assert.equal(
          restoredHost.leanObjectHandleCells.size,
          restoredValues.length,
        );
        assert.equal(restored.exports.vir_resource_roots_active(), 0);
      } finally {
        restored.dispose();
      }
      assert.equal(restoredHost.leanObjectHandleCells.size, 0);
      console.log(
        `${composition}, ${profile}: save/retire/restore/continue, exact fields, errors/reuse and disposal PASS`,
      );
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
