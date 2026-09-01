# React Node Renderer

VIR exposes a small Lean surface for constructing and rendering native React
values. The binding rule is simple: where the React API accepts or returns a
JavaScript value, VIR passes that exact value.

## Values

The low-level marker types are phantom Lean types over ordinary JavaScript
values:

- `Js Node` is an actual React node or element;
- `Js ElementType` is the tag, component, symbol, or React type object;
- `Js Props` is a JavaScript object;
- `Js NodeChildren` and `Js DependencyList` are JavaScript arrays;
- `Js ReactRef` is React's `{ current }` object;
- state values, actions, setters, and dispatchers are the values returned or
  stored by React.

There is no React-node wrapper, ownership lease, virtual node graph, or alias
table. `React.createElement` decides which parts of props and children it
copies or retains, exactly as it does in JavaScript.

## Construction

Lean builders make the low-level values pleasant to construct:

```lean
import Vir.React

open Lean.Vir.React

def greeting (name : String) : ReactM (Lean.Vir.Js Node) :=
  Node.element "section"
    #[Property.className "greeting"]
    #[← Node.text s!"Hello, {name}"]
```

The builders are explicit adapters:

- `react.props.empty` creates `{}`;
- property and event-handler operations mutate that object;
- `react.node.children.empty` creates `[]`;
- `react.node.children.push` calls the array's normal mutation path;
- `react.node.createElement` forwards the values to `React.createElement`;
- fragment construction forwards to `React.Fragment`.

`PropValue` conversion is intentionally visible. It converts the Lean helper
description to the JavaScript value stored in props; it is not hidden inside
the native `createElement` binding.

## Roots And Components

Browser roots are the objects returned by `ReactDOMClient.createRoot`.
`Root.renderNode` forwards an actual node to `root.render`, and `Root.unmount`
forwards to `root.unmount`.

`Root.render` is a Lean-construction convenience that invokes a Lean render
callback once and forwards its resulting node. `Root.renderComponent` is the
component adapter: it supplies an actual JavaScript function component so
React controls invocation, replay, hooks, and commits. Use the component path
for recurring application updates.

The adapter keeps one function-component type per root. Repeated component
submissions update its callback without resetting React state or mount effects;
unmounting and recreating the root is the explicit remount boundary. As in a
TypeScript component, updates must preserve valid hook ordering. Submitters
that intentionally change the component's hook shape must unmount first.

Selector helpers keep one active root per selected container and return a
boolean when the selector is missing. Root registration is tracked only so
runtime disposal can unmount it. If a newly created root cannot be published
back to Lean, the host-call transaction unmounts it.

Direct root submissions have no public React commit acknowledgement. VIR does
not infer when React has stopped retaining a submitted graph. Application code
that needs normal evolving UI state should put that state behind a component.

## Hooks

The browser hook runtime delegates directly to official React:

- `useState` returns React's current value and setter;
- `useReducer` installs the supplied reducer and returns React's dispatch;
- `useRef` returns React's ref object;
- `useMemo` receives the actual dependency array and returns React's result;
- `useEffect` and `useEffectWithDeps` register official effects;
- state setters and reducer dispatchers receive the exact JavaScript value.

The Lean effect API splits setup and cleanup into two callbacks and is
therefore an explicit adapter. Apart from that adapter, VIR does not keep
committed/speculative hook slots, action queues, dependency leases, or render
generation records.

React restrictions remain programmer responsibilities. Lean does not add
purity, valid hook ordering, complete dependency lists, replay-safe reducers,
or lane acknowledgements that TypeScript React lacks.

## Refs And Events

Refs use React's exact semantics. A callback ref is the original function; an
object ref is the original object; React may write a DOM node or `null` to its
`current` property. VIR does not preserve an independent hidden ref payload.

Event handler props store the exact callback function. The browser/React event
object is passed unchanged. Any restrictions on using the event after the
handler are those of the corresponding React/browser version, not a VIR scope.

## JSL Values In React

A `JSL α` value is an ordinary JavaScript object with a private association to
one rooted Lean value. React stores that exact object. React's ordinary object
graph keeps it reachable; collection releases the Lean root as a best-effort
backstop, and runtime disposal provides deterministic cleanup.

This is generic JSL behavior. There is no React-specific JSL alias or lease.

## Browser-Only Semantics

Official React 19, ReactDOM, and Chromium are the semantic oracle. The Node
virtual document is not a React renderer. Its React providers are explicit
cleanup-safe unsupported shims and do not emulate nodes, hooks, roots,
reconciliation, Strict Mode, Suspense, or commits.

Runtime-only unit tests may use a fake root to verify generic active-resource
registration and rollback. All React behavior belongs in the browser suite.

## Validation

The browser matrix covers:

- exact props, callback, ref, setter, dispatcher, and memo identity;
- actual DOM ref assignment followed by `null` on unmount;
- Strict Mode effect behavior;
- dependency changes that return the same memo result;
- interleaved state lanes;
- suspended and abandoned renders;
- root render and unmount behavior.

Run:

```bash
npm run build:site
CHROMIUM=/path/to/chromium npm run test:pages:browser
```

See [HOST_BINDINGS.md](HOST_BINDINGS.md) for the underlying JavaScript-value
and active-resource contract.
