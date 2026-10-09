# Native goal panel example

This experimental example hosts a Lean-owned goal panel and interactive code
renderer inside the existing Infoview. It does not replace the Infoview shell.
Start with the [demo tour](../guides/NATIVE_INFOVIEW_DEMO_TOUR.md).

The reference is `@leanprover/infoview` **0.13.0**, source commit
`66528403779d277160f1e9b9ee54de1ac24b8fec`:
[goals.tsx](https://github.com/leanprover/vscode-lean4/blob/66528403779d277160f1e9b9ee54de1ac24b8fec/lean4-infoview/src/infoview/goals.tsx)
and [interactiveCode.tsx](https://github.com/leanprover/vscode-lean4/blob/66528403779d277160f1e9b9ee54de1ac24b8fec/lean4-infoview/src/infoview/interactiveCode.tsx).

## Components

[VirNativeInfoview.lean](../../examples/VirNativeInfoview.lean) uses the Lean
renderer. [Comparison.lean](../../examples/VirNativeInfoview/Comparison.lean)
displays that renderer beside the upstream TypeScript `InteractiveCode`, sharing
the Lean goal panel but keeping each panel's settings independent.

| Module | Responsibility |
| --- | --- |
| [Goals](../../examples/VirNativeInfoview/Goals.lean) | Filtering and unfiltered copy formatting |
| [GoalPanel](../../examples/VirNativeInfoview/GoalPanel.lean) | Tactic goals, expected type, local settings, collapse and clipboard |
| [InteractiveCode](../../examples/VirNativeInfoview/InteractiveCode.lean) | Native tagged text, type requests and pinned popups |
| [Hover](../../examples/VirNativeInfoview/Hover.lean) | Hover delays, portals, geometry updates and cleanup |

[Composition.lean](../../examples/VirNativeInfoview/Composition.lean) supplies the
upstream component to the shared goal panel:

```lean
def View : RuntimeM (FunctionComponent PanelWidgetProps) := do
  let Upstream ← interactiveCode
  GoalPanel.withCode fun fmt => do
    jsx%{<Upstream fmt={fmt}/>}
```

The host supplies the actual component from the same Infoview instance as its
contexts. It fails explicitly if unavailable. Supplying only the deprecated
`RpcContext` is insufficient for popups: the upstream component uses position,
capability and private RPC-session contexts. Its `fmt` prop and nested RPC
references are passed unchanged through ordinary native JSX props.

## Data and state

Native server objects stay native; Lean records hold presentation policy and
functional state. Filtering retains the original hypothesis and name handles.
Goal prefixes, documentation and append children are not decoded and re-encoded
for display. Clipboard formatting deliberately accumulates Lean text.

- The native renderer's `CodeProps` is a compile-time schema with one
  `fmt : Js CodeWithInfos` field. `jsx%{<Code fmt={value}/>}` constructs native props;
  `js_field% props "fmt"` projects the exact value without a Lean record or
  `WithData` box. External-component props remain the separate boundary above.
- `Props.WithData` and `LeanRef` retain internal records and functional updates.
  Native `useState` tuples, setters and callbacks follow React's normal lifecycle.
- Dynamic children use native arrays with explicit React keys. Stable factories
  are constructed outside render. The popup's two child slots remain stable so
  opening it does not remount nested terms.

Popup documentation treats omitted, `undefined` and `null` fields as absence.
An empty primitive string produces no documentation element; a nonempty one is
shown literally, including Unicode, whitespace and Markdown markers. Other
present values must pass `Js.String.fromAny`: they are not coerced with
JavaScript `String(...)`. The original server object is not normalized.
The embedding host's error boundary handles rendering failures.

Hover policy is Lean-owned. DOM rectangle/modifier access, a React portal and
resize/scroll subscriptions supply browser primitives with explicit cleanup.
Nested popups keep their ancestor chain open. UI cleanup and runtime disposal
remain distinct; see [host ownership](../reference/HOST_BINDINGS.md#ui-cleanup-versus-runtime-disposal).

## Limitations

The example does not implement expression selection, modifier-click definition
navigation, context menus, configuration persistence or full upstream tooltip
geometry. Documentation is plain text, not rendered Markdown/math. Messages and
pinned source positions belong to the surrounding Infoview, not this example.

The upstream comparison in development/StrictMode can display
`RequestCancelled` after popup-effect replay. It is not a general upstream
React 19 compatibility guarantee. To investigate that mode:

```sh
VIR_INFOVIEW_COMPOSITION_MODE=development CHROMIUM=/path/to/chromium npm run test:infoview:composition
```

## Run the checks

After the [normal repository setup](../HARNESS.md):

```sh
CHROMIUM=/path/to/chromium npm run test:infoview:native
CHROMIUM=/path/to/chromium npm run test:infoview:composition
npm run check:bindings
npm run build:demo-package
npm run test:infoview
```

The focused commands build fresh component IR and use the existing compatible
`web/public/vir-upstream.wasm`; they do not rebuild Wasm. Results and previews
are written under `build/native-infoview-port/`. The composition test mounts the
actual upstream host with real Lean goal/popup RPCs, but synthetic widget discovery
and module inputs; it is not an actual VS Code-window test.
