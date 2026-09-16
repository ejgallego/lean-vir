/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { typeScriptDiagnostics } from "../support/typescript-probe.mjs";

test("useState preserves the explicit initial-value/initializer result relationship", async () => {
  const diagnostics = typeScriptDiagnostics(`
    import { useState, type Dispatch, type SetStateAction } from "react";
    function initialValue<S>(value: S): S | (() => S) { return value; }
    function initialFunction<S>(initializer: () => S): S | (() => S) { return initializer; }
    function eager<S>(value: S): [S, Dispatch<SetStateAction<S>>] {
      return useState<S>(initialValue(value));
    }
    function lazy<S>(initializer: () => S): [S, Dispatch<SetStateAction<S>>] {
      return useState<S>(initialFunction(initializer));
    }
    declare const makeText: () => string;
    const [text]: [string, Dispatch<SetStateAction<string>>] = useState(initialFunction(makeText));
    const [fn]: [() => string, Dispatch<SetStateAction<() => string>>] =
      useState<() => string>(initialFunction(() => makeText));
    // Native union membership does not override React's interpretation of functions.
    const allowedByTS = useState<() => string>(initialValue(makeText));
    // @ts-expect-error initializer return determines state shape
    const wrong: [boolean, Dispatch<SetStateAction<boolean>>] = useState(initialFunction(makeText));
  `);
  assert.deepEqual(diagnostics.map(d => d.messageText), []);
  const config = JSON.parse(await readFile(new URL("../../Vir/React.bindings.json", import.meta.url)));
  const operation = config.generation.protocolOperations.find(op => op.target === "react.useState");
  assert.deepEqual(operation.typeParameters, ["α"]);
  assert.equal(operation.arguments[0].type.lean, "Lean.Vir.Js (Lean.Vir.React.Initial.Value α)");
  assert.equal(operation.result.type.lean, "Lean.Vir.Js (Lean.Vir.React.StateTuple α)");
});

test("native function subsets match pinned React effect, reducer and state-action types", () => {
  const diagnostics = typeScriptDiagnostics(`
    import type { EffectCallback, Reducer, Dispatch, SetStateAction } from "react";
    declare const cleanup: () => void;
    declare const setup: () => undefined | (() => void);
    declare const reducer: (state: string, action: boolean) => string;
    declare const setter: Dispatch<SetStateAction<string>>;
    declare const update: (previous: string) => string;
    const effect: EffectCallback = setup;
    const nativeReducer: Reducer<string, boolean> = reducer;
    setter("next");
    setter(update);
    declare const pending: Promise<string>;
    pending.then(setter);
    const empty: EffectCallback = () => undefined;
    const withCleanup: EffectCallback = () => cleanup;
    // @ts-expect-error setup cannot return a string
    const wrongSetup: EffectCallback = () => "wrong";
    // @ts-expect-error setup cannot return a Promise
    const asyncSetup: EffectCallback = async () => {};
    // @ts-expect-error a reducer must return its state type
    const wrongReducer: Reducer<string, boolean> = (state, action) => action;
    // @ts-expect-error an updater must return its state type
    setter((previous: string) => true);
  `);
  assert.deepEqual(
    diagnostics.map((d) => d.messageText),
    [],
  );
});
