/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  createVirtualElementState,
  createVirtualEventState,
  virtualReactElementById,
} from "../web/src/vir-runtime-node.js";
import { virtualReactTextContent } from "./virtual-fixtures.mjs";

export function smokeVirtualReactCounter(runtime, documentState, selector) {
  assert.equal(runtime.call("ReactCounter.mount", selector), true);
  const element = documentState.elements.get(selector);
  assert.equal(element.textContent, "react:0");
  assertLiveCallbacks(runtime, 2);
  reactElementById(element, "react-counter-button").handlers.onClick({});
  assert.equal(element.textContent, "react:1");
  assertLiveCallbacks(runtime, 2);
  element.reactRoot.unmount();
  assertUnmountCleanup(runtime, element);
}

export function smokeVirtualReactInput(runtime, documentState, selector) {
  assert.equal(runtime.call("ReactInput.mountInput", selector), true);
  const element = documentState.elements.get(selector);
  assert.equal(element.textContent, "name:");
  assertLiveCallbacks(runtime, 2);
  const currentTarget = createVirtualElementState({ value: "Ada" });
  documentState.elements.set("#react-name-input", currentTarget);
  reactElementById(element, "react-name-input").handlers.onInput(createVirtualEventState({
    currentTarget,
    target: createVirtualElementState({ value: "unused-target" }),
  }));
  assert.equal(element.textContent, "name:Ada");
  assertLiveCallbacks(runtime, 2);
  reactElementById(element, "react-name-input").handlers.onInput(createVirtualEventState({
    target: createVirtualElementState({ value: "Target" }),
  }));
  assert.equal(element.textContent, "name:Target");
  assertLiveCallbacks(runtime, 2);
  element.reactRoot.unmount();
  assertUnmountCleanup(runtime, element);
}

export function smokeVirtualReactChangeInput(runtime, documentState, selector) {
  assert.equal(runtime.call("ReactInput.mountChangeInput", selector), true);
  const element = documentState.elements.get(selector);
  assert.equal(element.textContent, "change:");
  assertLiveCallbacks(runtime, 3);
  const submitEvent = createVirtualEventState();
  reactElementById(element, "react-change-widget").handlers.onSubmit(submitEvent);
  assert.equal(submitEvent.defaultPrevented, true);
  assert.equal(submitEvent.propagationStopped, true);
  assertLiveCallbacks(runtime, 3);
  const changeEvent = createVirtualEventState({
    currentTarget: createVirtualElementState({ value: "Grace" }),
  });
  reactElementById(element, "react-change-input").handlers.onChange(changeEvent);
  assert.equal(element.textContent, "change:Grace");
  assert.equal(changeEvent.defaultPrevented, true);
  assert.equal(changeEvent.propagationStopped, true);
  assertLiveCallbacks(runtime, 3);
  element.reactRoot.unmount();
  assertUnmountCleanup(runtime, element);
}

export function smokeVirtualReactCheckbox(runtime, documentState, selector) {
  assert.equal(runtime.call("ReactInput.mountCheckbox", selector), true);
  const element = documentState.elements.get(selector);
  assert.equal(element.textContent, "checked:false");
  assertLiveCallbacks(runtime, 2);
  reactElementById(element, "react-checkbox-input").handlers.onChange(createVirtualEventState({
    currentTarget: createVirtualElementState({ checked: true }),
  }));
  assert.equal(element.textContent, "checked:true");
  assertLiveCallbacks(runtime, 2);
  reactElementById(element, "react-checkbox-input").handlers.onChange(createVirtualEventState({
    target: createVirtualElementState({ checked: false }),
  }));
  assert.equal(element.textContent, "checked:false");
  assertLiveCallbacks(runtime, 2);
  element.reactRoot.unmount();
  assertUnmountCleanup(runtime, element);
}

export function smokeVirtualReactAttributes(runtime, documentState, selector, {
  assertKeys = false,
} = {}) {
  assert.equal(runtime.call("ReactInput.mountAttributes", selector), true);
  const element = documentState.elements.get(selector);
  assert.equal(element.textContent, "attrs:attrs");
  assertLiveCallbacks(runtime, 0);
  const widget = reactElementById(element, "react-attributes-widget");
  assert.equal(widget.props.role, "group");
  assert.equal(widget.props["aria-label"], "React attribute fixture");
  assert.equal(widget.props["data-case"], "attributes");
  assert.equal(widget.props["data-testid"], "react-attributes");
  assert.equal(widget.props.tabIndex, 3);
  assert.equal(widget.props.className, "react-attributes is-mounted");
  assert.equal(widget.props.style.color, "rgb(1, 2, 3)");
  assert.equal(widget.props.style.marginTop, "4px");
  const label = reactElementById(element, "react-attributes-label");
  assert.equal(label.props.htmlFor, "react-attributes-input");
  const input = reactElementById(element, "react-attributes-input");
  assert.equal(input.props.name, "attributes");
  assert.equal(input.props.type, "checkbox");
  assert.equal(input.props.checked, true);
  assert.equal(input.props.disabled, true);
  const output = reactElementById(element, "react-attributes-output");
  assert.equal(output.props.title, "attribute output");
  if (assertKeys) {
    assert.equal(label.key, "attributes-label");
    assert.equal(input.key, "attributes-input");
    assert.equal(output.key, "attributes-output");
  }
  element.reactRoot.unmount();
  assertUnmountCleanup(runtime, element);
}

export function smokeVirtualReactTamagotchi(runtime, documentState, selector, {
  extended = false,
} = {}) {
  assert.equal(runtime.call("ReactTamagotchi.mount", selector), true);
  const element = documentState.elements.get(selector);
  assertLiveCallbacks(runtime, 9);
  const widget = reactElementById(element, "react-pet-widget");
  assert.equal(widget.props["data-mood"], "happy");
  if (extended) {
    const device = reactElementById(element, "react-pet-device");
    assert.equal(device.props.role, "img");
    assert.equal(device.props["data-art"], "octopus");
    assert.equal(device.props["data-mood"], "happy");
    assert.match(device.props["aria-label"], /Octopus Octi mood happy/);
    const nameInput = reactElementById(element, "react-pet-name-input");
    assert.equal(nameInput.props.maxLength, 18);
    assert.equal(nameInput.props.autoComplete, "off");
    assert.equal(
      virtualReactTextContent(reactElementById(element, "react-pet-summary")),
      "Octi is happy; last ...; care 3/5; turn 0",
    );
  }

  reactElementById(element, "react-pet-action-ignore").handlers.onClick({});
  assertLiveCallbacks(runtime, 9);
  assert.equal(reactElementById(element, "react-pet-widget").props["data-mood"], "hungry");
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-pet-summary")),
    "Octi is hungry; last ignore; care 2/5; turn 1",
  );
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-pet-trace")),
    "happyhungry",
  );
  const trace = reactElementById(element, "react-pet-trace");
  assert.equal(trace.props.role, "list");
  assert.equal(trace.props["aria-label"], "Mood trace: happy -> hungry");
  assert.equal(trace.children[0].props.role, "listitem");
  assert.equal(trace.children[1].props.role, "listitem");

  reactElementById(element, "react-pet-name-input").handlers.onChange(createVirtualEventState({
    currentTarget: createVirtualElementState({ value: "Ada" }),
  }));
  assertLiveCallbacks(runtime, 9);
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-pet-summary")),
    "Ada is hungry; last rename; care 2/5; turn 1",
  );

  if (extended) {
    const submitEvent = createVirtualEventState();
    reactElementById(element, "react-pet-name-form").handlers.onSubmit(submitEvent);
    assert.equal(submitEvent.defaultPrevented, true);
    assert.equal(submitEvent.propagationStopped, true);
    assertLiveCallbacks(runtime, 9);
    reactElementById(element, "react-pet-art-toggle").handlers.onChange(createVirtualEventState({
      currentTarget: createVirtualElementState({ checked: false }),
    }));
    assertLiveCallbacks(runtime, 9);
    assert.equal(reactElementById(element, "react-pet-device").props["data-art"], "pet");
    assert.equal(reactElementById(element, "react-pet-art-toggle").props.checked, false);
    reactElementById(element, "react-pet-reset").handlers.onClick({});
    assertLiveCallbacks(runtime, 9);
    assert.equal(
      virtualReactTextContent(reactElementById(element, "react-pet-summary")),
      "Ada is happy; last ...; care 3/5; turn 0",
    );
  }

  element.reactRoot.unmount();
  assertUnmountCleanup(runtime, element);
}

function reactElementById(element, id) {
  return virtualReactElementById(element.reactRoot, id);
}

function assertLiveCallbacks(runtime, expected) {
  assert.equal(runtime.liveCallbacks.size, expected);
}

function assertUnmountCleanup(runtime, element) {
  assertLiveCallbacks(runtime, 0);
  assert.equal(element.reactRoot, undefined);
}
