/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { readIrPackageInfo } from "../../scripts/packages/irpkg-format.mjs";
import { assert, generateIrPackage, join, readFile, writeRuntimeFixture } from "./shared.mjs";

export async function runNativeValuesSmoke({ freshDir, wasmBytes }) {
  const source = join(freshDir, "FreshNativeValues.lean");
  const pkg = join(freshDir, "native-values.irpkg");
  await writeRuntimeFixture(source, "FreshNativeValues.lean");
  await generateIrPackage("FreshNativeValues", source, pkg);
  const packageBytes = await readFile(pkg);
  const imports = readIrPackageInfo(packageBytes).manifest.hostImports;
  for (const [target, arguments_] of [["js.function.call2", 3], ["js.function.call3", 4],
    ["js.function.call3Void", 4]]) {
    const entry = imports.find(entry => entry.target === target);
    assert.ok(entry, `${target} is reached through its inline typed declaration`);
    assert.equal(entry.erasedPrefixArgs, 0, "monomorphic import needs no phantom arguments");
    assert.equal(entry.args.length, arguments_);
    assert.equal(entry.arity, arguments_ + 1, "native arguments plus the IO world only");
  }
  const runtime = await createVirRuntimeFactory({ wasmBytes }).createRuntime({
    irPackageSet: [packageBytes],
  });
  try {
    assert.equal(runtime.call("stringEqual", "\ud800", "\ud801"), false);
    assert.equal(runtime.call("stringConcat", "\ud800", "\udfff"), "\ud800\udfff");
    assert.equal(runtime.call("stringSlice", "a😀z", 1, 2), "\ud83d");
    assert.equal(runtime.call("stringSlice", "abc", -1, undefined), "c");
    assert.equal(runtime.call("stringIncludes", "a\ud800b", "\ud800"), true);
    assert.equal(runtime.call("stringStartsWith", "abc", "ab"), true);
    assert.equal(runtime.call("stringEndsWith", "abc", "bc"), true);
    assert.equal(runtime.call("stringTrim", " \tword\n"), "word");
    assert.equal(runtime.call("stringToLowerCase", "İ"), "i\u0307");
    assert.equal(runtime.call("stringToUpperCase", "ß"), "SS");
    for (const [method, a, b, expected] of [
      ["Add", 0.1, 0.2, 0.1 + 0.2], ["Sub", 1, 2, -1], ["Mul", -0, 2, -0],
      ["Div", 1, 0, Infinity], ["Rem", -5, 2, -1], ["Equal", NaN, NaN, false],
      ["Equal", -0, 0, true], ["Lt", NaN, 1, false], ["Le", Infinity, Infinity, true],
    ]) assert.ok(Object.is(runtime.call(`number${method}`, a, b), expected));
    assert.ok(Object.is(runtime.call("numberNeg", 0), -0));
    assert.equal(runtime.call("numberIsNaN", NaN), true);
    assert.equal(runtime.call("numberIsFinite", Infinity), false);
    assert.equal(runtime.call("numberIsInteger", 1.5), false);
    const large = 2n ** 256n + 1n;
    assert.equal(runtime.call("natAdd", large, large), large + large);
    assert.equal(runtime.call("natMul", large, large), large * large);
    assert.equal(runtime.call("natEqual", large, large), true);
    assert.equal(runtime.call("natLt", large, large + 1n), true);
    assert.equal(runtime.call("natLe", large, large), true);
    assert.equal(runtime.call("booleanNot", true), false);
    assert.equal(runtime.call("booleanEqual", true, false), false);
    for (let arity = 0; arity <= 3; arity++) {
      const args = [undefined, Object.freeze({ exact: true }), "\ud800"].slice(0, arity);
      const result = Object.freeze({ result: arity });
      let calls = 0;
      const fn = function (...actual) {
        calls++;
        assert.equal(this, undefined);
        assert.deepEqual(actual, args);
        return result;
      };
      assert.equal(runtime.call(`call${arity}`, fn, ...args), result);
      assert.equal(runtime.call(`call${arity}`, () => undefined, ...args), undefined);
      const promise = Promise.resolve(result);
      assert.equal(runtime.call(`call${arity}`, () => promise, ...args), promise);
      assert.equal(runtime.call(`call${arity}Void`, fn, ...args), undefined);
      assert.equal(calls, 2, "exact call count and void discards only the result");
      const failure = new Error(`call${arity} failure`);
      for (const suffix of ["", "Void"])
        assert.throws(() => runtime.call(`call${arity}${suffix}`, () => { throw failure; }, ...args),
          error => error === failure);
    }
  } finally { runtime.dispose(); }
}
