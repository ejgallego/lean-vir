/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import * as React from "react";

import { createHostLifecycle } from "../../web/src/host/vir-active-host-bindings.js";
import { createReactRootHostBindings } from "../../web/src/react/vir-react-root.js";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";

const lifecycle = createHostLifecycle();
const reactBindings = createBrowserReactHostBindings(lifecycle);

{
  const component = ({ leanProps }) => leanProps.label;
  const leanProps = { label: "first" };
  const firstNode = reactBindings["react.node.component"](component, leanProps);
  assert.equal(firstNode.type, component);
  assert.equal(firstNode.props.leanProps, leanProps);
  assert.equal(firstNode.type(firstNode.props), "first");
  const keyed = reactBindings["react.node.keyedComponent"](
    component,
    leanProps,
    "counter-key",
  );
  assert.equal(keyed.key, "counter-key");
}

const callback = () => "clicked";
const ref = { current: null };
const props = {};
assert.equal(Object.getPrototypeOf(props), Object.prototype);
props.key = "stable";
props.ref = ref;
props.className = "proof goal";
props.style = { fontWeight: "600" };
props.onClick = callback;
assert.equal(props.key, "stable");
assert.equal(props.ref, ref);
assert.equal(props.className, "proof goal");
assert.deepEqual(props.style, { fontWeight: "600" });
assert.equal(props.onClick, callback);
for (const name of ["__proto__", "constructor", "prototype"]) {
  const value = `exact-${name}`;
  Object.defineProperty(props, name, { value, enumerable: true });
  assert.equal(Object.hasOwn(props, name), true);
  assert.equal(props[name], value);
}
assert.equal(Object.getPrototypeOf(props), Object.prototype);

const children = [];
const first = reactBindings["react.node.text"]("goal: ");
const second = reactBindings["react.node.text"]("⊢ True");
children.push(first, second);
assert.deepEqual(children, [first, second]);

const tag = reactBindings["react.elementType.tag"]("section");
assert.equal(tag, "section");
const element = reactBindings["react.node.createElement"](tag, props, children);
assert.equal(React.isValidElement(element), true);
assert.equal(element.type, "section");
assert.equal(element.props.onClick, callback);
assert.equal(element.props.children[0], first);
assert.equal(element.props.children[1], second);

const fragmentProps = { key: "fragment-key" };
const fragment = reactBindings["react.node.fragment"](
  fragmentProps,
  children,
);
assert.equal(React.isValidElement(fragment), true);
assert.equal(fragment.type, React.Fragment);

{
  const conversions = reactBindings;
  const property = { name: "title", value: { kind: "string", value: "proof" } };
  const reducer = (state, action) => ({ state, action });
  const calculate = () => property;
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
  let queuedUpdate = null;
  const update = (previous) => ({ previous });
  reactBindings["react.state.modify"]((action) => {
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
  const roots = [];
  const bindings = createReactRootHostBindings(
    lifecycle,
    (container) => {
      assert.equal(container, target);
      const root = {
        render(value) {
          rendered.push(value);
        },
        unmount() {
          unmounts++;
        },
      };
      roots.push(root);
      return root;
    },
  );
  const root = bindings["react.root.create"](target);
  assert.equal(root, roots[0]);
  bindings["react.root.renderNode"](root, element);
  assert.equal(rendered.at(-1), element);
  const component = () => element;
  const leanProps = {};
  const componentNode = reactBindings["react.node.component"](
    component,
    leanProps,
  );
  bindings["react.root.renderNode"](root, componentNode);
  assert.equal(rendered.at(-1).type, component);
  assert.equal(rendered.at(-1).props.leanProps, leanProps);
  bindings["react.root.unmount"](root);
  assert.equal(unmounts, 1);
  assert.equal(lifecycle.debugResourceCounts().active, 0);
  lifecycle.dispose();
  assert.equal(unmounts, 1);
  assert.equal(lifecycle.debugResourceCounts().active, 0);
}
console.log("raw React host binding smoke ok");
