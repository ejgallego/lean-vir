/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import assert from "node:assert/strict";
import test from "node:test";
import { typeScriptDiagnostics } from "../support/typescript-probe.mjs";

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
