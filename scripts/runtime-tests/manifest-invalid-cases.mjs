/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const invalidManifestCases = [
  {
    name: "unsupported export effect",
    mutate: (manifest) => {
      manifest.exports[0].effect = "sideEffect";
    },
    pattern: /exports\[0\]\.effect must be one of pure, runtime, io, dom, or react/,
  },
  {
    name: "unsupported interface tag",
    mutate: (manifest) => {
      manifest.exports[0].result = { type: "UnsupportedTag13", interfaceTag: 13 };
    },
    pattern: /result\.interfaceTag is not supported/,
  },
  {
    name: "array without element type",
    mutate: (manifest) => {
      manifest.exports[0].args[0].type = { type: "Array Nat", interfaceTag: 16 };
    },
    pattern: /args\[0\]\.type\.element must be an object/,
  },
  {
    name: "non-sequential enum tag",
    mutate: (manifest) => {
      manifest.exports[0].result = {
        type: "Mode",
        interfaceTag: 14,
        kind: "simpleEnum",
        constructors: [
          { name: "Mode.cold", jsName: "cold", tag: 0 },
          { name: "Mode.hot", jsName: "hot", tag: 2 },
        ],
      };
    },
    pattern: /constructors\[1\]\.tag must be 1/,
  },
  {
    name: "empty tagged union constructors",
    mutate: (manifest) => {
      manifest.exports[0].result = {
        type: "Sum Nat Nat",
        interfaceTag: 21,
        kind: "taggedUnion",
        name: "Sum",
        constructors: [],
      };
    },
    pattern: /constructors must be a non-empty array/,
  },
  {
    name: "empty custom inductive with runtime fields",
    mutate: (manifest) => {
      manifest.exports[0].result = {
        type: "Tree Nat",
        interfaceTag: 25,
        kind: "customInductive",
        name: "Tree",
        constructors: [
          {
            name: "Tree.leaf",
            jsName: "leaf",
            tag: 0,
            objectFieldCount: 1,
            usizeFieldCount: 0,
            scalarByteSize: 0,
            fields: [],
          },
        ],
      };
    },
    pattern: /constructors\[0\] with no fields must have zero runtime field counts/,
  },
  {
    name: "custom inductive recursiveSelf owner mismatch",
    mutate: (manifest) => {
      manifest.exports[0].result = {
        type: "Tree Nat",
        interfaceTag: 25,
        kind: "customInductive",
        name: "Tree",
        constructors: [
          {
            name: "Tree.branch",
            jsName: "branch",
            tag: 0,
            objectFieldCount: 1,
            usizeFieldCount: 0,
            scalarByteSize: 0,
            fields: [
              {
                name: "children",
                type: {
                  type: "List Tree",
                  interfaceTag: 17,
                  element: {
                    type: "Other",
                    interfaceTag: 26,
                    kind: "recursiveSelf",
                    name: "Other",
                  },
                },
                layout: { kind: "object", index: 0 },
              },
            ],
          },
        ],
      };
    },
    pattern: /constructors\[0\]\.fields\[0\]\.type\.element\.name must match Tree/,
  },
  {
    name: "root recursiveSelf",
    mutate: (manifest) => {
      manifest.exports[0].result = {
        type: "Tree Nat",
        interfaceTag: 26,
        kind: "recursiveSelf",
        name: "Tree",
      };
    },
    pattern: /result cannot be recursiveSelf outside a recursive descriptor/,
  },
  {
    name: "dangling nested recursiveSelf",
    mutate: (manifest) => {
      manifest.exports[0].result = {
        type: "Option Tree",
        interfaceTag: 18,
        element: {
          type: "Tree Nat",
          interfaceTag: 26,
          kind: "recursiveSelf",
          name: "Tree",
        },
      };
    },
    pattern: /result\.element cannot be recursiveSelf outside a recursive descriptor/,
  },
  {
    name: "structure recursiveSelf owner mismatch",
    mutate: (manifest) => {
      manifest.exports[0].result = {
        type: "Chain",
        interfaceTag: 20,
        kind: "structure",
        name: "Chain",
        objectFieldCount: 1,
        usizeFieldCount: 0,
        scalarByteSize: 0,
        fields: [
          {
            name: "next",
            type: {
              type: "Option Chain",
              interfaceTag: 18,
              element: {
                type: "Other",
                interfaceTag: 26,
                kind: "recursiveSelf",
                name: "Other",
              },
            },
            layout: { kind: "object", index: 0 },
          },
        ],
      };
    },
    pattern: /fields\[0\]\.type\.element\.name must match Chain/,
  },
  {
    name: "duplicate custom inductive field",
    mutate: (manifest) => {
      manifest.exports[0].result = {
        type: "Tree Nat",
        interfaceTag: 25,
        kind: "customInductive",
        name: "Tree",
        constructors: [
          {
            name: "Tree.branch",
            jsName: "branch",
            tag: 0,
            objectFieldCount: 2,
            usizeFieldCount: 0,
            scalarByteSize: 0,
            fields: [
              {
                name: "child",
                type: { type: "Nat", interfaceTag: 0 },
                layout: { kind: "object", index: 0 },
              },
              {
                name: "child",
                type: { type: "Nat", interfaceTag: 0 },
                layout: { kind: "object", index: 1 },
              },
            ],
          },
        ],
      };
    },
    pattern: /constructors\[0\]\.fields\[1\]\.name duplicates another field/,
  },
  {
    name: "custom inductive field layout outside count",
    mutate: (manifest) => {
      manifest.exports[0].result = {
        type: "Tree Nat",
        interfaceTag: 25,
        kind: "customInductive",
        name: "Tree",
        constructors: [
          {
            name: "Tree.leaf",
            jsName: "leaf",
            tag: 0,
            objectFieldCount: 1,
            usizeFieldCount: 0,
            scalarByteSize: 0,
            fields: [
              {
                name: "value",
                type: { type: "Nat", interfaceTag: 0 },
                layout: { kind: "object", index: 1 },
              },
            ],
          },
        ],
      };
    },
    pattern: /constructors\[0\]\.fields\[0\]\.layout\.index is outside objectFieldCount/,
  },
  {
    name: "invalid structure trivial field index",
    mutate: (manifest) => {
      manifest.exports[0].result = {
        type: "Box Nat",
        interfaceTag: 20,
        kind: "structure",
        name: "Box",
        objectFieldCount: 1,
        usizeFieldCount: 0,
        scalarByteSize: 0,
        trivialFieldIndex: 1,
        fields: [
          {
            name: "value",
            type: { type: "Nat", interfaceTag: 0 },
            layout: { kind: "object", index: 0 },
          },
        ],
      };
    },
    pattern: /trivialFieldIndex is out of range/,
  },
  {
    name: "structure object layout outside count",
    mutate: (manifest) => {
      manifest.exports[0].result = {
        type: "Box Nat",
        interfaceTag: 20,
        kind: "structure",
        name: "Box",
        objectFieldCount: 0,
        usizeFieldCount: 0,
        scalarByteSize: 0,
        fields: [
          {
            name: "value",
            type: { type: "Nat", interfaceTag: 0 },
            layout: { kind: "object", index: 0 },
          },
        ],
      };
    },
    pattern: /layout\.index is outside objectFieldCount/,
  },
  {
    name: "structure scalar layout outside byte size",
    mutate: (manifest) => {
      manifest.exports[0].result = {
        type: "ScalarBox",
        interfaceTag: 20,
        kind: "structure",
        name: "ScalarBox",
        objectFieldCount: 0,
        usizeFieldCount: 0,
        scalarByteSize: 1,
        fields: [
          {
            name: "flag",
            type: { type: "Bool", interfaceTag: 2 },
            layout: { kind: "scalar", size: 1, offset: 1 },
          },
        ],
      };
    },
    pattern: /layout is outside scalarByteSize/,
  },
  {
    name: "empty type display string",
    mutate: (manifest) => {
      manifest.exports[0].args[0].type.type = "";
    },
    pattern: /args\[0\]\.type\.type must be a non-empty string/,
  },
  {
    name: "duplicate export entry",
    mutate: (manifest) => {
      manifest.exports.push(structuredClone(manifest.exports[0]));
    },
    pattern: /entry duplicates another interface export/,
  },
  {
    name: "duplicate flattened inherited field",
    mutate: (manifest) => {
      manifest.exports[0].result = {
        type: "Child",
        interfaceTag: 20,
        kind: "structure",
        name: "Child",
        objectFieldCount: 2,
        usizeFieldCount: 0,
        scalarByteSize: 0,
        fields: [
          {
            name: "toParent",
            subobject: true,
            type: {
              type: "Parent",
              interfaceTag: 20,
              kind: "structure",
              name: "Parent",
              objectFieldCount: 1,
              usizeFieldCount: 0,
              scalarByteSize: 0,
              fields: [
                {
                  name: "value",
                  type: { type: "Nat", interfaceTag: 0 },
                  layout: { kind: "object", index: 0 },
                },
              ],
            },
            layout: { kind: "object", index: 0 },
          },
          {
            name: "value",
            type: { type: "Nat", interfaceTag: 0 },
            layout: { kind: "object", index: 1 },
          },
        ],
      };
    },
    pattern: /fields\[1\]\.name duplicates another flattened structure field/,
  },
  {
    name: "host import missing boundary",
    mutate: (manifest) => {
      manifest.hostImports = [
        {
          name: "jsHost",
          target: "test.host",
          effect: "runtime",
        },
      ];
    },
    pattern: /hostImports\[0\]\.boundary must be hostResource, explicitConversion, or objectHandle/,
  },
  {
    name: "host import unsupported boundary",
    mutate: (manifest) => {
      manifest.hostImports = [
        {
          name: "jsHost",
          target: "test.host",
          boundary: "implicit",
          effect: "runtime",
        },
      ];
    },
    pattern: /hostImports\[0\]\.boundary must be hostResource, explicitConversion, or objectHandle/,
  },
];
