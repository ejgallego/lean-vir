/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { typeScriptDiagnostics } from "../support/typescript-probe.mjs";

test("supported explicit node shapes are a subset of pinned ReactNode", () => {
  const diagnostics = typeScriptDiagnostics(`
    import type { ReactNode } from "react";
    declare const node: ReactNode;
    declare const text: string;
    declare const number: number;
    declare const bigint: bigint;
    declare const flag: boolean;
    declare const values: Array<Array<string | null> | undefined>;
    const nodes: ReactNode[] = [node, text, number, bigint, flag, null, undefined, values];
    // @ts-expect-error arbitrary objects are not nodes
    const object: ReactNode = { label: "not a node" };
    // @ts-expect-error unknown requires narrowing
    const unknown: ReactNode = {} as unknown;
    // @ts-expect-error a render function is not its result
    const fn: ReactNode = () => "not a node";
  `);
  assert.deepEqual(diagnostics.map(d => d.messageText), []);
});

test("useState preserves inferred and explicit initial-value/initializer relationships", async () => {
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
    const eagerText: string = useState("hello")[0];
    const inferredText: string = useState(makeText)[0];
    const storedFunction: () => string = useState(() => makeText)[0];
    declare const doNothing: () => void;
    declare const unary: (value: string) => string;
    const voidState: void = useState(doNothing)[0];
    const storedVoid: () => void = useState(() => doNothing)[0];
    const storedUnary: (value: string) => string = useState(() => unary)[0];
    // @ts-expect-error an argument-taking function is not a nullary initializer
    useState(unary);
    const explicitUnary = useState<typeof unary>(unary);
    const emptyNodes = useState<Array<import("react").ReactNode>>([]);
    function generic<T>(value: T): T { return useState(value)[0]; }
    const genericFunction: () => string = generic(makeText);
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
  assert.deepEqual(operation.typeParameters, ["α", "β"]);
  assert.deepEqual(operation.proofParameters, ["Lean.Vir.React.Initial.Accepts β α"]);
  assert.notEqual(operation.visibility, "private");
  assert.equal(operation.lean, "Lean.Vir.React.Hooks.useState");
  assert.equal(operation.arguments[0].type.lean, "Lean.Vir.Js β");
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

test("useCallback preserves supported function signatures and rejects objects", async () => {
  const diagnostics = typeScriptDiagnostics(`
    import { useCallback } from "react";
    declare const nullary: () => string;
    declare const unary: (value: string) => number;
    declare const binary: (left: string, right: number) => boolean;
    declare const ternary: (first: string, second: number, third: boolean) => symbol;
    const selectedNullary: () => string = useCallback(nullary, []);
    const selectedUnary: (value: string) => number = useCallback(unary, []);
    const selectedBinary: (left: string, right: number) => boolean = useCallback(binary, []);
    const selectedTernary: (first: string, second: number, third: boolean) => symbol = useCallback(ternary, []);
    // @ts-expect-error useCallback only accepts callable values
    useCallback({ invoke: unary }, []);
  `);
  assert.deepEqual(diagnostics.map((d) => d.messageText), []);

  const config = JSON.parse(await readFile(new URL("../../Vir/React.bindings.json", import.meta.url)));
  const operation = config.generation.protocolOperations.find(op => op.target === "react.useCallback");
  assert.deepEqual(operation.typeParameters, ["α"]);
  assert.deepEqual(operation.proofParameters, ["Lean.Vir.Js.Function.Shape α"]);
  assert.equal(operation.arguments[0].type.lean, "Lean.Vir.Js α");
  assert.equal(operation.arguments[0].type.resourceInner, "α");
  assert.equal(operation.result.type.lean, "Lean.Vir.Js α");
  assert.equal(operation.result.type.resourceInner, "α");
});
