/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  generateNativeSymbolRegistry,
  nativeSymbolRegistryEntry,
  parseNativeSymbolRegistry,
} from "../../scripts/native/native-symbol-registry.mjs";

test("native registry separates wrappers, constants, and compiler-owned entries", () => {
  const wrapper = {
    name: "Demo.run",
    nameKey: "s44656d6f/s72756e/",
    symbol: "lean_demo_run",
    params: [{}],
    generateBoxedWrapper: false,
  };
  const constant = {
    name: "Demo.constant",
    nameKey: "s44656d6f/s636f6e7374616e74/",
    symbol: "l_Demo_constant",
    params: [],
    generateBoxedWrapper: false,
  };
  const compilerOwned = {
    name: "Demo.compilerOwned",
    nameKey: "s44656d6f/s636f6d70696c65724f776e6564/",
    symbol: "lean_demo_compiler_owned",
    params: [{}],
    generateBoxedWrapper: true,
  };

  assert.deepEqual(nativeSymbolRegistryEntry(wrapper), {
    kind: "X",
    nameKey: "s44656d6f/s72756e/",
    symbol: "lean_demo_run",
    wrapper: "lean_demo_run___boxed",
    dlsymSymbol: "lean_demo_run___boxed",
  });
  assert.deepEqual(nativeSymbolRegistryEntry(constant), {
    kind: "X_CONST",
    nameKey: "s44656d6f/s636f6e7374616e74/",
    symbol: "l_Demo_constant",
    wrapper: "l_Demo_constant",
    dlsymSymbol: "l_Demo_constant",
  });

  const generated = generateNativeSymbolRegistry([wrapper, constant, compilerOwned]);
  assert.doesNotMatch(generated, /Demo\.compilerOwned/);
  assert.deepEqual(parseNativeSymbolRegistry(generated), [
    nativeSymbolRegistryEntry(wrapper),
    nativeSymbolRegistryEntry(constant),
  ]);
});
