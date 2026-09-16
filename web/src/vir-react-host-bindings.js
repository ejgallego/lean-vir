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
    "react.node.createElement": (elementType, props, children) =>
      React.createElement(elementType, props, ...children),
    "react.props.withData.make": (data) => ({ data }),
    "react.props.withData.get": (props) => props.data,
    "react.props.withData.children": (props) => props.children,
    "react.node.fragment": (props, children) =>
      React.createElement(React.Fragment, props, ...children),
    "react.syntheticEvent.nativeEvent": (event) => event.nativeEvent,
    "react.syntheticEvent.target": (event) => event.target,
    "react.syntheticEvent.currentTarget": (event) => event.currentTarget,
    "react.syntheticEvent.defaultPrevented": (event) => event.defaultPrevented,
    "react.syntheticEvent.preventDefault": (event) => event.preventDefault(),
    "react.syntheticEvent.stopPropagation": (event) => event.stopPropagation(),
    "react.useState": (initial) => React.useState(initial),
    "react.useReducer": (reducer, initial) =>
      React.useReducer(reducer, initial),
    "react.useReducerWithInit": (reducer, initial, initialize) =>
      React.useReducer(reducer, initial, initialize),
    "react.useRef": (initial) => React.useRef(initial),
    "react.useId": () => React.useId(),
    "react.useMemo": (calculate, deps) => React.useMemo(calculate, deps),
    "react.useCallback": (callback, deps) => React.useCallback(callback, deps),
    "react.useContext": (context) => React.useContext(context),
    "react.useEffect": (setup, deps) => React.useEffect(setup, deps),
    "react.ref.get": (ref) => ref.current,
    "react.ref.set": (ref, value) => {
      ref.current = value;
      return undefined;
    },
  };
}
