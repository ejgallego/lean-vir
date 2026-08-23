/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  leanType,
  renderLeanBindings,
} from "../../scripts/bindings/typescript-to-lean.mjs";

const stringShape = { kind: "primitive", name: "string" };
const nullableStringShape = { kind: "option", element: stringShape };
const generation = {
  output: "Vir/Demo/Generated.lean",
  imports: ["Vir.Demo.Types"],
  namespace: "Lean.Vir.Demo",
  effects: { dom: "DomM" },
  resources: { Widget: "Widget" },
  members: ["Widget.label"],
};
const config = {
  roots: [{
    id: "widget",
    mappings: [{
      typescript: "Widget.label",
      accessors: {
        get: {
          target: "demo.widget.getLabel",
          lean: "Lean.Vir.Demo.Widget.getLabel",
          anchor: "widget.label.get",
        },
        set: {
          target: "demo.widget.setLabel",
          lean: "Lean.Vir.Demo.Widget.setLabel",
          anchor: "widget.label.set",
        },
      },
    }],
    anchors: [
      {
        id: "widget.label.get",
        ts: "Widget.label",
        target: "demo.widget.getLabel",
        relation: "audit",
        portIntent: {
          disposition: "bind",
          accessor: "get",
          receiver: "borrowed",
          effect: "dom",
          resultRepresentation: "hostResource",
        },
      },
      {
        id: "widget.label.set",
        ts: "Widget.label",
        target: "demo.widget.setLabel",
        relation: "audit",
        portIntent: {
          disposition: "bind",
          accessor: "set",
          receiver: "borrowed",
          effect: "dom",
          resourceArguments: [0],
        },
      },
    ],
  }],
};
const descriptors = new Map([[
  "widget",
  {
    symbols: [{
      id: "Widget.label",
      kind: "property",
      source: { path: "demo.d.ts", startLine: 4 },
      accessors: { get: stringShape, set: nullableStringShape },
    }],
  },
]]);

test("TypeScript property accessor types determine generated Lean declarations", () => {
  const output = renderLeanBindings(config, generation, descriptors);

  assert.match(output, /private opaque getLabelJs\n    \(widget : @& Lean\.Vir\.Js Widget\) :\n    DomM \(Lean\.Vir\.Js String\)/u);
  assert.match(output, /private opaque setLabelJs\n    \(widget : @& Lean\.Vir\.Js Widget\)\n    \(label : @& Lean\.Vir\.Js\.Nullable String\) :\n    DomM Unit/u);
  assert.match(output, /@\[vir_js "demo\.widget\.getLabel"\]/u);
  assert.doesNotMatch(output, /\(label : @& String\)/u);
});

test("unsupported TypeScript shapes fail closed", () => {
  assert.throws(
    () => leanType({ kind: "primitive", name: "boolean" }, generation, "Widget.enabled"),
    /unsupported faithful translation/u,
  );
});

test("resource ownership policy is required", () => {
  const withoutResourcePolicy = structuredClone(config);
  delete withoutResourcePolicy.roots[0].anchors[1].portIntent.resourceArguments;

  assert.throws(
    () => renderLeanBindings(withoutResourcePolicy, generation, descriptors),
    /classify setter argument 0 as a resource/u,
  );
});

test("selected TypeScript accessors cannot be silently omitted", () => {
  const missingSetter = structuredClone(config);
  delete missingSetter.roots[0].mappings[0].accessors.set;

  assert.throws(
    () => renderLeanBindings(missingSetter, generation, descriptors),
    /set is part of the TypeScript surface but has no generated binding/u,
  );
});
