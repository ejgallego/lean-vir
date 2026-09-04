/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  INTERFACE_MANIFEST_VERSION,
  MIN_INTERFACE_MANIFEST_VERSION,
} from "../../web/src/runtime/interface-manifest.js";

function packageTarget(overrides = {}) {
  return {
    source: "Example.lean",
    mode: "all",
    roots: [],
    resolvedRoots: [],
    ...overrides,
  };
}

function hostImport(overrides = {}) {
  return {
    slot: 0,
    name: "Example.jsHost",
    source: "Example.lean",
    target: "test.host",
    boundary: "hostResource",
    symbol: "vir_host_import_0",
    arity: 2,
    erasedPrefixArgs: 0,
    args: [
      {
        name: "value",
        type: { type: "Nat", interfaceTag: 0 },
      },
    ],
    result: { type: "Nat", interfaceTag: 0 },
    effect: "runtime",
    ...overrides,
  };
}

export const invalidManifestCases = [
  {
    name: "missing manifest version",
    mutate: (manifest) => {
      delete manifest.version;
    },
    pattern: /embedded interface manifest must be/,
  },
  {
    name: "string manifest version",
    mutate: (manifest) => {
      manifest.version = "7";
    },
    pattern: /embedded interface manifest must be/,
  },
  {
    name: "fractional manifest version",
    mutate: (manifest) => {
      manifest.version = 6.5;
    },
    pattern: /embedded interface manifest must be/,
  },
  {
    name: "obsolete manifest version",
    mutate: (manifest) => {
      manifest.version = MIN_INTERFACE_MANIFEST_VERSION - 1;
    },
    pattern: /embedded interface manifest must be/,
  },
  {
    name: "future manifest version",
    mutate: (manifest) => {
      manifest.version = INTERFACE_MANIFEST_VERSION + 1;
    },
    pattern: /embedded interface manifest must be/,
  },
  {
    name: "missing required startup marker",
    mutate: (manifest) => {
      delete manifest.exports[0].startup;
    },
    pattern: /exports\[0\]\.startup must be a boolean/,
  },
  {
    name: "manifest metadata version mismatch",
    mutate: (manifest) => {
      manifest.metadata.manifestVersion = manifest.version - 1;
    },
    pattern: /metadata\.manifestVersion must match manifest\.version/,
  },
  {
    name: "package header metadata version mismatch",
    mutate: (manifest) => {
      manifest.metadata.packageFormatVersion = 9;
    },
    options: { packageFormatVersion: 10 },
    pattern: /packageFormatVersion must match package header version 10/,
  },
  {
    name: "non-array package targets",
    mutate: (manifest) => {
      manifest.metadata.targets = {};
    },
    pattern: /metadata\.targets must be an array/,
  },
  {
    name: "non-object package target",
    mutate: (manifest) => {
      manifest.metadata.targets = [null];
    },
    pattern: /metadata\.targets\[0\] must be an object/,
  },
  {
    name: "unsupported package target mode",
    mutate: (manifest) => {
      manifest.metadata.targets = [
        {
          source: "Example.lean",
          mode: "everything",
          roots: [],
          resolvedRoots: [],
        },
      ];
    },
    pattern: /metadata\.targets\[0\]\.mode must be one of/,
  },
  {
    name: "non-array resolved package roots",
    mutate: (manifest) => {
      manifest.metadata.targets = [
        {
          source: "Example.lean",
          mode: "all",
          roots: [],
          resolvedRoots: "Example.value",
        },
      ];
    },
    pattern: /metadata\.targets\[0\]\.resolvedRoots must be an array/,
  },
  {
    name: "package target with both origins",
    mutate: (manifest) => {
      manifest.metadata.targets = [packageTarget({ module: "Example" })];
    },
    pattern: /must have exactly one of source or module/,
  },
  {
    name: "module target without module origin",
    mutate: (manifest) => {
      manifest.metadata.targets = [packageTarget({ mode: "markedModule" })];
    },
    pattern: /mode markedModule requires a module/,
  },
  {
    name: "module origin with source mode",
    mutate: (manifest) => {
      manifest.metadata.targets = [
        packageTarget({ source: undefined, module: "Example", mode: "all" }),
      ];
    },
    pattern: /module requires mode markedModule/,
  },
  {
    name: "explicit target without roots",
    mutate: (manifest) => {
      manifest.metadata.targets = [packageTarget({ mode: "explicit" })];
    },
    pattern: /roots must be non-empty for explicit/,
  },
  {
    name: "marked target with explicit roots",
    mutate: (manifest) => {
      manifest.metadata.targets = [
        packageTarget({ mode: "marked", roots: ["Example.value"] }),
      ];
    },
    pattern: /roots must be empty for marked/,
  },
  {
    name: "duplicate resolved package roots",
    mutate: (manifest) => {
      manifest.metadata.targets = [
        packageTarget({
          mode: "all",
          resolvedRoots: ["Example.value", "Example.value"],
        }),
      ];
    },
    pattern: /resolvedRoots\[1\] duplicates "Example\.value"/,
  },
  {
    name: "invalid package-set member role",
    mutate: (manifest) => {
      manifest.metadata.packageSetMember = {
        module: "Example",
        role: "leaf",
      };
    },
    pattern: /packageSetMember\.role must be dependency or root/,
  },
  {
    name: "unnormalized package-set member module",
    mutate: (manifest) => {
      manifest.metadata.packageSetMember = {
        module: " Example.Dependency",
        role: "dependency",
      };
    },
    pattern: /packageSetMember\.module must be a normalized Lean module name/,
  },
  {
    name: "invalid package-set member module syntax",
    mutate: (manifest) => {
      manifest.metadata.packageSetMember = {
        module: "Example/Dependency",
        role: "dependency",
      };
    },
    pattern: /packageSetMember\.module must be a normalized Lean module name/,
  },
  {
    name: "dependency package-set member with target",
    mutate: (manifest) => {
      manifest.metadata.targets = [packageTarget()];
      manifest.metadata.packageSetMember = {
        module: "Example.Dependency",
        role: "dependency",
      };
    },
    pattern: /dependency members must not have public targets/,
  },
  {
    name: "dependency package-set member with export",
    mutate: (manifest) => {
      manifest.metadata.packageSetMember = {
        module: "Example.Dependency",
        role: "dependency",
      };
    },
    pattern:
      /dependency package-set members must not expose exports or host imports/,
  },
  {
    name: "root package-set member without matching module target",
    mutate: (manifest) => {
      manifest.metadata.targets = [
        packageTarget({
          source: undefined,
          module: "Example.Other",
          mode: "markedModule",
        }),
      ];
      manifest.metadata.packageSetMember = {
        module: "Example.Root",
        role: "root",
      };
    },
    pattern: /root member must match its markedModule target/,
  },
  {
    name: "non-boolean startup marker",
    mutate: (manifest) => {
      manifest.exports[0].startup = "yes";
    },
    pattern: /exports\[0\]\.startup must be a boolean/,
  },
  {
    name: "unsupported export effect",
    mutate: (manifest) => {
      manifest.exports[0].effect = "sideEffect";
    },
    pattern:
      /exports\[0\]\.effect must be one of pure, runtime, io, dom, or react/,
  },
  {
    name: "unsupported interface tag",
    mutate: (manifest) => {
      manifest.exports[0].result = {
        type: "UnsupportedTag13",
        interfaceTag: 13,
      };
    },
    pattern: /result\.interfaceTag is not supported/,
  },
  {
    name: "legacy wireTag descriptor rejected",
    mutate: (manifest) => {
      const result = manifest.exports[0].result;
      result.wireTag = result.interfaceTag;
      delete result.interfaceTag;
    },
    pattern: /result\.interfaceTag is not supported/,
  },
  {
    name: "array without element type",
    mutate: (manifest) => {
      manifest.exports[0].args[0].type = {
        type: "Array Nat",
        interfaceTag: 16,
      };
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
    pattern:
      /constructors\[0\] with no fields must have zero runtime field counts/,
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
    pattern:
      /constructors\[0\]\.fields\[0\]\.type\.element\.name must match Tree/,
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
    pattern:
      /result\.element cannot be recursiveSelf outside a recursive descriptor/,
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
    pattern:
      /constructors\[0\]\.fields\[0\]\.layout\.index is outside objectFieldCount/,
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
      manifest.hostImports = [hostImport({ boundary: undefined })];
    },
    pattern:
      /hostImports\[0\]\.boundary must be hostResource, explicitConversion, or objectHandle/,
  },
  {
    name: "host import unsupported boundary",
    mutate: (manifest) => {
      manifest.hostImports = [hostImport({ boundary: "implicit" })];
    },
    pattern:
      /hostImports\[0\]\.boundary must be hostResource, explicitConversion, or objectHandle/,
  },
  {
    name: "legacy wire host boundary rejected",
    mutate: (manifest) => {
      manifest.hostImports = [hostImport({ boundary: "wire" })];
    },
    pattern:
      /hostImports\[0\]\.boundary must be hostResource, explicitConversion, or objectHandle/,
  },
  {
    name: "host import missing target",
    mutate: (manifest) => {
      manifest.hostImports = [hostImport({ target: undefined })];
    },
    pattern: /hostImports\[0\]\.target must be a non-empty string/,
  },
  {
    name: "host import missing args",
    mutate: (manifest) => {
      manifest.hostImports = [hostImport({ args: undefined })];
    },
    pattern: /hostImports\[0\]\.args must be an array/,
  },
  {
    name: "host import missing result",
    mutate: (manifest) => {
      manifest.hostImports = [hostImport({ result: undefined })];
    },
    pattern: /hostImports\[0\]\.result must be an object/,
  },
  {
    name: "host import non-sequential slot",
    mutate: (manifest) => {
      manifest.hostImports = [hostImport({ slot: 1 })];
    },
    pattern: /hostImports\[0\]\.slot must be 0/,
  },
  {
    name: "host import arity mismatch",
    mutate: (manifest) => {
      manifest.hostImports = [hostImport({ arity: 1 })];
    },
    pattern:
      /arity does not match erased arguments, value arguments, and effect \(2\)/,
  },
  {
    name: "duplicate host import name",
    mutate: (manifest) => {
      manifest.hostImports = [
        hostImport(),
        hostImport({ slot: 1, symbol: "vir_host_import_1" }),
      ];
    },
    pattern: /hostImports\[1\]\.name duplicates another host import/,
  },
  {
    name: "duplicate host import symbol",
    mutate: (manifest) => {
      manifest.hostImports = [
        hostImport(),
        hostImport({ slot: 1, name: "Example.otherHost" }),
      ];
    },
    pattern: /hostImports\[1\]\.symbol duplicates another host import/,
  },
];
