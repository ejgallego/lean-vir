/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import * as ReactDOMClient from "./vir-react-dom-client.js";
import { createReactRootHostBindings } from "./react/vir-react-root.js";

export function createBrowserReactHostBindings(lifecycle) {
  return {
    ...createReactRootHostBindings(lifecycle, ReactDOMClient.createRoot),
    "react.node.text": (value) => value,
    "react.elementType.tag": (tag) => tag,
    "react.node.createElement": (elementType, props, children) =>
      React.createElement(elementType, props, ...children),
    "react.node.component": (component, leanProps) =>
      React.createElement(component, { leanProps }),
    "react.node.keyedComponent": (component, leanProps, key) =>
      React.createElement(component, { leanProps, key }),
    "react.node.fragment": (props, children) =>
      React.createElement(React.Fragment, props, ...children),
    "react.useState": (initial) => React.useState(initial),
    "react.useReducer": (reducer, initial) =>
      React.useReducer(reducer, initial),
    "react.useRef": (initial) => React.useRef(initial),
    "react.useMemo": (calculate, deps) => React.useMemo(calculate, deps),
    "react.useCallback": (callback, deps) => React.useCallback(callback, deps),
    "react.useContext": (context) => React.useContext(context),
    "react.useEffect": (setup) => React.useEffect(setup),
    "react.useEffectWithDeps": (setup, deps) => React.useEffect(setup, deps),
    "react.ref.get": (ref) => ref.current,
    "react.ref.set": (ref, value) => {
      ref.current = value;
      return undefined;
    },
    "react.state.modify": (setter, update) => setter(update),
    "js.value.react.reducer": (reducer) => reducer,
    "js.value.react.memoCalculation": (calculate) => calculate,
    "js.value.react.callback": (callback) => callback,
    "js.value.react.effectCallback": (effect) => () => {
      const value = effect.setup();
      return () => effect.cleanup(value);
    },
    "js.value.react.component": (render) =>
      function LeanComponent(props) {
        return render(props.leanProps);
      },
  };
}
