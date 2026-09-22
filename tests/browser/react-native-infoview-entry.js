/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { createRoot } from "react-dom/client";
import { TaggedText_stripTags } from "@leanprover/infoview-api";
import { createVirRuntime } from "../../web/src/vir-runtime.js";
import { createBrowserHostBindings } from "../../web/src/vir-host-bindings.js";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";
import {
  createMovedNativePanelFixture,
  createNativePanelFixture,
} from "../support/native-panel-fixtures.mjs";

globalThis.runProofWidgetsNativeChildren = async (wasm, pkg) => {
  const hostBindings = createBrowserHostBindings({
    reactHostBindings: createBrowserReactHostBindings,
    infoviewStripTags: code => TaggedText_stripTags(code),
  });
  const trace = [];
  let traceConstruction = false;
  let mapElementProbe = null;
  let lastMap;
  let mapCalls = 0;
  let fragmentChildren;
  const fragment = hostBindings["react.node.fragment"];
  hostBindings["react.node.fragment"] = (props, children) => {
    fragmentChildren = children;
    return fragment(props, children);
  };
  const map = hostBindings["js.array.map"];
  hostBindings["js.array.map"] = (array, callback) => {
    mapCalls++;
    const result = map(array, callback);
    lastMap = { array, result };
    return result;
  };
  const setProperty = hostBindings["js.construction.field"];
  let literalWrites = 0;
  let loweredObjects = 0;
  let loweredArrays = 0;
  const withInheritedSetter = (object, name, value, write) => {
    const original = Object.getPrototypeOf(object);
    const inherited = Object.create(original);
    let setterCalls = 0;
    Object.defineProperty(inherited, name, { set() { setterCalls++; }, configurable: true });
    Object.setPrototypeOf(object, inherited);
    try { write(); } finally { Object.setPrototypeOf(object, original); }
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    check(setterCalls === 0 && descriptor?.value === value && descriptor.writable &&
      descriptor.enumerable && descriptor.configurable,
    "real Lean literal lowering defines own data properties without inherited setters");
    literalWrites++;
  };
  hostBindings["js.construction.field"] = (object, name, value) => {
    if (traceConstruction) trace.push(name);
    if (traceConstruction) return withInheritedSetter(object, name, value,
      () => setProperty(object, name, value));
    return setProperty(object, name, value);
  };
  const appendElement = hostBindings["js.construction.element"];
  hostBindings["js.construction.element"] = (array, value) => traceConstruction
    ? withInheritedSetter(array, String(array.length), value, () => appendElement(array, value))
    : appendElement(array, value);
  const objectFromFields = hostBindings["js.construction.objectFromFields"];
  let objectCallCount = 0;
  hostBindings["js.construction.objectFromFields"] = fields => {
    objectCallCount++;
    const result = objectFromFields(fields);
    if (traceConstruction) {
      loweredObjects++;
      for (const { fst: name, snd: value } of fields) {
        trace.push(name);
        const descriptor = Object.getOwnPropertyDescriptor(result, name);
        check(descriptor?.value === value && descriptor.writable && descriptor.enumerable &&
          descriptor.configurable, "batched JSX props are own data properties");
      }
    }
    return result;
  };
  const arrayFromValues = hostBindings["js.construction.arrayFromValues"];
  let arrayCallCount = 0;
  hostBindings["js.construction.arrayFromValues"] = values => {
    arrayCallCount++;
    const result = arrayFromValues(values);
    if (traceConstruction) {
      loweredArrays++;
      check(result === values && values.every((value, index) =>
        Object.getOwnPropertyDescriptor(values, index)?.value === value),
      "batched JSX children retain their own dense native array");
    }
    return result;
  };
  check(!Object.hasOwn(hostBindings, "react.node.text") &&
    !Object.hasOwn(hostBindings, "react.elementType.tag"),
  "native text and tag views need no host providers");
  const createElement = hostBindings["react.node.createElement"];
  hostBindings["react.node.createElement"] = (type, props, children) => {
    mapElementProbe?.(type, props);
    if (traceConstruction) trace.push(typeof type === "string" ? `element:${type}` : "element:component");
    return createElement(type, props, children);
  };
  const runtime = await createVirRuntime({
    wasmModule: new WebAssembly.Module(new Uint8Array(wasm)),
    irPackageSet: [new Uint8Array(pkg)],
    hostBindings,
  });
  const iterateCallbacks = runtime.liveCallbacks[Symbol.iterator];
  let callbackRegistryScans = 0;
  runtime.liveCallbacks[Symbol.iterator] = function* () {
    callbackRegistryScans++;
    yield* iterateCallbacks.call(this);
  };
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const previousTitle = document.title;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // The full page suite leaves an older Tamagotchi mounted and toggled to pet.
  const peer = document.createElement("div");
  peer.id = "native-peer-pet";
  const fixtures = document.createElement("div");
  document.body.append(peer, fixtures);
  const query = selector => fixtures.querySelector(selector);
  try {
    await React.act(async () => check(runtime.call("ReactTamagotchi.mount", `#${peer.id}`),
      "peer Tamagotchi mounts"));
    check(callbackRegistryScans === 0 && runtime.liveCallbacks.size > 0,
      "real Lean callbacks own closure roots without a per-call registry census");
    await React.act(async () => peer.querySelector("#react-pet-art-toggle").click());
    check(peer.querySelector("#react-pet-device").dataset.art === "pet",
      "peer has different state before the authoring probe");
    const component = props => props.children;
    const payload = { color: "red" };
    const label = "native JSX value \ud800"; // A lone surrogate must not round-trip through UTF-8.
    const callback = () => {};
    const tupleTrace = [];
    const tupleNode = React.createElement("span", null, "tuple");
    const tupleSource = () => {
      tupleTrace.push("source");
      return {
        get 0() { tupleTrace.push(0); return tupleNode; },
        get 1() { tupleTrace.push(1); return label; },
        [Symbol.iterator]() { throw new Error("indexed notation must not iterate"); },
      };
    };
    check(runtime.call("ProofWidgetsJsxSubset.nativeTuple", tupleSource, label) === tupleNode &&
      JSON.stringify(tupleTrace) === JSON.stringify(["source", 0, 1]),
    "tuple notation evaluates its source once, then reads exact positions in order");
    for (const failureAt of ["source", 0, 1]) {
      tupleTrace.length = 0;
      const failure = new Error(`tuple failure at ${failureAt}`);
      const read = key => {
        tupleTrace.push(key);
        if (key === failureAt) throw failure;
      };
      let caught;
      try {
        runtime.call("ProofWidgetsJsxSubset.nativeTuple", () => {
          read("source");
          return { get 0() { read(0); return tupleNode; }, get 1() { read(1); return label; } };
        }, label);
      } catch (error) { caught = error; }
      const expected = ["source", 0, 1].slice(0, ["source", 0, 1].indexOf(failureAt) + 1);
      check(caught === failure && JSON.stringify(tupleTrace) === JSON.stringify(expected),
        "tuple projection preserves error identity and stops at the first failure");
    }
    traceConstruction = true;
    callbackRegistryScans = 0;
    const node = runtime.call("ProofWidgetsJsxSubset.nativeConstruction",
      component, payload, label, callback);
    traceConstruction = false;
    check(callbackRegistryScans === 0,
      "native construction must not scan existing callbacks");
    check(JSON.stringify(trace) === JSON.stringify([
      "label", "label", "payload", "onClick", "values", "title", "style", "onClick",
      "element:span", "element:component",
    ]), "native construction evaluates fields once in order before child actions");
    check(node.type === component, "uppercase JSX must preserve native component identity");
    check(node.props.label === label, "native object writes use the last duplicate field");
    check(node.props.payload === payload && node.props.onClick === callback,
      "native JSX props must not box, clone or convert their nested inputs");
    check(Array.isArray(node.props.values) && node.props.values.length === 2 &&
      node.props.values.every(value => value === label), "native array notation preserves exact values");
    check(node.props.children.props.title === label &&
      node.props.children.props.style === payload &&
      node.props.children.props.onClick === callback &&
      node.props.children.props.children === label,
    "native attributes and text must reach official React unchanged");
    trace.length = 0;
    traceConstruction = true;
    const typed = runtime.call("ProofWidgetsJsxSubset.nativeTypedConstruction",
      component, payload, label, callback);
    traceConstruction = false;
    check(JSON.stringify(trace) === JSON.stringify(["label", "payload", "onClick", "values", "element:component"]),
      "typed JSX performs only ordered native field writes, with no Lean record encoding");
    check(typed.type === component && typed.props.label === label &&
      typed.props.payload === payload && typed.props.onClick === callback &&
      typed.props.values.length === 2 && typed.props.values.every(value => value === label),
    "typed native props preserve exact inputs");
    const order = [];
    const orderEntry = "ProofWidgetsJsxSubset.nativeConstructionOrder";
    const ordered = runtime.call(orderEntry, value => order.push(value), "first", "second", "child");
    check(JSON.stringify(order) === JSON.stringify(["first", "second", "child"]) &&
      ordered.props["data-first"] === "first" && ordered.props["data-second"] === "second" &&
      ordered.props.children === "child",
    "JSX evaluates attributes in order, then children after defining props");
    const beforeAttributeFailure = objectCallCount;
    const attributeFailure = new Error("JSX attribute evaluation failed");
    let caught;
    try {
      runtime.call(orderEntry, value => {
        order.push(value);
        throw attributeFailure;
      }, "first", "second", "child");
    } catch (error) { caught = error; }
    check(caught === attributeFailure && order.at(-1) === "first" &&
      objectCallCount === beforeAttributeFailure,
    "a failing attribute prevents props construction and child evaluation");
    const definitionFailure = new Error("JSX property definition failed");
    const defineProperty = Object.defineProperty;
    const beforeDefinitionFailure = objectCallCount;
    try {
      Object.defineProperty = (target, name, descriptor) => {
        if (name === "data-first") throw definitionFailure;
        return defineProperty(target, name, descriptor);
      };
      caught = undefined;
      try {
        runtime.call(orderEntry, value => order.push(value), "first", "second", "child");
      } catch (error) { caught = error; }
    } finally { Object.defineProperty = defineProperty; }
    check(caught === definitionFailure &&
      JSON.stringify(order.slice(-2)) === JSON.stringify(["first", "second"]) &&
      objectCallCount === beforeDefinitionFailure + 1,
    "definition failure follows all attribute effects but prevents child effects");
    const childEntry = "ProofWidgetsJsxSubset.nativeChildConstructionOrder";
    const childOrder = [];
    const twoChildren = runtime.call(childEntry, value => childOrder.push(value), "first", "second");
    check(JSON.stringify(childOrder) === JSON.stringify(["first", "second"]) &&
      JSON.stringify(twoChildren.props.children) === JSON.stringify(["first", "second"]),
    "JSX evaluates two child actions once and preserves their order");
    const beforeChildExpressionFailure = arrayCallCount;
    const childExpressionFailure = new Error("JSX child evaluation failed");
    caught = undefined;
    try {
      runtime.call(childEntry, value => {
        childOrder.push(value);
        if (value === "first") throw childExpressionFailure;
      }, "first", "second");
    } catch (error) { caught = error; }
    check(caught === childExpressionFailure && childOrder.at(-1) === "first" &&
      arrayCallCount === beforeChildExpressionFailure,
    "a failing first child prevents later child effects and array publication");
    const childDefinitionFailure = new Error("JSX child array definition failed");
    const beforeChildDefinitionFailure = arrayCallCount;
    try {
      Object.defineProperty = (target, name, descriptor) => {
        if (Array.isArray(target) && name === 0 && descriptor.value === "first")
          throw childDefinitionFailure;
        return defineProperty(target, name, descriptor);
      };
      caught = undefined;
      try {
        runtime.call(childEntry, value => childOrder.push(value), "first", "second");
      } catch (error) { caught = error; }
    } finally { Object.defineProperty = defineProperty; }
    check(caught === childDefinitionFailure &&
      JSON.stringify(childOrder.slice(-2)) === JSON.stringify(["first", "second"]) &&
      arrayCallCount === beforeChildDefinitionFailure,
    "array definition failure follows both child effects and prevents publication");
    check(literalWrites > 5 && loweredObjects >= 2 && loweredArrays >= 2,
      "own-property regression exercises literal and batched JSX lowering");
    let reads = 0;
    check(runtime.call("ProofWidgetsJsxSubset.nativeTypedLabel", {
      get label() { reads++; return label; },
    }) === label && reads === 1, "declared-field projection performs one native property read");
    const fieldFailure = new Error("typed field getter failed");
    let thrown;
    try {
      runtime.call("ProofWidgetsJsxSubset.nativeTypedLabel", { get label() { throw fieldFailure; } });
    } catch (error) { thrown = error; }
    check(thrown === fieldFailure, "declared-field projection preserves native getter exceptions");
    const optionalPrefix = "Vir.Fixtures.OptionalProps.";
    for (const [entry, args, hasTitle, title, projector] of [
      ["omitted", [], false, undefined, "readTitle"],
      ["present", [label], true, label, "readTitle"],
      ["requiredUndefined", [undefined], true, undefined, "readUndefinedTitle"],
      ["optionalUndefined", [undefined], true, undefined, "readUndefinedTitle"],
      ["optionalUndefined", [label], true, label, "readUndefinedTitle"],
      ["omittedUndefined", [], false, undefined, "readUndefinedTitle"],
      ["nullable", [null], true, null, "readNullableTitle"],
      ["nullable", [label], true, label, "readNullableTitle"],
      ["omittedNullable", [], false, undefined, "readNullableTitle"],
    ]) {
      const optionalNode = runtime.call(optionalPrefix + entry, component, ...args);
      check(optionalNode.type === component && Object.hasOwn(optionalNode.props, "title") === hasTitle &&
        optionalNode.props.title === title,
      `${entry} preserves component identity and distinguishes omitted, undefined and null props`);
      check(runtime.call(optionalPrefix + projector, optionalNode.props) === title,
        `${projector} reads the exact present or absent native value`);
      let optionalReads = 0;
      check(runtime.call(optionalPrefix + projector, {
        get title() { optionalReads++; return title; },
      }) === title && optionalReads === 1,
      `${projector} performs exactly one native getter read`);
    }
    const optionalContainer = document.createElement("div");
    fixtures.append(optionalContainer);
    const optionalRoot = createRoot(optionalContainer);
    const optionalComponent = runtime.call(optionalPrefix + "component");
    try {
      await React.act(async () => optionalRoot.render(runtime.call(optionalPrefix + "omitted", optionalComponent)));
      const span = optionalContainer.querySelector("span");
      check(span && span.textContent === "", "the Lean optional-prop component renders an absent title");
      await React.act(async () => optionalRoot.render(runtime.call(optionalPrefix + "present", optionalComponent, label)));
      check(optionalContainer.querySelector("span") === span && span.textContent === label,
        "the Lean optional-prop component renders the exact supplied string without remounting");
      await React.act(async () => optionalRoot.render(runtime.call(optionalPrefix + "omitted", optionalComponent)));
      check(optionalContainer.querySelector("span") === span && span.textContent === "",
        "omitting a previously supplied prop removes its rendered value");
    } finally {
      await React.act(async () => optionalRoot.unmount());
    }
    check(runtime.call("ProofWidgetsJsxSubset.nativeStringLength", "") === 0 &&
      runtime.call("ProofWidgetsJsxSubset.nativeStringLength", "😀") === 2,
    "native string length is UTF-16 length, not decoded Lean character count");
    const body = React.createElement("b", null, "body");
    const tail = React.createElement("i", null, "tail");
    const nested = [React.createElement("span", { key: "nested" }, "nested")];
    const slots = runtime.call("ProofWidgetsJsxSubset.nativeChildSlots", body, label, nested, tail);
    check(slots.props.children[0] === body && slots.props.children[1] === label &&
      slots.props.children[2] === nested && slots.props.children[3] === tail && nested.length === 1,
    "native JSX inserts exact child values without flattening, copying or UTF-8 conversion");
    const labels = ["first", , label];
    const mapped = runtime.call("ProofWidgetsJsxSubset.nativeMappedChildren", labels);
    check(mapCalls === 1 && lastMap.array === labels && lastMap.result === mapped.props.children &&
      Array.isArray(mapped.props.children) && mapped.props.children.length === 3 &&
      !(1 in mapped.props.children) && labels.length === 3 && !(1 in labels) &&
      mapped.props.children[0].key === "first" && mapped.props.children[2].key === label &&
      mapped.props.children[2].props.children === label,
    "native map enters the Lean callback and preserves holes, keys, strings and the input array");
    const mapFailure = new Error("mapped element failed");
    const visited = [];
    // Host bindings are installed at runtime creation; the existing spy reads this switch.
    mapElementProbe = (type, props) => {
      if (type !== "span") return;
      visited.push(props.key);
      if (props.key === "fail") throw mapFailure;
    };
    thrown = undefined;
    try {
      runtime.call("ProofWidgetsJsxSubset.nativeMappedChildren", ["before", "fail", "after"]);
    } catch (error) { thrown = error; }
    finally { mapElementProbe = null; }
    check(thrown === mapFailure && visited.join(",") === "before,fail",
      "mapped Lean callback preserves the original error and stops subsequent elements");
    const indexed = runtime.call("ProofWidgetsJsxSubset.nativeIndexedMap", labels);
    check(indexed.length === 3 && !(1 in indexed) && indexed[0].index === 0 &&
      indexed[2].index === 2 && indexed[2].value === label &&
      indexed[0].source === labels && indexed[2].source === labels,
    "ternary Lean callback receives the exact native index, source and value");
    const nestedText = ["native", null];
    const primitives = runtime.call("ProofWidgetsJsxSubset.nativePrimitiveChildren",
      null, undefined, false, -0, 7n, nestedText);
    const primitiveChildren = primitives.props.children;
    check(primitiveChildren[0] === null && primitiveChildren[1] === undefined &&
      primitiveChildren[2] === false && Object.is(primitiveChildren[3], -0) &&
      primitiveChildren[4] === 7n && primitiveChildren[5] === nestedText,
    "JSX preserves empty values, booleans, numbers, bigints and nested native arrays");
    trace.length = 0;
    traceConstruction = true;
    const literals = runtime.call("ProofWidgetsJsxSubset.nativeLiteralConstruction");
    traceConstruction = false;
    check(literals.props.title === "native" && literals.props["data-props"].title === "native" &&
      literals.props["data-props"].values.join(",") === "a,b" &&
      trace.join(",") === "title,values,title,data-props,element:span",
    "one literal lowering rule preserves ordered object, array and JSX construction through parentheses");
    const arrayContainer = document.createElement("div");
    fixtures.append(arrayContainer);
    const arrayRoot = createRoot(arrayContainer);
    try {
      const directValues = Object.freeze(["direct", null, , undefined, " array"]);
      const directNode = runtime.call("ProofWidgetsJsxSubset.nativeNodeArray", directValues);
      check(directNode === directValues && !(2 in directValues),
        "explicit Node.ofJs preserves the exact frozen native array and holes");
      const unread = new Proxy([], { get() { throw new Error("node widening read its payload"); } });
      check(runtime.call("ProofWidgetsJsxSubset.nativeNodeArray", unread) === unread,
        "explicit Node.ofJs does not traverse or inspect native arrays");
      await React.act(async () => arrayRoot.render(directNode));
      check(arrayContainer.textContent === "direct array",
        "official React accepts the widened array directly outside JSX");
      const directRoot = { render(value) {
        check(this === directRoot && value === directValues,
          "constrained Root.render preserves receiver and exact array argument");
        arrayRoot.render(value);
      } };
      await React.act(async () => runtime.call("ProofWidgetsJsxSubset.nativeRender", directRoot, directValues));
      check(arrayContainer.textContent === "direct array",
        "constrained Lean Root.render reaches official React with no client cast");
      const textChildren = Object.freeze(["a", "b"]);
      const textFragment = runtime.call("ProofWidgetsJsxSubset.nativeTextFragment", {}, textChildren);
      check(fragmentChildren === textChildren && textFragment.type === React.Fragment &&
        textFragment.props.children.join("") === "ab",
        "constrained fragment accepts native string children without text wrappers");
      await React.act(async () => arrayRoot.render(primitives));
      check(arrayContainer.textContent === "07native",
        "official React renders native primitive/empty children without VIR formatting");
      const present = runtime.call("ProofWidgetsJsxSubset.nativePrimitiveChildren",
        body, undefined, true, 2, 3n, nestedText);
      check(present.props.children[0] === body, "nullable child widening preserves the present node");
      await React.act(async () => arrayRoot.render(runtime.call(
        "ProofWidgetsJsxSubset.nativeMappedChildren", ["a", "b"])));
      const firstSpan = arrayContainer.querySelector("span");
      await React.act(async () => arrayRoot.render(runtime.call(
        "ProofWidgetsJsxSubset.nativeMappedChildren", ["b", "a"])));
      check(arrayContainer.querySelectorAll("span")[1] === firstSpan,
        "keys from native map preserve DOM identity across reordering");
      let mounts = 0;
      function Stateful({ name }) {
        const [identity] = React.useState(() => ++mounts);
        return React.createElement("span", { "data-name": name }, identity);
      }
      const children = names => names.map(name => React.createElement(Stateful, { key: name, name }));
      await React.act(async () => arrayRoot.render(runtime.call(
        "ProofWidgetsJsxSubset.nativeChildSlots", body, "", children(["a", "b"]), null)));
      const a = arrayContainer.querySelector('[data-name="a"]');
      const identity = a.textContent;
      await React.act(async () => arrayRoot.render(runtime.call(
        "ProofWidgetsJsxSubset.nativeChildSlots", body, "", children(["b", "a"]), tail)));
      check(mounts === 2 && arrayContainer.querySelector('[data-name="a"]') === a &&
        a.textContent === identity,
      "stable native array and optional sibling slots preserve keyed component state");
      const keyed = names => runtime.call("ProofWidgetsJsxSubset.nativeKeyedChildren", Stateful, names);
      const keyedNode = keyed(["a", "b"]);
      check(keyedNode.props.children[0].key === "a" &&
        keyedNode.props.children[0].props.name === "a" &&
        Object.getOwnPropertyDescriptor(keyedNode.props.children[0].props, "key")?.value === undefined,
      "typed JSX key belongs to React element metadata, not component data");
      await React.act(async () => arrayRoot.render(keyedNode));
      const keyedA = arrayContainer.querySelector('[data-name="a"]');
      const keyedMounts = mounts;
      await React.act(async () => arrayRoot.render(keyed(["b", "a"])));
      check(mounts === keyedMounts && arrayContainer.querySelectorAll("span")[1] === keyedA,
        "typed JSX keys preserve component state and DOM identity across native map reorder");
    } finally {
      await React.act(async () => arrayRoot.unmount());
    }
    for (const [entry, id] of [["ProofWidgetsHtml.mount", "native-html"],
      ["ProofWidgetsJsxSubset.mount", "native-jsx"]]) {
      const container = document.createElement("div");
      container.id = id;
      fixtures.append(container);
      await React.act(async () => check(runtime.call(entry, `#${id}`), `${entry} mounts`));
    }
    check(query("#native-html").querySelectorAll(".pw-html-stat").length === 3,
      "explicit Lean data fields must survive native React props copying");
    const jsx = query("#native-jsx");
    check(jsx.querySelector(".pw-jsx-card-title").textContent === "JSX-shaped combinators",
      "typed JSX props reach the native component");
    check(jsx.querySelectorAll(".pw-jsx-row").length === 3,
      "multiple native children remain in the Card subtree");
    check(jsx.querySelector("#proofwidgets-jsx-badge-info").textContent.includes("component children"),
      "a single native text child remains in the Badge subtree");
    await React.act(async () => jsx.querySelector("#proofwidgets-jsx-action").click());
    check(document.title === "ProofWidgets JSX subset clicked", "nested child callback enters Lean");
    for (const strict of [false, true]) {
      const container = document.createElement("div");
      fixtures.append(container);
      const root = createRoot(container);
      const initial = { text: "initialized" };
      const action = ":updated";
      const initialized = [];
      const reduced = [];
      const initializer = function (argument) {
        "use strict";
        initialized.push({ argument, args: [...arguments], receiver: this });
        return argument.text;
      };
      const reducer = function (state, next) {
        "use strict";
        reduced.push({ state, action: next, args: [...arguments], receiver: this });
        return state + next;
      };
      const component = runtime.call("ReactCounter.reducerInitializerProbe", reducer, initial, initializer, action);
      const useReducer = hostBindings["react.useReducerWithInit"];
      const seen = [];
      hostBindings["react.useReducerWithInit"] = (receivedReducer, receivedInitial, receivedInitializer) => {
        const result = useReducer(receivedReducer, receivedInitial, receivedInitializer);
        seen.push({ reducer: receivedReducer, initial: receivedInitial, initializer: receivedInitializer, result });
        return result;
      };
      const render = tick => React.createElement(strict ? React.StrictMode : React.Fragment,
        null, React.createElement(component, { tick }));
      try {
        await React.act(async () => root.render(render(0)));
        const mountCalls = initialized.length;
        const button = container.querySelector("button");
        check(mountCalls === (strict ? 2 : 1) && button.textContent === "initialized" && reduced.length === 0,
          "React owns reducer initialization and StrictMode replay at mount");
        check(initialized.every(call => call.argument === initial && call.args.length === 1 &&
          call.receiver === undefined), "reducer initializer receives the exact argument once per React invocation");
        initial.text = "not reinitialized";
        await React.act(async () => root.render(render(1)));
        check(initialized.length === mountCalls && container.querySelector("button") === button &&
          button.textContent === "initialized", "ordinary rerenders do not reinitialize reducer state");
        await React.act(async () => button.click());
        check(button.textContent === "initialized:updated" && initialized.length === mountCalls &&
          reduced.length > 0 && reduced.every(call => call.state === "initialized" &&
            call.action === action && call.args.length === 2 && call.receiver === undefined),
        "Lean dispatch forwards the exact action and React updates reducer state without reinitializing");
        const dispatch = seen[0].result[1];
        check(seen.length >= 3 && seen.every(call => call.reducer === reducer && call.initial === initial &&
          call.initializer === initializer && call.result[1] === dispatch),
        "reducer hook inputs and React dispatch identity survive rerenders and state updates");
      } finally {
        hostBindings["react.useReducerWithInit"] = useReducer;
        await React.act(async () => root.unmount());
      }
    }
    for (const strict of [false, true]) {
      const container = document.createElement("div");
      fixtures.append(container);
      const root = createRoot(container);
      let calls = 0;
      let initial = "lazy";
      const initializer = () => { calls++; return initial; };
      const clicks = [];
      const handler = value => { clicks.push(value); };
      const component = runtime.call("ReactCounter.initialProbe", "eager:", initializer, handler);
      const useState = hostBindings["react.useState"];
      const seen = [];
      hostBindings["react.useState"] = argument => {
        const result = useState(argument);
        seen.push({ argument, value: result[0] });
        return result;
      };
      const render = tick => React.createElement(strict ? React.StrictMode : React.Fragment,
        null, React.createElement(component, { tick }));
      try {
        await React.act(async () => root.render(render(0)));
        const mountCalls = calls;
        check(mountCalls === (strict ? 2 : 1), "React owns lazy initializer replay");
        const button = container.querySelector("button");
        check(button.textContent === "eager:lazy" && clicks.length === 0,
          "initialization stores values and does not call the function-valued state");
        initial = "changed";
        await React.act(async () => root.render(render(1)));
        check(calls === mountCalls && container.querySelector("button") === button &&
          button.textContent === "eager:lazy", "rerenders preserve state without calling initializers");
        check(seen.length >= 6 && seen.length % 3 === 0, "each render forwards three native state inputs");
        for (let index = 0; index < seen.length; index += 3) {
          check(seen[index].argument === "eager:" && seen[index + 1].argument === initializer,
            "union membership passes exact eager value and native initializer");
          check(seen[index + 2].argument !== handler &&
            typeof seen[index + 2].argument === "function" && seen[index + 2].value === handler,
          "Lean explicitly constructs a thunk; React stores the original handler");
        }
        await React.act(async () => button.click());
        check(clicks.length === 1 && clicks[0] === "lazy", "stored native function is callable after rerender");
      } finally {
        hostBindings["react.useState"] = useState;
        await React.act(async () => root.unmount());
      }
    }
    for (const strict of [false, true]) {
      const container = document.createElement("div");
      fixtures.append(container);
      const root = createRoot(container);
      const calls = [];
      const nullary = function () { "use strict"; calls.push(["nullary", [...arguments], this]); return "zero:"; };
      const unary = function (value) { "use strict"; calls.push(["unary", [...arguments], this]); return `${value}:`; };
      const binary = function (first, second) {
        "use strict";
        calls.push(["binary", [...arguments], this]); return `${first}/${second}:`;
      };
      const ternary = function (first, second, third) {
        "use strict";
        calls.push(["ternary", [...arguments], this]); return `${first}/${second}/${third}`;
      };
      const nativeCallbacks = [nullary, unary, binary, ternary];
      const useCallback = hostBindings["react.useCallback"];
      const selected = [];
      hostBindings["react.useCallback"] = (callback, deps) => {
        const result = useCallback(callback, deps);
        selected.push({ callback, deps, result });
        return result;
      };
      const component = runtime.call("ReactCounter.callbackShapeProbe", ...nativeCallbacks);
      const render = tick => React.createElement(strict ? React.StrictMode : React.Fragment,
        null, React.createElement(component, { tick }));
      try {
        await React.act(async () => root.render(render(0)));
        const mountCalls = calls.length;
        check(mountCalls === (strict ? 8 : 4) && container.textContent === "zero:one:two/three:four/five/six",
          "generic useCallback invokes all native function arities with their exact results");
        check(selected.length === mountCalls && selected.every(({ callback, deps, result }, index) =>
          callback === nativeCallbacks[index % 4] && result === callback && Array.isArray(deps) && deps.length === 0),
        "useCallback preserves each native function identity and native empty dependencies");
        for (const [index, expected] of [["nullary", []], ["unary", ["one"]],
          ["binary", ["two", "three"]], ["ternary", ["four", "five", "six"]]].entries()) {
          const observed = calls[index];
          check(observed[0] === expected[0] && JSON.stringify(observed[1]) === JSON.stringify(expected[1]) &&
            observed[2] === undefined, `${expected[0]} has exact plain-call arguments and no receiver`);
        }
        await React.act(async () => root.render(render(1)));
        const updateCalls = strict ? 8 : 4;
        check(calls.length === mountCalls + updateCalls && selected.slice(-updateCalls).every(({ callback, result }, index) =>
          callback === nativeCallbacks[index % 4] && result === callback),
        "native callback identity survives a component rerender");
      } finally {
        hostBindings["react.useCallback"] = useCallback;
        await React.act(async () => root.unmount());
      }
    }
    const eventContainer = document.createElement("div");
    fixtures.append(eventContainer);
    const eventRoot = createRoot(eventContainer);
    const eventCalls = [];
    const eventProviders = new Map();
    for (const member of ["nativeEvent", "currentTarget", "preventDefault", "stopPropagation"]) {
      const key = `react.syntheticEvent.${member}`;
      const provider = hostBindings[key];
      eventProviders.set(key, provider);
      hostBindings[key] = event => {
        const result = provider(event);
        eventCalls.push({ member, event, result });
        return result;
      };
    }
    let receivedEvent;
    let eventParents = 0;
    const eventComponent = runtime.call("ReactCounter.eventProbe", event => {
      receivedEvent = event;
      check(event.currentTarget === eventContainer.querySelector("button"),
        "React currentTarget is the handler element during the Lean callback");
    });
    try {
      await React.act(async () => eventRoot.render(React.createElement("div", {
        onClick: () => { eventParents++; },
      }, React.createElement(eventComponent))));
      const nativeEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
      const target = eventContainer.querySelector("span");
      let accepted;
      await React.act(async () => { accepted = target.dispatchEvent(nativeEvent); });
      check(receivedEvent !== nativeEvent && !(receivedEvent instanceof Event) &&
        receivedEvent.nativeEvent === nativeEvent && receivedEvent.target === target,
      "the Lean callback receives React's exact synthetic event, distinct from nativeEvent");
      check(eventCalls.length === 4 && eventCalls.every(call => call.event === receivedEvent) &&
        eventCalls[0].result === nativeEvent &&
        eventCalls[1].result === eventContainer.querySelector("button"),
      "real Wasm forwards the exact event and returns its native event/current target unchanged");
      check(accepted === false && nativeEvent.defaultPrevented && receivedEvent.defaultPrevented &&
        eventParents === 0, "Lean invokes React's prevention and propagation methods");
      check(receivedEvent.currentTarget === null,
        "retaining the event does not extend currentTarget's dispatch-scoped validity");
    } finally {
      for (const [key, provider] of eventProviders) hostBindings[key] = provider;
      await React.act(async () => eventRoot.unmount());
    }
    const counterContainer = document.createElement("div");
    counterContainer.id = "native-counter-test";
    fixtures.append(counterContainer);
    const decodeNat = hostBindings["js.nat.value"];
    const encodeNat = hostBindings["js.nat"];
    let encodes = 0;
    hostBindings["js.nat.value"] = () => { throw new Error("native counter decoded its state"); };
    hostBindings["js.nat"] = value => { encodes++; return encodeNat(value); };
    try {
      await React.act(async () => runtime.call("ReactCounter.mount", "#native-counter-test"));
      const initialEncodes = encodes;
      const button = counterContainer.querySelector("button");
      check(button.textContent === "react:0", "native bigint initial state renders directly");
      await React.act(async () => { button.click(); button.click(); button.click(); });
      check(button.textContent === "react:3" && encodes === initialEncodes,
        "batched functional updates retain bigint state without decoding or re-encoding");
    } finally {
      hostBindings["js.nat.value"] = decodeNat;
      hostBindings["js.nat"] = encodeNat;
    }
    for (const [entry, id] of [
      ["ReactCounter.mountEffect", "native-effect"],
      ["ReactCounter.mountMemo", "native-memo"],
      ["ReactCounter.mountMemoStable", "native-memo-stable"],
      ["ReactInput.mountInput", "native-input"],
      ["ReactInput.mountChangeInput", "native-change-input"],
      ["ReactInput.mountCheckbox", "native-checkbox"],
      ["ReactInput.mountSelectTextarea", "native-fields"],
      ["ReactInput.mountAttributes", "native-attributes"],
      ["ReactTamagotchi.mount", "native-pet"],
    ]) {
      const container = document.createElement("div");
      container.id = id;
      fixtures.append(container);
      await React.act(async () => check(runtime.call(entry, `#${id}`), `${entry} mounts`));
    }
    check(query("#react-effect-label").textContent === "react:effect",
      "generic nullary setup may return native undefined");
    check(query("#react-memo-label").textContent === "react:memo:42",
      "generic nullary calculation returns an exact native value");
    const memoButton = query("#react-memo-stable-button");
    await React.act(async () => memoButton.click());
    check(memoButton.textContent === "react:memo-stable:1:0",
      "native updater changes state while React retains the memo for empty dependencies");
    const input = query("#react-name-input");
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Ada");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    check(input.value === "Ada" && query("#react-name-output").textContent === "Ada",
      "input state remains native through event, props and text");
    const changeInput = query("#react-change-input");
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(changeInput, "Grace");
      changeInput.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    });
    check(query("#react-change-output").textContent === "Grace",
      "synthetic onChange preserves input state after preventing the native event");
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    await React.act(async () => query("#react-change-widget").dispatchEvent(submit));
    check(submit.defaultPrevented, "synthetic onSubmit cancels the native submit");
    await React.act(async () => query("#react-checkbox-input").click());
    check(query("#react-checkbox-output").textContent === "checked:true",
      "native boolean props and callbacks survive rerendering");
    const select = query("#react-flavor-select");
    await React.act(async () => {
      select.value = "chocolate";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    check(query("#react-select-textarea-output").textContent === "note:draft; flavor:chocolate",
      "native select values retain existing Lean formatting");
    const textarea = query("#react-note-input");
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(textarea, "revised");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    check(query("#react-select-textarea-output").textContent === "note:revised; flavor:chocolate",
      "textarea reads the control value through its explicit nativeEvent");
    const attributes = query("#react-attributes-widget");
    check(attributes.style.color === "rgb(1, 2, 3)" && attributes.style.marginTop === "4px" &&
      attributes.tabIndex === 3 && attributes.dataset.case === "attributes",
    "native style, numeric and data attributes preserve values");
    const pet = query("#react-pet-widget");
    check(pet !== null && JSON.stringify([...pet.querySelectorAll(".react-pet-action-button")]
      .map(button => button.id)) === JSON.stringify(["feed", "play", "nap", "wake", "ignore"]
      .map(action => `react-pet-action-${action}`)),
      "Tamagotchi retains its native action tree");
    check(query("#react-pet-device").dataset.art === "octopus",
      "Tamagotchi retains its initial artwork");
    for (const artwork of ["pet", "octopus"]) {
      await React.act(async () => query("#react-pet-art-toggle").click());
      check(query("#react-pet-device").dataset.art === artwork,
        `Tamagotchi artwork should be ${artwork}, got ${query("#react-pet-device").dataset.art}`);
    }
    const helloContainer = document.createElement("div");
    fixtures.append(helloContainer);
    const helloRoot = createRoot(helloContainer);
    try {
      const Hello = runtime.call("ReactProofWidgetHello.createComponent");
      const props = createNativePanelFixture();
      for (const goals of [[], props.goals]) {
        await React.act(async () => helloRoot.render(React.createElement(Hello, { ...props, goals })));
        check(helloContainer.querySelector("#react-proof-hello h3")?.textContent === `Hello from ${props.pos.uri}`,
          "both Hello branches retain the outer section and native URI text");
        check(helloContainer.querySelector("pre")?.textContent === (goals.length === 0
          ? "Move the cursor into a proof to see its first goal."
          : `⊢ ${TaggedText_stripTags(goals[0].type)}`), "Hello displays only the first native goal");
      }
    } finally {
      await React.act(async () => helloRoot.unmount());
    }
    check(peer.querySelector("#react-pet-device").dataset.art === "pet",
      "authoring interactions leave the peer widget unchanged");
    return true;
  } finally {
    delete runtime.liveCallbacks[Symbol.iterator];
    try { await React.act(async () => runtime.dispose()); }
    finally {
      fixtures.remove();
      peer.remove();
      document.title = previousTitle;
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
};

globalThis.runVirNativeInfoviewUpdates = async (wasm, pkg) => {
  let root;
  let component;
  let submissions = 0;
  let expectedProps = null;
  let boundaryChecks = 0;
  const hostBindings = createBrowserHostBindings({
    reactHostBindings: createBrowserReactHostBindings,
    infoviewStripTags: (code) => TaggedText_stripTags(code),
  });
  const panelPosition = hostBindings["infoview.panelWidgetProps.pos"];
  hostBindings["infoview.panelWidgetProps.pos"] = (props) => {
    assertNestedRefs(props, expectedProps);
    boundaryChecks++;
    return panelPosition(props);
  };
  const runtime = await createVirRuntime({
    wasmModule: new WebAssembly.Module(new Uint8Array(wasm)),
    irPackageSet: [new Uint8Array(pkg)],
    hostBindings,
  });
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const query = (selector) => container.querySelector(selector);
  const mount = (props) => React.act(async () => {
    expectedProps = props;
    const node = React.createElement(component, props);
    check(node.type === component, "every element must reuse the exact component function");
    submissions++;
    root.render(node);
  });
  const empty = (props) => ({ ...props, goals: [], termGoal: undefined });
  const displayedGoalCount = (props) => props.goals.length + (props.termGoal === undefined ? 0 : 1);
  const positionLabel = (props) =>
    `${props.pos.uri}:${props.pos.line + 1}:${props.pos.character + 1}`;
  const goalKey = (goal, index) => goal.mvarId ?? goal.userName ?? `goal-${index}`;
  const goalStatus = (goal) =>
    goal.isRemoved === true ? "removed" : goal.isInserted === true ? "inserted" : "active";
  const inspectEmpty = (props) => {
    check(query("#vir-native-infoview-empty")?.textContent ===
      `No goals at ${positionLabel(props)}.`, "empty state must show the native position");
    check(query(".vir-native-infoview-goal") === null, "empty state must remove goal cards");
  };
  const inspectGoal = (goal, index, collapsed, prefix = "goal") => {
    const card = query(`#vir-native-infoview-goal-${prefix}-${index}`);
    check(card !== null, "every native goal must have a card");
    if (prefix === "goal") {
      check(card.dataset.goalKey === goalKey(goal, index) &&
        card.dataset.goalStatus === goalStatus(goal),
      "goal identity and native insertion/removal status must follow props");
    }
    check(card.querySelector(".vir-native-infoview-collapse")?.getAttribute("aria-expanded") ===
      String(!collapsed), "goal collapse state must survive the update");
    const target = card.querySelector(".vir-native-infoview-target-code");
    if (collapsed) {
      check(target === null && card.querySelector(".vir-native-infoview-context") === null,
        "collapsed goals must keep their target and hypotheses hidden");
      return;
    }
    check(target?.textContent === TaggedText_stripTags(goal.type),
      "target must use the exact upstream tagged-text result");
    const hypotheses = card.querySelectorAll(".vir-native-infoview-hypothesis");
    check(hypotheses.length === goal.hyps.length, "Lean must render every native hypothesis");
    goal.hyps.forEach((hypothesis, hypothesisIndex) => {
      check(hypotheses[hypothesisIndex].querySelector(".vir-native-infoview-hyp-name")?.textContent ===
        hypothesis.names.join(" "), "hypothesis names must follow native props");
      check(hypotheses[hypothesisIndex].querySelector(".vir-native-infoview-hyp-type")?.textContent ===
        TaggedText_stripTags(hypothesis.type), "hypothesis types must use tagged-text stripping");
    });
  };
  const inspectGoals = (props, collapsedKey = null) => {
    const count = displayedGoalCount(props);
    check(query("#vir-native-infoview-empty") === null, "goals must replace the empty state");
    check(container.querySelectorAll(".vir-native-infoview-goal").length === count,
      "Lean must render every tactic and term goal exactly once");
    check(query("#vir-native-infoview-summary")?.textContent ===
      `${count} goals · ${positionLabel(props)}`, "summary must follow native position updates");
    props.goals.forEach((goal, index) =>
      inspectGoal(goal, index, goalKey(goal, index) === collapsedKey));
    if (props.termGoal !== undefined) {
      inspectGoal(props.termGoal, props.goals.length, false, "term");
    }
  };
  try {
    root = createRoot(container);
    component = runtime.call("VirNativeInfoview.createComponent");
    check(typeof component === "function", "Lean factory must return a native component function");
    const props = createNativePanelFixture();
    await mount(empty(props));
    inspectEmpty(props);
    const panel = query("#vir-native-infoview");

    await mount(props);
    inspectGoals(props);
    check(query("#vir-native-infoview") === panel, "empty-to-goals must reconcile the existing panel");
    const firstCard = query("#vir-native-infoview-goal-goal-0");
    const toggle = firstCard.querySelector(".vir-native-infoview-collapse");
    await React.act(async () => toggle.click());
    inspectGoals(props, goalKey(props.goals[0], 0));

    const updated = createMovedNativePanelFixture(props);
    await mount(updated);
    inspectGoals(updated, "main");
    check(query("#vir-native-infoview-goal-goal-0") === firstCard &&
      firstCard.querySelector(".vir-native-infoview-collapse") === toggle,
    "native props updates must reconcile the same keyed GoalCard and toggle");
    const reordered = { ...updated, goals: [updated.goals[1], updated.goals[0], updated.goals[2]] };
    await mount(reordered);
    inspectGoals(reordered, "main");
    check(query("#vir-native-infoview-goal-goal-1") === firstCard &&
      firstCard.querySelector(".vir-native-infoview-collapse") === toggle,
    "reordering native goals must keep collapse state with the original goal");
    await React.act(async () => toggle.click());
    inspectGoals(reordered);

    await mount(empty(reordered));
    inspectEmpty(reordered);
    check(query("#vir-native-infoview") === panel, "goals-to-empty must reconcile the existing panel");
    check(submissions === 5, "all five snapshots must use direct React component elements");
    check(boundaryChecks === 5, "each render must reach the native panel-props boundary");
    return {
      submissions,
      boundaryChecks,
      initialGoals: displayedGoalCount(props),
      collapsedAfterUpdate: true,
      finalGoals: 0,
    };
  } finally {
    try {
      if (root) await React.act(async () => root.unmount());
    } finally {
      container.remove();
      try {
        runtime.dispose();
      } finally {
        globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  }
};

function assertNestedRefs(actual, expected) {
  check(expected !== null, "the component boundary requires expected native props");
  check(actual.pos === expected.pos, "component must receive the exact native position object");
  check(actual.goals === expected.goals, "component must receive the exact native goals array");
  for (let index = 0; index < expected.goals.length; index++) {
    check(actual.goals[index] === expected.goals[index], "component must preserve native goal references");
    check(actual.goals[index].hyps === expected.goals[index].hyps,
      "component must preserve nested native hypothesis arrays");
    check(actual.goals[index].hyps[0] === expected.goals[index].hyps[0],
      "component must preserve nested native hypothesis references");
  }
  check(actual.termGoal === expected.termGoal, "component must preserve the optional native term goal");
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}
