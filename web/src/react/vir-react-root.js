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
    querySelector = null,
    createLeanComponentNode = null,
    createNodeText = null,
    createNodeElement = null,
    createNodeFragment = null,
  } = {},
) {
  const rootsByContainer = new WeakMap();
  const containersByRoot = new WeakMap();
  const rootsBySelector = new Map();

  function forgetRoot(root) {
    const container = containersByRoot.get(root);
    if (rootsByContainer.get(container) === root) {
      rootsByContainer.delete(container);
    }
    containersByRoot.delete(root);
    for (const [selector, mounted] of rootsBySelector) {
      if (mounted.root === root) {
        rootsBySelector.delete(selector);
      }
    }
  }

  function rootForContainer(container) {
    let root = rootsByContainer.get(container);
    if (root !== undefined) {
      return { root, created: false };
    }
    root = createTrackedRoot(container);
    rootsByContainer.set(container, root);
    containersByRoot.set(root, container);
    return { root, created: true };
  }

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
    const errors = [];
    collectCleanupError(errors, () => forgetRoot(root));
    collectCleanupError(errors, () => root.unmount());
    throwCollectedErrors(errors, "React root cleanup failed");
  }

  function queryReactRootSelector(selector) {
    if (typeof querySelector !== "function") {
      throw new Error(
        "react.root selector host bindings require a querySelector function",
      );
    }
    return querySelector(selector);
  }

  function releaseRoot(root) {
    const errors = [];
    collectCleanupError(errors, () => lifecycle.removeDisposable(root));
    collectCleanupError(errors, () => cleanupTrackedRoot(root));
    throwCollectedErrors(errors, "React root release failed");
  }

  function selectorRoot(selector, onMissing) {
    const target = queryReactRootSelector(selector);
    if (target === null || target === undefined) {
      onMissing();
      return null;
    }
    const existing = rootsBySelector.get(selector);
    if (existing !== undefined && existing.container !== target) {
      releaseRoot(existing.root);
    }
    const { root, created } = rootForContainer(target);
    rootsBySelector.set(selector, { container: target, root });
    return { root, created };
  }

  function selectorPublication(root) {
    return lifecycle.stageResult(true, {
      onAbort: () => releaseRoot(root),
    });
  }

  function publishSelectorRender(selected, render, failureMessage) {
    const errors = [];
    const rendered = collectCleanupError(errors, render);
    if (!rendered.ok) {
      if (selected.created) {
        collectCleanupError(errors, () => releaseRoot(selected.root));
      }
      throwCollectedErrors(errors, failureMessage);
    }
    const published = collectCleanupError(errors, () =>
      selectorPublication(selected.root),
    );
    if (!published.ok) {
      // Publication failure rolls the whole side effect back. This also
      // terminates an existing root whose committed tree was just replaced.
      collectCleanupError(errors, () => releaseRoot(selected.root));
    }
    throwCollectedErrors(errors, failureMessage);
    return published.value;
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
    "react.root.renderIntoSelector": (selector, node) => {
      const selected = selectorRoot(
        jsStringValue(selector, "React root selector"),
        // The node is an ordinary borrowed JavaScript value. A missing mount
        // point has no effect on it.
        () => undefined,
      );
      if (selected === null) {
        return false;
      }
      return publishSelectorRender(
        selected,
        () => selected.root.render(node),
        "React selector render failed during root rollback",
      );
    },
    "react.root.unmount": (root) => {
      releaseRoot(root);
      return undefined;
    },
    "react.root.unmountSelector": (selector) => {
      const mounted = rootsBySelector.get(
        jsStringValue(selector, "React root selector"),
      );
      if (mounted === undefined) {
        return false;
      }
      releaseRoot(mounted.root);
      return true;
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
