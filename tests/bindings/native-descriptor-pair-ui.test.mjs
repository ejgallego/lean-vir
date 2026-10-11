/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  constructorTemplate,
  defaultValueForType,
  interfaceInputTag,
  isJsonInput,
} from "../../web/app/pages/interface-inputs.js";

const nat = { type: { tag: "nat" } };

test("runner templates follow the selected value cases and native field paths", () => {
  const option = {
    native: {
      type: { tag: "leanObject" },
      metadata: {
        declaration: "Option",
        constructors: [
          { name: "Option.none", representation: "immediate", fields: [] },
          {
            name: "Option.some",
            representation: "object",
            storage: { objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0 },
            fields: [{
              name: "val",
              type: { type: { tag: "nat" } },
              location: { tag: "object", index: 0 },
            }],
          },
        ],
      },
    },
    value: {
      tag: "variant",
      cases: [
        { kind: "none", payload: "none" },
        { kind: "some", payload: "value", value: { tag: "bigint" } },
      ],
    },
  };
  assert.equal(interfaceInputTag(option), "TEXTAREA");
  assert.equal(isJsonInput(option), true);
  assert.deepEqual(defaultValueForType(option), { kind: "none" });
  assert.deepEqual(constructorTemplate(option, 1), { kind: "some", value: 0 });
  assert.equal(constructorTemplate(option, 2), null);
});

test("sequence templates treat native arrays and linked lists through the same view", () => {
  const array = {
    native: { type: { tag: "leanObject" }, metadata: { arrayElement: nat } },
    value: { tag: "sequence", element: { tag: "bigint" } },
  };
  const list = {
    native: {
      type: { tag: "leanObject" },
      metadata: {
        declaration: "AnUnusualListName",
        constructors: [
          { name: "L.nil", representation: "immediate", fields: [] },
          {
            name: "L.cons",
            representation: "object",
            storage: { objectFieldCount: 2, usizeFieldCount: 0, scalarByteSize: 0 },
            fields: [
              { name: "head", type: nat, location: { tag: "object", index: 0 } },
              { name: "tail", type: { ref: 0 }, location: { tag: "object", index: 1 } },
            ],
          },
        ],
      },
    },
    value: {
      tag: "sequence",
      element: { tag: "bigint" },
      chain: { nil: 0, cons: 1, head: 0, tail: 1 },
    },
  };
  assert.deepEqual(defaultValueForType(array), []);
  assert.deepEqual(defaultValueForType(list), []);
});

test("record templates follow logical inherited-field paths", () => {
  const parent = {
    type: { tag: "leanObject" },
    metadata: {
      declaration: "Parent",
      constructors: [{
        name: "Parent.mk",
        representation: "object",
        storage: { objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0 },
        fields: [{
          name: "inherited",
          type: { type: { tag: "string" } },
          location: { tag: "object", index: 0 },
        }],
      }],
    },
  };
  const child = {
    native: {
      type: { tag: "leanObject" },
      metadata: {
        declaration: "Child",
        constructors: [{
          name: "Child.mk",
          representation: "object",
          storage: { objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0 },
          fields: [{
            name: "parent",
            type: { type: { tag: "leanObject" }, metadata: parent.metadata },
            location: { tag: "object", index: 0 },
          }],
        }],
      },
    },
    value: {
      tag: "record",
      fields: [{ key: "label", path: [0, 0], value: { tag: "string" } }],
    },
  };
  assert.equal(interfaceInputTag(child), "TEXTAREA");
  assert.deepEqual(defaultValueForType(child), { label: "" });
});

test("recursive templates resolve lexical references and stop at a finite depth", () => {
  const tree = {
    native: {
      type: { tag: "leanObject" },
      metadata: {
        declaration: "Tree",
        constructors: [
          { name: "Tree.leaf", representation: "immediate", fields: [] },
          {
            name: "Tree.node",
            representation: "object",
            storage: { objectFieldCount: 2, usizeFieldCount: 0, scalarByteSize: 0 },
            fields: [
              { name: "left", type: { ref: 0 }, location: { tag: "object", index: 0 } },
              { name: "right", type: { ref: 0 }, location: { tag: "object", index: 1 } },
            ],
          },
        ],
      },
    },
    value: {
      tag: "variant",
      cases: [
        { kind: "leaf", payload: "none" },
        {
          kind: "node",
          payload: "fields",
          fields: [
            { key: "left", path: [0], value: { tag: "recursive" } },
            { key: "right", path: [1], value: { tag: "recursive" } },
          ],
        },
      ],
    },
  };
  assert.deepEqual(constructorTemplate(tree, 1), {
    kind: "node",
    fields: { left: { kind: "leaf" }, right: { kind: "leaf" } },
  });
});
