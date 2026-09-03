/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createReactElementTypeTag,
  createReactProps,
  setReactPropsEventHandler,
  setReactPropsProperty,
  setReactPropsRef,
} from "./vir-react-node.js";
import {
  collectCleanupError,
  throwCollectedErrors,
} from "../runtime/cleanup.js";

export function createReactRootHostBindings(
  lifecycle,
  createRoot,
  {
    createLeanComponentNode = null,
    createNodeText = null,
    createNodeElement = null,
    createNodeFragment = null,
  } = {},
) {
  function createTrackedRoot(container) {
    const root = createRoot(container);
    if (
      typeof root?.render !== "function" ||
      typeof root?.unmount !== "function"
    ) {
      const errors = [
        new Error("React root must provide render and unmount functions"),
      ];
      collectCleanupError(errors, () => root?.unmount?.());
      throwCollectedErrors(
        errors,
        "React root creation failed during rollback",
      );
    }
    // addDisposable owns failure rollback once registration begins. Keeping the
    // validation above separate prevents this caller from unmounting twice.
    lifecycle.addDisposable(root, () => cleanupTrackedRoot(root));
    return root;
  }

  function cleanupTrackedRoot(root) {
    root.unmount();
  }

  function releaseRoot(root) {
    const errors = [];
    collectCleanupError(errors, () => lifecycle.removeDisposable(root));
    collectCleanupError(errors, () => cleanupTrackedRoot(root));
    throwCollectedErrors(errors, "React root release failed");
  }

  return {
    "react.node.text": (value) =>
      requireReactNodeTextFactory(createNodeText)(
        jsStringValue(value, "React Node text value"),
      ),
    "react.elementType.tag": (tag) =>
      createReactElementTypeTag(jsStringValue(tag, "React element type tag")),
    "react.props.empty": createReactProps,
    "react.props.setProperty": (props, property) =>
      setReactPropsProperty(props, property),
    "react.props.setEventHandler": (props, handler) =>
      setReactPropsEventHandler(props, handler),
    "react.props.setRef": (props, ref) => setReactPropsRef(props, ref),
    "react.node.createElement": (elementType, props, children) =>
      requireReactNodeElementFactory(createNodeElement)(
        elementType,
        props,
        children,
      ),
    "react.node.component": (component, props) =>
      requireLeanComponentNodeCreator(createLeanComponentNode)(
        component,
        props,
      ),
    "react.node.keyedComponent": (component, props, key) =>
      requireLeanComponentNodeCreator(createLeanComponentNode)(
        component,
        props,
        key,
      ),
    "react.node.fragment": (props, children) =>
      requireReactNodeFragmentFactory(createNodeFragment)(props, children),
    "react.root.create": (container) => {
      const root = createTrackedRoot(container);
      return lifecycle.stageResult(root, {
        onAbort: () => releaseRoot(root),
      });
    },
    "react.root.renderNode": (root, node) => {
      root.render(node);
      return undefined;
    },
    "react.root.unmount": (root) => {
      releaseRoot(root);
      return undefined;
    },
  };
}

function requireReactNodeTextFactory(factory) {
  if (typeof factory !== "function") {
    throw new Error(
      "react.node.text host binding requires a React Node text factory",
    );
  }
  return factory;
}

function requireReactNodeElementFactory(factory) {
  if (typeof factory !== "function") {
    throw new Error(
      "react.node.createElement host binding requires a React Node element factory",
    );
  }
  return factory;
}

function requireLeanComponentNodeCreator(createNode) {
  if (typeof createNode !== "function") {
    throw new Error(
      "react.node.component host binding requires a browser node creator",
    );
  }
  return createNode;
}

function requireReactNodeFragmentFactory(factory) {
  if (typeof factory !== "function") {
    throw new Error(
      "react.node.fragment host binding requires a React Node fragment factory",
    );
  }
  return factory;
}

function jsStringValue(text, label) {
  if (typeof text !== "string") {
    throw new Error(`${label} must be a Js String`);
  }
  return text;
}
