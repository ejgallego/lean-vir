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
  createBrowserReactComponentNode,
  createBrowserReactNodeElement,
  createBrowserReactNodeFragment,
  createBrowserReactNodeText,
  createReactElementTypeTag,
  createReactNodeChildren,
  createReactProps,
  pushReactNodeChild,
  setReactPropsEventHandler,
  setReactPropsKey,
  setReactPropsProperty,
  setReactPropsRef,
} from "../../web/src/react/vir-react-node.js";

{
  const renderedNode = { kind: "rendered-node" };
  let receivedType = null;
  const componentType = () => ({ kind: "component-result" });
  const node = createBrowserReactComponentNode((type) => {
    receivedType = type;
    return renderedNode;
  }, componentType);
  assert.equal(node, renderedNode);
  assert.equal(receivedType, componentType);
}
import {
  createBrowserReactHookRuntime,
  createReactJsValueHostBindings,
  createReactStateHostBindings,
} from "../../web/src/react/vir-react-hooks.js";
import {
  createVirtualDocumentHostBindings,
  createVirtualDocumentState,
} from "../../web/src/host/vir-virtual-host-bindings.js";

const lifecycle = createHostLifecycle();
const callback = () => "clicked";
const ref = { current: null };
const props = createReactProps();
assert.equal(Object.getPrototypeOf(props), Object.prototype);
setReactPropsKey(props, "stable");
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

const children = createReactNodeChildren();
const first = createBrowserReactNodeText("goal: ");
const second = createBrowserReactNodeText("⊢ True");
pushReactNodeChild(children, first);
pushReactNodeChild(children, second);
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
setReactPropsKey(fragmentProps, "fragment-key");
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
  assert.equal(conversions["js.value.react.property"](property), property);
  assert.equal(conversions["js.value.react.eventHandler"](handler), handler);
}

{
  const initial = { value: "initial" };
  const setter = () => undefined;
  const statePair = [initial, setter];
  const reducer = (state, action) => ({ state, action });
  const dispatch = () => undefined;
  const reducerPair = [initial, dispatch];
  const hooks = createBrowserReactHookRuntime({
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
  const bindings = createReactStateHostBindings(hooks);
  assert.equal(bindings["react.useState"](initial), statePair);
  assert.equal(bindings["react.state.value"](statePair), initial);
  assert.equal(bindings["react.state.setter"](statePair), setter);
  assert.equal(bindings["react.useReducer"](reducer, initial), reducerPair);
  assert.equal(bindings["react.reducerState.value"](reducerPair), initial);
  assert.equal(bindings["react.reducerState.dispatch"](reducerPair), dispatch);
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
  const bindings = createReactStateHostBindings({});
  bindings["react.state.modify"]((action) => {
    queuedUpdate = action;
  }, update);
  assert.equal(typeof queuedUpdate, "function");
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
  const componentLifecycle = createHostLifecycle();
  const rendered = [];
  const root = {
    render(node) {
      rendered.push(node);
    },
    unmount() {},
  };
  const otherRoot = {
    render(node) {
      rendered.push(node);
    },
    unmount() {},
  };
  const bindings = createReactRootHostBindings(componentLifecycle, () => root, {
    createComponentNode: (type) => ({ type }),
  });
  const first = () => "first";
  const second = (unit) => {
    assert.equal(unit, undefined);
    return "second";
  };
  bindings["react.root.renderComponent"](root, first);
  bindings["react.root.renderComponent"](root, second);
  assert.equal(
    rendered[0].type,
    rendered[1].type,
    "repeated submissions to one root must retain the React component type",
  );
  assert.equal(rendered[1].type(), "second");
  bindings["react.root.renderComponent"](otherRoot, first);
  assert.notEqual(
    rendered[1].type,
    rendered[2].type,
    "a different root must receive a distinct component identity",
  );
  componentLifecycle.dispose();
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
      createComponentNode: (component) => ({ component }),
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
  bindings["react.root.renderComponent"](root, component);
  assert.equal(typeof rendered.at(-1).component, "function");
  assert.equal(rendered.at(-1).component(), element);
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
