/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import * as React from "react";

import { createHostLifecycle } from "../../web/src/host/vir-host-resources.js";
import { createReactRootHostBindings } from "../../web/src/host/vir-host-resources.js";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";
import {
  createBrowserLeanComponentNode,
  createBrowserReactNodeElement,
  createBrowserReactNodeFragment,
  createReactElementTypeTag,
  createReactProps,
  reactNodeTextValue,
  setReactPropsEventHandler,
  setReactPropsProperty,
  setReactPropsRef,
} from "../../web/src/react/vir-react-node.js";

import {
  createBrowserReactHookBindings,
  createReactJsValueHostBindings,
} from "../../web/src/react/vir-react-hooks.js";
import {
  createVirtualDocumentHostBindings,
  createVirtualDocumentState,
} from "../../web/src/host/vir-virtual-host-bindings.js";

{
  const component = ({ leanProps }) => leanProps.label;
  const leanProps = { label: "first" };
  const firstNode = createBrowserLeanComponentNode(
    React.createElement,
    component,
    leanProps,
  );
  assert.equal(firstNode.type, component);
  assert.equal(firstNode.props.leanProps, leanProps);
  assert.equal(firstNode.type(firstNode.props), "first");
  const keyed = createBrowserLeanComponentNode(
    React.createElement,
    component,
    leanProps,
    "counter-key",
  );
  assert.equal(keyed.key, "counter-key");
}

const lifecycle = createHostLifecycle();
const callback = () => "clicked";
const ref = { current: null };
const props = createReactProps();
assert.equal(Object.getPrototypeOf(props), Object.prototype);
setReactPropsProperty(props, {
  name: "key",
  value: { kind: "string", value: "stable" },
});
setReactPropsRef(props, ref);
setReactPropsProperty(props, {
  name: "className",
  value: { kind: "classList", value: ["proof", "proof", "goal"] },
});
setReactPropsProperty(props, {
  name: "style",
  value: {
    kind: "style",
    value: [{ name: "fontWeight", value: "600" }],
  },
});
setReactPropsEventHandler(props, {
  name: "onClick",
  callback,
});
assert.equal(props.key, "stable");
assert.equal(props.ref, ref);
assert.equal(props.className, "proof goal");
assert.deepEqual(props.style, { fontWeight: "600" });
assert.equal(props.onClick, callback);
for (const name of ["__proto__", "constructor", "prototype"]) {
  const value = `exact-${name}`;
  setReactPropsProperty(props, {
    name,
    value: { kind: "string", value },
  });
  assert.equal(Object.hasOwn(props, name), true);
  assert.equal(props[name], value);
}
assert.equal(Object.getPrototypeOf(props), Object.prototype);

const children = [];
const first = reactNodeTextValue("goal: ");
const second = reactNodeTextValue("⊢ True");
children.push(first, second);
assert.deepEqual(children, [first, second]);

const tag = createReactElementTypeTag("section");
assert.equal(tag, "section");
const element = createBrowserReactNodeElement(
  React.createElement,
  tag,
  props,
  children,
);
assert.equal(React.isValidElement(element), true);
assert.equal(element.type, "section");
assert.equal(element.props.onClick, callback);
assert.equal(element.props.children[0], first);
assert.equal(element.props.children[1], second);

const fragmentProps = createReactProps();
setReactPropsProperty(fragmentProps, {
  name: "key",
  value: { kind: "string", value: "fragment-key" },
});
const fragment = createBrowserReactNodeFragment(
  React.createElement,
  React.Fragment,
  fragmentProps,
  children,
);
assert.equal(React.isValidElement(fragment), true);
assert.equal(fragment.type, React.Fragment);
assert.throws(
  () =>
    createBrowserReactNodeFragment(
      React.createElement,
      React.Fragment,
      props,
      children,
    ),
  /Fragment props only support key/,
);

{
  const conversions = createReactJsValueHostBindings();
  const property = { name: "title", value: { kind: "string", value: "proof" } };
  const handler = { name: "onClick", callback };
  const reducer = (state, action) => ({ state, action });
  const calculate = () => property;
  assert.equal(conversions["js.value.react.property"](property), property);
  assert.equal(conversions["js.value.react.eventHandler"](handler), handler);
  assert.equal(conversions["js.value.react.reducer"](reducer), reducer);
  assert.equal(
    conversions["js.value.react.memoCalculation"](calculate),
    calculate,
  );
  assert.equal(conversions["js.value.react.callback"](callback), callback);
  const setup = () => property;
  const cleanup = (value) => value;
  const effect = conversions["js.value.react.effectCallback"]({
    setup,
    cleanup,
  });
  assert.equal(effect()(), property);
  const render = (leanProps) => leanProps;
  const component = conversions["js.value.react.component"](render);
  assert.equal(component({ leanProps: property }), property);
}

{
  const initial = { value: "initial" };
  const setter = () => undefined;
  const statePair = [initial, setter];
  const reducer = (state, action) => ({ state, action });
  const dispatch = () => undefined;
  const reducerPair = [initial, dispatch];
  const bindings = createBrowserReactHookBindings({
    useState(value) {
      assert.equal(value, initial);
      return statePair;
    },
    useReducer(valueReducer, value) {
      assert.equal(valueReducer, reducer);
      assert.equal(value, initial);
      return reducerPair;
    },
  });
  assert.equal(bindings["react.useState"](initial), statePair);
  assert.equal(bindings["react.stateTuple.value"](statePair), initial);
  assert.equal(bindings["react.stateTuple.setter"](statePair), setter);
  assert.equal(bindings["react.useReducer"](reducer, initial), reducerPair);
  assert.equal(bindings["react.reducerTuple.value"](reducerPair), initial);
  assert.equal(bindings["react.reducerTuple.dispatch"](reducerPair), dispatch);
}

{
  const callback = () => "callback";
  const calculation = () => "memo";
  const context = { current: "context" };
  const effect = () => undefined;
  const deps = [];
  const calls = [];
  const bindings = createBrowserReactHookBindings({
    useCallback(value, valueDeps) {
      calls.push(["callback", value, valueDeps]);
      return value;
    },
    useContext(value) {
      calls.push(["context", value]);
      return value.current;
    },
    useEffect(value, valueDeps) {
      calls.push(["effect", value, valueDeps]);
    },
    useMemo(value, valueDeps) {
      calls.push(["memo", value, valueDeps]);
      return value();
    },
  });
  assert.equal(bindings["react.useCallback"](callback, deps), callback);
  assert.equal(bindings["react.useContext"](context), "context");
  assert.equal(bindings["react.useMemo"](calculation, deps), "memo");
  assert.equal(bindings["react.useEffect"](effect), undefined);
  assert.equal(bindings["react.useEffectWithDeps"](effect, deps), undefined);
  assert.deepEqual(calls, [
    ["callback", callback, deps],
    ["context", context],
    ["memo", calculation, deps],
    ["effect", effect, undefined],
    ["effect", effect, deps],
  ]);
}

{
  const bindings = createVirtualDocumentHostBindings(
    createVirtualDocumentState(),
  );
  const targets = Object.keys(bindings).filter(
    (target) =>
      target.startsWith("react.") || target.startsWith("js.value.react."),
  );
  const browserTargets = Object.keys(createBrowserReactHostBindings()).filter(
    (target) =>
      target.startsWith("react.") || target.startsWith("js.value.react."),
  );
  assert.deepEqual(targets.toSorted(), browserTargets.toSorted());
  for (const target of targets) {
    assert.throws(
      () => bindings[target](),
      new RegExp(
        `${target.replaceAll(".", "\\.")} requires the browser React host`,
      ),
    );
  }
}

{
  let queuedUpdate = null;
  const update = (previous) => ({ previous });
  const bindings = createBrowserReactHookBindings({});
  bindings["react.state.modify"]((action) => {
    queuedUpdate = action;
  }, update);
  assert.equal(
    queuedUpdate,
    update,
    "the state setter must receive the exact lifted updater function",
  );
  const previous = { exact: true };
  assert.deepEqual(queuedUpdate(previous), { previous });
}

{
  const directLifecycle = createHostLifecycle();
  let createCalls = 0;
  const bindings = createReactRootHostBindings(directLifecycle, () => ({
    id: ++createCalls,
    render() {},
    unmount() {},
  }));
  const container = {};
  const firstRoot = bindings["react.root.create"](container);
  const secondRoot = bindings["react.root.create"](container);
  assert.notEqual(firstRoot, secondRoot);
  assert.equal(
    createCalls,
    2,
    "direct root creation must call the upstream factory every time",
  );
  bindings["react.root.unmount"](firstRoot);
  bindings["react.root.unmount"](secondRoot);
  assert.equal(directLifecycle.debugResourceCounts().active, 0);
  directLifecycle.dispose();
}

{
  const target = {};
  const rendered = [];
  let unmounts = 0;
  const root = {
    render(value) {
      rendered.push(value);
    },
    unmount() {
      unmounts++;
    },
  };
  const bindings = createReactRootHostBindings(
    lifecycle,
    (container) => {
      assert.equal(container, target);
      return root;
    },
    {
      querySelector: (selector) => (selector === "#app" ? target : null),
      createLeanComponentNode: (component, props, key = null) => ({
        component,
        props,
        key,
      }),
      createNodeText: (value) => value,
      createNodeElement: (type, valueProps, valueChildren) => ({
        type,
        props: valueProps,
        children: valueChildren,
      }),
      createNodeFragment: (valueProps, valueChildren) => ({
        props: valueProps,
        children: valueChildren,
      }),
    },
  );
  assert.equal(bindings["react.root.create"](target), root);
  bindings["react.root.renderNode"](root, element);
  assert.equal(rendered.at(-1), element);
  const component = () => element;
  const leanProps = {};
  const componentNode = bindings["react.node.component"](component, leanProps);
  bindings["react.root.renderNode"](root, componentNode);
  assert.equal(rendered.at(-1).component, component);
  assert.equal(rendered.at(-1).props, leanProps);
  assert.equal(
    bindings["react.root.renderIntoSelector"]("#missing", element),
    false,
  );
  assert.equal(
    bindings["react.root.renderIntoSelector"]("#app", element),
    true,
  );
  bindings["react.root.unmount"](root);
  assert.equal(unmounts, 1);
  assert.equal(lifecycle.debugResourceCounts().active, 0);
}

lifecycle.dispose();
console.log("raw React host binding smoke ok");
