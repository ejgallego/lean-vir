/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import test from "node:test";
import { VirRuntime } from "../../web/src/runtime/core.js";
import { validateInterfaceManifest, interfaceSignatureKey, INTERFACE_MANIFEST_VERSION } from "../../web/src/runtime/interface-manifest.js";
import { encodeInterfaceManifest } from "../../scripts/packages/irpkg-format.mjs";
import { primitiveBoundary, nativeDescriptor, enumBoundary, unitBoundary, objectBoundary, objectConstructor, immediateConstructor, nativeField } from "../support/interface-fixtures.mjs";

const nat = primitiveBoundary("nat", "bigint");
function wire(interfaces, argument = 0, result = 0) {
  return {
    version: INTERFACE_MANIFEST_VERSION,
    metadata: { packageFormatVersion: 11 },
    interfaces,
    exports: [{ entry: "Example.echo", nameKey: "s4578616d706c65/s6563686f/", args: [{ name: "value", type: argument }], result, effect: "pure", startup: false }],
  };
}

test("admission shares complete pair identity and leaves the wire input unchanged", () => {
  const input = wire([nat]);
  const resolved = validateInterfaceManifest(input);
  assert.equal(input.exports[0].args[0].type, 0);
  assert.equal(input.exports[0].result, 0);
  assert.equal(Object.hasOwn(resolved, "interfaces"), false);
  assert.equal(resolved.exports[0].args[0].type, nat);
  assert.equal(resolved.exports[0].result, nat);
  assert.equal(interfaceSignatureKey({ args: [resolved.exports[0].args[0].type], result: resolved.exports[0].result, effect: "pure" }),
    interfaceSignatureKey({ args: [nat], result: nat, effect: "pure" }));
});

test("table indices are local to each package", () => {
  const string = primitiveBoundary("string", "string");
  const first = validateInterfaceManifest(wire([nat]));
  const second = validateInterfaceManifest(wire([string]));
  assert.equal(first.exports[0].result, nat);
  assert.equal(second.exports[0].result, string);
});

function computedWire() {
  const pair = objectBoundary("Cached", [{ ...objectConstructor("Cached.mk", {
    objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 8,
  }, [nativeField("value", nat.native, { tag: "object", index: 0 })]), operation: "s436163686564/s6d6b/" }], {
    tag: "record", fields: [{ key: "value", path: [0], value: nat.value }],
  });
  const manifest = wire([pair, { native: nativeDescriptor("leanObject"), value: { tag: "leanReference" } }]);
  manifest.constructorOperations = [{ entry: "Cached.mk", nameKey: "s436163686564/s6d6b/",
    args: [{ name: "value", type: 1 }], result: 1, effect: "pure", startup: false }];
  return manifest;
}

test("construction operations resolve privately against admitted boxed helper contracts", () => {
  const admitted = validateInterfaceManifest(computedWire());
  assert.equal(admitted.exports.length, 1);
  assert.equal(admitted.constructorOperations.length, 1);
  assert.equal(admitted.constructorOperations[0].args[0].type.value.tag, "leanReference");
  const again = validateInterfaceManifest(encodeInterfaceManifest(admitted));
  assert.deepEqual(again, admitted);
});

test("required operations cannot be omitted, mismatched, effectful or exposed as ordinary exports", () => {
  for (const mutate of [
    m => { delete m.constructorOperations; },
    m => { m.constructorOperations[0].args = []; },
    m => { m.constructorOperations[0].effect = "io"; },
    m => { m.constructorOperations[0].result = 0; },
    m => { m.exports.push(m.constructorOperations[0]); },
  ]) {
    const input = computedWire(); mutate(input);
    assert.throws(() => validateInterfaceManifest(input), /constructor operation|constructor operations/i);
  }
});

test("callable roots require table indices and valid table entries", () => {
  for (const index of [-1, 0.5, "0", nat])
    assert.throws(() => validateInterfaceManifest(wire([nat], index)), /type must be a non-negative 32-bit integer/);
  assert.throws(() => validateInterfaceManifest(wire([nat], 1)), /no interface at index 1/);
  const missing = wire([nat]); delete missing.interfaces;
  assert.throws(() => validateInterfaceManifest(missing), /interfaces: \[\.\.\.\]/);
  assert.throws(() => validateInterfaceManifest(wire([{ native: { ref: 0 }, value: { tag: "recursive" } }])), /has no enclosing recursive descriptor/);
});

function tree(name) {
  const optional = objectBoundary("Option", [
    immediateConstructor("Option.none"),
    objectConstructor("Option.some", { objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0 }, [nativeField("val", { ref: 1 }, { tag: "object", index: 0 })]),
  ], { tag: "variant", cases: [{ kind: "none", payload: "none" }, { kind: "some", payload: "value", value: { tag: "recursive" } }] });
  return objectBoundary(name, [
    immediateConstructor(`${name}.leaf`),
    objectConstructor(`${name}.next`, { objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0 }, [nativeField("child", optional.native, { tag: "object", index: 0 })]),
  ], { tag: "variant", cases: [{ kind: "leaf", payload: "none" }, { kind: "next", payload: "value", value: optional.value }] });
}

test("sharing closed roots preserves lexical depth and separates enclosing owners", () => {
  const a = tree("A"), b = tree("B");
  const resolved = validateInterfaceManifest(wire([a, b], 0, 1));
  assert.equal(resolved.exports[0].args[0].type, a);
  assert.equal(resolved.exports[0].result, b);
  const child = a.native.metadata.constructors[1].fields[0].type;
  assert.deepEqual(child.metadata.constructors[1].fields[0].type, { ref: 1 });
  assert.throws(() => validateInterfaceManifest(wire([{ native: child, value: a.value.cases[1].value }])), /has no enclosing recursive descriptor/);
});

test("edited manifest encoding compares complete views and canonical property order", () => {
  const flag = enumBoundary("Flag", ["off", "on"]);
  const reversed = { native: flag.native, value: { tag: "enum", cases: ["on", "off"] } };
  const manifest = { ...wire([]), exports: [{ ...wire([]).exports[0], args: [{ name: "a", type: flag }, { name: "b", type: { value: flag.value, native: flag.native } }], result: reversed }] };
  delete manifest.interfaces;
  const encoded = encodeInterfaceManifest(manifest);
  assert.equal(encoded.interfaces.length, 2);
  assert.deepEqual(encoded.exports[0].args.map(arg => arg.type), [0, 0]);
  assert.equal(encoded.exports[0].result, 1);
  validateInterfaceManifest(encoded);
});

function runtimeFor(manifest) {
  const text = JSON.stringify(manifest), runtime = Object.create(VirRuntime.prototype);
  let bindings = 0;
  runtime.exports = { vir_package_interface_manifest: () => 1, vir_package_interface_manifest_size: () => text.length, vir_package_format_version: () => 11, vir_validate_package_contract: () => 1 };
  runtime.requireFunction = () => {};
  runtime.readWasmString = () => text;
  runtime.allocBytes = () => 1; runtime.freeBytes = () => {};
  runtime.makeObjectScalar = index => { bindings++; return 100 + index; };
  runtime.interfaceManifest = runtime.readPackageManifest();
  return { runtime, bindings: () => bindings };
}

test("shared frozen descriptions reuse a codec within each runtime", () => {
  // Native execution is mocked here; real producer/Wasm tests cover conversion.
  const first = runtimeFor(wire([unitBoundary()]));
  const entry = first.runtime.interfaceManifest.exports[0];
  assert.equal(entry.args[0].type, entry.result);
  assert.equal(Object.isFrozen(entry.result.native.metadata.constructors[0]), true);
  const a = first.runtime.nativeValueCodec(entry.args[0].type);
  const b = first.runtime.nativeValueCodec(entry.result);
  assert.equal(a, b);
  assert.equal(first.bindings(), 1);
  const second = runtimeFor(wire([unitBoundary()]));
  const c = second.runtime.nativeValueCodec(second.runtime.interfaceManifest.exports[0].result);
  assert.notEqual(a, c);
  assert.equal(second.bindings(), 1);
});
