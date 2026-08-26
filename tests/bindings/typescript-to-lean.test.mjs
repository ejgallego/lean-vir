/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGeneratedOperations,
  materializeGeneratedAnchors,
} from "../../scripts/bindings/binding-modalities.mjs";
import {
  leanType,
  renderLeanBindings,
} from "../../scripts/bindings/typescript-to-lean.mjs";

const stringShape = { kind: "primitive", name: "string" };
const nullableStringShape = { kind: "option", element: stringShape };
const generation = {
  output: "Vir/Demo/Generated.lean",
  irOutput: "build/bindings/demo.generated-operations.json",
  imports: ["Vir.Demo.Types"],
  namespace: "Lean.Vir.Demo",
  abiProfile: {
    id: "demo-faithful-v1",
    effect: { id: "dom", lean: "DomM" },
    types: {
      string: { lean: "String", representation: "js-resource" },
      void: { lean: "Unit", representation: "immediate" },
    },
    resource: {
      constructor: "Lean.Vir.Js",
      nullableConstructor: "Lean.Vir.Js.Nullable",
      argument: { passing: "borrowed", retention: "call" },
      result: { ownership: "owned" },
    },
    receiver: {
      default: { passing: "borrowed", retention: "call" },
      globalTypes: [],
    },
  },
  resources: { Widget: "Widget" },
  members: ["Widget.getAttribute", "Widget.label"],
  methodPolicies: {
    "Widget.getAttribute": { signature: "only" },
  },
  exceptions: {},
};
const config = {
  id: "demo",
  generation,
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
    }, {
      typescript: "Widget.getAttribute",
      targets: ["demo.widget.getAttribute"],
      lean: ["Lean.Vir.Demo.Widget.getAttribute"],
    }],
    anchors: [
      {
        id: "widget.label.get",
        lean: "Lean.Vir.Demo.Widget.getLabel",
        ts: "Widget.label",
        target: "demo.widget.getLabel",
        relation: "audit",
        portIntent: { disposition: "bind", accessor: "get" },
      },
      {
        id: "widget.label.set",
        lean: "Lean.Vir.Demo.Widget.setLabel",
        ts: "Widget.label",
        target: "demo.widget.setLabel",
        relation: "audit",
        portIntent: { disposition: "bind", accessor: "set" },
      },
    ],
  }],
};
const descriptor = {
  symbols: [{
    id: "Widget.label",
    kind: "property",
    source: { path: "demo.d.ts", startLine: 4 },
    accessors: { get: stringShape, set: nullableStringShape },
  }, {
    id: "Widget.getAttribute",
    kind: "method",
    source: { path: "demo.d.ts", startLine: 7 },
    display: "getAttribute(name: string): string | null;",
    hover: "Returns the named attribute.",
    shape: {
      kind: "function",
      effect: "pure",
      args: [{ name: "name", type: stringShape }],
      result: nullableStringShape,
    },
  }],
};
const descriptors = new Map([["widget", descriptor]]);

test("TypeScript property shapes and an ABI profile determine Lean declarations", () => {
  const output = renderLeanBindings(config, generation, descriptors);

  assert.match(output, /opaque getLabel\n    \(widget : @& Lean\.Vir\.Js Widget\) :\n    DomM \(Lean\.Vir\.Js String\)/u);
  assert.match(output, /opaque setLabel\n    \(widget : @& Lean\.Vir\.Js Widget\)\n    \(label : @& Lean\.Vir\.Js\.Nullable String\) :\n    DomM Unit/u);
  assert.match(output, /@\[vir_js "demo\.widget\.getLabel"\]/u);
  assert.match(output, /ABI profile `demo-faithful-v1`/u);
  assert.doesNotMatch(output, /\(label : @& String\)/u);
});

test("operation IR records derived modalities and their provenance", () => {
  const operations = buildGeneratedOperations(config, generation, descriptors);
  const getter = operations.find((operation) => operation.id === "widget.label.get");
  const setter = operations.find((operation) => operation.id === "widget.label.set");

  assert.deepEqual(getter.receiver.argument.modalities, {
    representation: "js-resource",
    passing: "borrowed",
    retention: "call",
  });
  assert.deepEqual(getter.result.modalities, {
    representation: "js-resource",
    ownership: "owned",
  });
  assert.deepEqual(setter.arguments[0].modalities, {
    representation: "js-resource",
    passing: "borrowed",
    retention: "call",
  });
  assert.equal(
    setter.arguments[0].provenance.retention.source,
    "generation.abiProfile.resource.argument.retention",
  );
  assert.deepEqual(setter.result.modalities, {
    representation: "immediate",
    ownership: "value",
  });
});

test("reviewed protocols generate polymorphic declarations with explicit callback retention", () => {
  const protocolGeneration = structuredClone(generation);
  protocolGeneration.members = [];
  protocolGeneration.methodPolicies = {};
  protocolGeneration.protocolOperations = [{
    id: "demo.widget.subscribe",
    group: "widget",
    target: "demo.widget.subscribe",
    lean: "Lean.Vir.Demo.Widget.subscribe",
    marker: "vir_js",
    reason: "The host retains the callback until the subscription is released.",
    typeParameters: ["α"],
    effect: { id: "dom", lean: "DomM" },
    arguments: [{
      name: "widget",
      role: "receiver",
      type: {
        lean: "Lean.Vir.Js Widget",
        representation: "js-resource",
        resourceInner: "Widget",
      },
    }, {
      name: "callback",
      role: "callback",
      passing: "owned",
      retention: "until-release",
      type: { lean: "Lean.Vir.Js α → DomM Unit", representation: "callback" },
    }],
    result: {
      type: {
        lean: "Lean.Vir.Js Subscription",
        representation: "js-resource",
        resourceInner: "Subscription",
      },
    },
  }];
  const output = renderLeanBindings(config, protocolGeneration, new Map());
  const [operation] = buildGeneratedOperations(config, protocolGeneration, new Map());

  assert.match(output, /opaque subscribe\n    \{α : Type\}\n    \(widget : @& Lean\.Vir\.Js Widget\)\n    \(callback : Lean\.Vir\.Js α → DomM Unit\)/u);
  assert.deepEqual(operation.arguments[1].modalities, {
    representation: "callback",
    passing: "owned",
    retention: "until-release",
  });
  assert.equal(
    operation.arguments[1].provenance.retention.source,
    "generation.protocolOperations",
  );
  assert.equal(
    operation.result.provenance.type[0].source,
    "generation.protocolOperations",
  );
  assert.equal(operation.exception, undefined);
  assert.deepEqual(operation.typeParameters, ["α"]);

  const protocolConfig = structuredClone(config);
  protocolConfig.generation = protocolGeneration;
  protocolConfig.roots[0].anchors = [{
    id: "widget.subscribe",
    lean: "Lean.Vir.Demo.Widget.subscribe",
    ts: "Widget.subscribe",
    target: "demo.widget.subscribe",
    relation: "audit",
    portIntent: { disposition: "bind" },
  }];
  const [anchor] = materializeGeneratedAnchors(
    protocolConfig,
    protocolConfig.roots[0],
    descriptor,
    { version: 1, anchors: protocolConfig.roots[0].anchors },
  ).anchors;
  assert.deepEqual(anchor.portIntent, {
    disposition: "bind",
    effect: "dom",
    receiver: "borrowed",
    resultRepresentation: "hostResource",
  });
  assert.equal(anchor.modalityContract.protocol.reason, protocolGeneration.protocolOperations[0].reason);
});

test("an explicit single-signature policy generates faithful methods and documentation", () => {
  const output = renderLeanBindings(config, generation, descriptors);
  const operations = buildGeneratedOperations(config, generation, descriptors);
  const method = operations.find((operation) => operation.id === "demo.widget.getAttribute");

  assert.match(output, /opaque getAttribute\n    \(widget : @& Lean\.Vir\.Js Widget\)\n    \(name : @& Lean\.Vir\.Js String\) :\n    DomM \(Lean\.Vir\.Js\.Nullable String\)/u);
  assert.match(output, /Returns the named attribute\./u);
  assert.equal(method.typescript.signaturePolicy.selection, "only");
  assert.equal(method.typescript.documentation, "Returns the named attribute.");
  assert.deepEqual(method.arguments[0].modalities, {
    representation: "js-resource",
    passing: "borrowed",
    retention: "call",
  });
});

test("generated exceptions are documented as reviewed specializations", () => {
  const specialized = structuredClone(generation);
  specialized.exceptions["demo.widget.getAttribute"] = {
    reason: "The demo specializes the result representation.",
    result: {
      type: {
        lean: "Lean.Vir.Js String",
        representation: "js-resource",
        resourceInner: "String",
      },
    },
  };
  const output = renderLeanBindings(config, specialized, descriptors);

  assert.match(
    output,
    /Generated reviewed method specialization of TypeScript `Widget\.getAttribute`\./u,
  );
  assert.doesNotMatch(
    output,
    /Faithful generated method binding for TypeScript `Widget\.getAttribute`\./u,
  );
});

test("TypeScript parameter names that are Lean keywords are escaped", () => {
  const keywordDescriptors = structuredClone(descriptors);
  const method = keywordDescriptors.get("widget").symbols.find((symbol) =>
    symbol.id === "Widget.getAttribute");
  method.shape.args[0].name = "namespace";

  const output = renderLeanBindings(config, generation, keywordDescriptors);

  assert.match(output, /\(«namespace» : @& Lean\.Vir\.Js String\)/u);
  assert.match(output, /opaque getAttribute/u);
});

test("method generation fails closed without a matching signature policy", () => {
  const unreviewed = structuredClone(generation);
  delete unreviewed.methodPolicies["Widget.getAttribute"];
  assert.throws(
    () => renderLeanBindings(config, unreviewed, descriptors),
    /requires an explicit generation\.methodPolicies entry/u,
  );

  const overloadedDescriptors = structuredClone(descriptors);
  const method = overloadedDescriptors.get("widget").symbols.find((symbol) =>
    symbol.id === "Widget.getAttribute");
  method.shape = { kind: "union", options: [method.shape, method.shape] };
  assert.throws(
    () => renderLeanBindings(config, generation, overloadedDescriptors),
    /requires exactly one TypeScript signature/u,
  );
});

test("optional method parameters require an explicit trailing omission", () => {
  const optionalGeneration = structuredClone(generation);
  optionalGeneration.methodPolicies["Widget.getAttribute"].omittedOptionalParameters = ["mode"];
  const optionalDescriptors = structuredClone(descriptors);
  const method = optionalDescriptors.get("widget").symbols.find((symbol) =>
    symbol.id === "Widget.getAttribute");
  method.shape.args.push({ name: "mode", optional: true, type: stringShape });

  const operation = buildGeneratedOperations(config, optionalGeneration, optionalDescriptors)
    .find((candidate) => candidate.id === "demo.widget.getAttribute");
  assert.deepEqual(operation.typescript.signaturePolicy.omittedOptionalParameters, ["mode"]);
  assert.deepEqual(operation.arguments.map((argument) => argument.name), ["name"]);

  method.shape.args.push({ name: "requiredAfter", type: stringShape });
  assert.throws(
    () => buildGeneratedOperations(config, optionalGeneration, optionalDescriptors),
    /cannot omit an optional parameter before requiredAfter/u,
  );
});

test("generated anchors project comparator intent from operation IR", () => {
  const root = config.roots[0];
  const materialized = materializeGeneratedAnchors(
    config,
    root,
    descriptor,
    { version: 1, anchors: root.anchors },
  );
  const getter = materialized.anchors.find((anchor) => anchor.id === "widget.label.get");
  const setter = materialized.anchors.find((anchor) => anchor.id === "widget.label.set");

  assert.deepEqual(getter.portIntent, {
    disposition: "bind",
    accessor: "get",
    effect: "dom",
    receiver: "borrowed",
    resultRepresentation: "hostResource",
  });
  assert.deepEqual(setter.portIntent, {
    disposition: "bind",
    accessor: "set",
    effect: "dom",
    receiver: "borrowed",
    resourceArguments: [0],
  });
  assert.equal(getter.modalityContract.profile, "demo-faithful-v1");
  assert.equal(getter.modalityContract.source, "generated-operation-ir");
});

test("unsupported TypeScript shapes fail closed", () => {
  assert.throws(
    () => leanType({ kind: "primitive", name: "boolean" }, generation, "Widget.enabled"),
    /unsupported faithful translation/u,
  );
});

test("exceptions cannot retain a borrowed resource beyond the call", () => {
  const unsafeGeneration = structuredClone(generation);
  unsafeGeneration.exceptions["widget.label.set"] = {
    reason: "The host stores this value.",
    arguments: { label: { retention: "runtime" } },
  };

  assert.throws(
    () => renderLeanBindings(config, unsafeGeneration, descriptors),
    /cannot retain a borrowed resource beyond the call/u,
  );
});

test("exceptions must contain a concrete, justified override", () => {
  const emptyException = structuredClone(generation);
  emptyException.exceptions["widget.label.get"] = { reason: "No policy change." };

  assert.throws(
    () => renderLeanBindings(config, emptyException, descriptors),
    /must define an override/u,
  );
});

test("anchors cannot author modalities derived by generation", () => {
  const authored = structuredClone(config);
  authored.roots[0].anchors[0].portIntent.receiver = "borrowed";

  assert.throws(
    () => materializeGeneratedAnchors(
      authored,
      authored.roots[0],
      descriptor,
      { version: 1, anchors: authored.roots[0].anchors },
    ),
    /authors derived modality field portIntent\.receiver/u,
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
