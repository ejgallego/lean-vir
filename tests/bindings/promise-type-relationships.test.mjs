/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadBindingConfig } from "../../scripts/bindings/binding-config.mjs";
import { generateDescriptorFile } from "../../scripts/bindings/typescript-descriptors.mjs";
import { renderLeanBindings } from "../../scripts/bindings/typescript-to-lean.mjs";

const config = await loadBindingConfig(new URL("../../Vir/Js.bindings.json", import.meta.url).pathname);
const generation = { ...config.generation,
  protocolOperations: config.generation.protocolOperations.filter((op) => op.group === "promise") };
const descriptor = await generateDescriptorFile({
  files: [new URL("../../node_modules/typescript/lib/lib.es5.d.ts", import.meta.url).pathname],
  anchors: null, anchorsData: { version: 1, anchors: [] }, symbols: new Set(["Promise"]),
  symbolFiles: [], sourceUrl: null, dependencyDepth: 0, dependencyPolicy: null, dependencyPolicyData: null,
});
const render = (policy = generation, upstream = descriptor) =>
  renderLeanBindings(config, policy, new Map([["promise", upstream]]));
const diagnostic = /TypeScript Promise<T> selected subset relationship violated/u;

test("pinned Promise relationships render the shipped generic signatures and catch Any", async () => {
  const text = render();
  const shipped = await readFile(new URL("../../Vir/Js/Generated.lean", import.meta.url), "utf8");
  const declarations = [...text.matchAll(/opaque [^]*?RuntimeM \([^\n]+\)/gu)];
  assert.equal(declarations.length, 6);
  for (const declaration of declarations) {
    assert.ok(shipped.includes(declaration[0]), declaration[0]);
  }
  assert.match(text, /opaque catchValue\s+\{α : Type\}\s+\(promise[^]*?Function1 Lean\.Vir\.Js\.Any \(Lean\.Vir\.Js α\)/u);
  assert.doesNotMatch(text, /\{error : Type\}/u);
});

for (const [label, mutate] of [
  ["invented parameter", (op) => op.typeParameters.push("Unrelated")],
  ["unrelated receiver", (op) => { op.arguments[0].type.lean = "Lean.Vir.Js.Promise Unrelated"; }],
  ["unrelated callback", (op) => { op.arguments[1].type.lean = "Lean.Vir.Js.Function1 (Lean.Vir.Js Unrelated) Unit"; }],
  ["erased result", (op) => { op.result.type.lean = "Lean.Vir.Js.Promise Lean.Vir.Js.Any.Value"; }],
  ["retagged result metadata", (op) => { op.result.type.resourceInner = "Lean.Vir.Js.Promise.Value Unrelated"; }],
  ["extra runtime argument", (op) => op.arguments.push(structuredClone(op.arguments[1]))],
]) {
  test(`all selected Promise operations reject ${label}`, () => {
    for (const original of generation.protocolOperations) {
      const policy = structuredClone(generation);
      mutate(policy.protocolOperations.find((op) => op.id === original.id));
      assert.throws(() => render(policy), diagnostic, original.target);
    }
  });
}

test("rejection callbacks cannot claim a typed error or an unrelated branch result", () => {
  for (const target of ["catchValue", "thenValueWithRejection", "thenVoidWithRejection"]) {
    for (const type of ["Lean.Vir.Js.Function1 (Lean.Vir.Js String) (Lean.Vir.Js α)",
      "Lean.Vir.Js.Function1 Lean.Vir.Js.Any (Lean.Vir.Js Unrelated)"]) {
      const policy = structuredClone(generation);
      policy.protocolOperations.find((op) => op.target === `js.promise.${target}`).arguments.at(-1).type.lean = type;
      assert.throws(() => render(policy), diagnostic);
    }
  }
});

test("missing or changed upstream Promise relationships fail closed", () => {
  for (const member of ["Promise.then", "Promise.catch"]) {
    for (const mutate of [
      (method) => { delete method.typeParameters; },
      (method) => { method.typeParameters[0].constraint = { kind: "opaque", name: "object" }; },
      (method) => { method.typeParameters[0].default = { kind: "opaque", name: "any" }; },
      (method) => { method.shape.args[0].type.element.args[0].type = { kind: "ref", id: "Wrong" }; },
      (method) => { method.shape.args.at(-1).type.element.args[0].type = { kind: "ref", id: "Error" }; },
      (method) => { method.shape.args[0].type.element.result.options[1].args[0].id = "Wrong"; },
      (method) => { method.shape.result.args[0].options[1].id = "Wrong"; },
      (method) => { method.shape.args.at(-1).optional = false; },
      (method) => { method.shape.args[0].type.absence = "null"; },
    ]) {
      const upstream = structuredClone(descriptor);
      mutate(upstream.symbols.find((symbol) => symbol.id === member));
      assert.throws(() => render(generation, upstream), diagnostic);
    }
  }
  const upstream = structuredClone(descriptor);
  delete upstream.symbols.find((symbol) => symbol.id === "Promise").typeParameters;
  assert.throws(() => render(generation, upstream), diagnostic);
});

test("upstream binder renaming and union ordering do not change the translation", () => {
  const rename = (value) => {
    if (Array.isArray(value)) return value.map(rename);
    if (value === null || typeof value !== "object") return value;
    const names = { T: "Input", TResult: "Recovery", TResult1: "Success", TResult2: "Failure" };
    const result = Object.fromEntries(Object.entries(value).map(([key, v]) =>
      [key, (key === "id" || key === "name") && names[v] ? names[v] : rename(v)]));
    if (result.kind === "union") result.options.reverse();
    return result;
  };
  assert.equal(render(generation, rename(descriptor)), render());
});

// Independently compile the selected TS wrappers, including Promise<B>'s
// structural compatibility with PromiseLike<B>. No assertion, cast or emit.
const wrappers = `
export function value<A, B>(p: Promise<A>, f: (a: A) => B): Promise<B> { return p.then<B>(f); }
export function promise<A, B>(p: Promise<A>, f: (a: A) => Promise<B>): Promise<B> { return p.then<B>(f); }
export function both<A, B>(p: Promise<A>, f: (a: A) => B, g: (e: unknown) => B): Promise<B> { return p.then<B, B>(f, g); }
export function recover<A>(p: Promise<A>, g: (e: unknown) => A): Promise<A> { return p.catch<A>(g); }
export function discard<A>(p: Promise<A>, f: (a: A) => undefined): Promise<undefined> { return p.then<undefined>(f); }
export function discardBoth<A>(p: Promise<A>, f: (a: A) => undefined, g: (e: unknown) => undefined): Promise<undefined> { return p.then<undefined, undefined>(f, g); }
declare const input: Promise<number>;
// Explicit generic subsets are not equivalent to full native .then inference.
const nested: Promise<Promise<string>> = value(input, () => Promise.resolve("text"));
const row = { then(resolve: (s: string) => void) { resolve("text"); } };
const selectedRow: Promise<typeof row> = value(input, () => row);
`;
function diagnostics(source) {
  const path = new URL("./promise-subset.virtual.ts", import.meta.url).pathname;
  const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, types: [] };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, ...args) => file === path ?
    ts.createSourceFile(file, source, languageVersion, true) : getSourceFile(file, languageVersion, ...args);
  return ts.getPreEmitDiagnostics(ts.createProgram([path], options, host));
}
test("selected wrappers compile against pinned TS; an unrelated result does not", () => {
  assert.deepEqual(diagnostics(wrappers).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
  assert.ok(diagnostics(wrappers.replace("return p.then<B>(f)", "return p.then<A>(f)")).length > 0);
});
