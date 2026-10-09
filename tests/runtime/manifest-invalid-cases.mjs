/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/

import {
  boundary,
  enumBoundary,
  nativeDescriptor,
  nativeField,
  objectBoundary,
  objectConstructor,
  recursiveRef,
} from "../support/interface-fixtures.mjs";

const nat = nativeDescriptor("nat");
const oneFieldObject = () => objectBoundary(
  "Example.Box",
  [objectConstructor("Example.Box.mk", {
    objectFieldCount: 1,
    usizeFieldCount: 0,
    scalarByteSize: 0,
  }, [nativeField("value", nat, { tag: "object", index: 0 })])],
  { tag: "record", fields: [{ key: "value", path: [0], value: { tag: "bigint" } }] },
);

export const invalidManifestCases = [
  {
    name: "boundary requires a native descriptor",
    mutate: (manifest) => { delete manifest.exports[0].result.native; },
    pattern: /result\.native must be an object/,
  },
  {
    name: "boundary requires an explicit JavaScript value mapping",
    mutate: (manifest) => { delete manifest.exports[0].result.value; },
    pattern: /result\.value must be an object/,
  },
  {
    name: "legacy interface tags cannot be attached to a descriptor pair",
    mutate: (manifest) => { manifest.exports[0].result.interfaceTag = 0; },
    pattern: /result\.interfaceTag is not supported/,
  },
  {
    name: "the native type no longer carries a display type string",
    mutate: (manifest) => { manifest.exports[0].result.native.type.type = "Nat"; },
    pattern: /native\.type\.type is not supported/,
  },
  {
    name: "Array is represented as a Lean object with codec metadata",
    mutate: (manifest) => {
      manifest.exports[0].result = boundary(
        nativeDescriptor("array"),
        { tag: "sequence", element: { tag: "bigint" } },
      );
    },
    pattern: /native\.type\.tag is not supported/,
  },
  {
    name: "a sequence needs compiler-supplied native Array metadata",
    mutate: (manifest) => {
      manifest.exports[0].result = boundary(
        nativeDescriptor("leanObject"),
        { tag: "sequence", element: { tag: "bigint" } },
      );
    },
    pattern: /requires native-array metadata/,
  },
  {
    name: "Array element metadata belongs to a Lean object",
    mutate: (manifest) => {
      manifest.exports[0].result.native.metadata = { arrayElement: nat };
    },
    pattern: /requires a Lean-object type/,
  },
  {
    name: "primitive views must agree with native scalar types",
    mutate: (manifest) => { manifest.exports[0].result.value = { tag: "string" }; },
    pattern: /is incompatible with nat/,
  },
  {
    name: "recursive references require an enclosing constructor scope",
    mutate: (manifest) => {
      manifest.exports[0].result = boundary(
        recursiveRef(0),
        { tag: "recursive" },
      );
    },
    pattern: /has no enclosing recursive descriptor/,
  },
  {
    name: "constructor metadata does not repeat numeric ordinals",
    mutate: (manifest) => {
      manifest.exports[0].result = enumBoundary("Example.Mode", ["cold", "hot"]);
      manifest.exports[0].result.native.metadata.constructors[0].tag = 0;
    },
    pattern: /constructors\[0\]\.tag is not supported/,
  },
  {
    name: "enum mappings cover the admitted constructor table",
    mutate: (manifest) => {
      manifest.exports[0].result = enumBoundary("Example.Mode", ["cold", "hot"]);
      manifest.exports[0].result.value.cases.pop();
    },
    pattern: /cases must cover every constructor/,
  },
  {
    name: "object fields cover each stored slot exactly once",
    mutate: (manifest) => {
      manifest.exports[0].result = oneFieldObject();
      manifest.exports[0].result.native.metadata.constructors[0].fields[0].location.index = 1;
    },
    pattern: /location\.index is out of range or duplicates a slot/,
  },
  {
    name: "callable views require a compiler-owned signature",
    mutate: (manifest) => {
      manifest.exports[0].result = boundary(
        nativeDescriptor("leanObject"),
        { tag: "function", args: [], result: { tag: "unit" } },
      );
    },
    pattern: /requires callable signature metadata/,
  },
  {
    name: "the Expr codec is selected only for Lean.Expr",
    mutate: (manifest) => {
      manifest.exports[0].result = boundary(
        nativeDescriptor("leanObject", {}, { declaration: "Example.Expr" }),
        { tag: "expr" },
      );
    },
    pattern: /requires Lean\.Expr metadata/,
  },
];
