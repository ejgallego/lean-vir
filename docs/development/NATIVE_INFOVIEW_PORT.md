# Native goal panel: port and API evaluation

`examples/VirNativeInfoview.lean` hosts a Lean-owned goal panel and interactive
code renderer inside the existing infoview. This is a behavioral port in progress,
not a replacement for the infoview shell. Messages and pinned positions are out
of scope.

The reference is `@leanprover/infoview` **0.13.0**, source commit
`66528403779d277160f1e9b9ee54de1ac24b8fec`:
[goals.tsx](https://github.com/leanprover/vscode-lean4/blob/66528403779d277160f1e9b9ee54de1ac24b8fec/lean4-infoview/src/infoview/goals.tsx)
and [interactiveCode.tsx](https://github.com/leanprover/vscode-lean4/blob/66528403779d277160f1e9b9ee54de1ac24b8fec/lean4-infoview/src/infoview/interactiveCode.tsx).

## External-component checkpoint

Open `examples/VirNativeInfoview/Comparison.lean` in VS Code and move through the
proof. Its widget displays two independently mounted panels with the same
incoming goals:

- **Lean port:** goal presentation and interactive code are Lean-owned.
- **Upstream component checkpoint:** goal presentation is the same Lean code;
  expression rendering and interaction use upstream's TypeScript `InteractiveCode`.

The main `VirNativeInfoview.lean` example still uses only the Lean renderer.
Composition is a checkpoint and interoperability example, not completion of the
port. The destination remains Lean-owned infoview-specific UI and behavior;
React, browser primitives and server/transport services remain dependencies.

`VirNativeInfoview/Composition.lean` contains the complete composition boundary:

```lean
def View : RuntimeM (FunctionComponent PanelWidgetProps) := do
  let Upstream ← interactiveCode
  GoalPanel.withCode fun fmt => do
    <Upstream fmt={fmt}/>
```

The generated getter returns the exact public component from
`@leanprover/infoview`; React invokes it. JSX creates an ordinary props object,
preserving `fmt` and its nested RPC references. There is no traversal, foreign
render wrapper, duplicated goal panel, or RPC implementation in this checkpoint.
The getter uses ordinary React props, so the required `fmt` field is a documented
caller contract rather than a statically enforced Lean record.

The host supplies the component from the same infoview instance as its contexts.
It fails explicitly when unavailable; it does not silently fall back to stripped
text. Standalone hosts cannot obtain working popups merely by supplying the
deprecated `RpcContext`: the component uses upstream's position, capabilities
and private RPC-session contexts.

This is a small composition boundary versus the Lean renderer's explicit state,
traversal and effect code. It is not a like-for-like size comparison yet:
upstream also supplies selection/navigation and richer tooltips still missing
from the port. Keeping the goal panel shared makes that difference inspectable.

## Responsibilities and current parity

| Module | Ported behavior |
| --- | --- |
| `VirNativeInfoview/Goals.lean` | Seven presentation settings; upstream filtering order and anonymous-name behavior; unfiltered copy formatting |
| `VirNativeInfoview/GoalPanel.lean` | Tactic goals and expected type; custom/empty prefixes; reverse order; first-goal emphasis; local collapse and settings; clipboard action |
| `VirNativeInfoview/InteractiveCode.lean` | Native text/append/tag traversal; highlighted text and six diff tags; hover/focus type RPC; click/keyboard pinning; close/error/loading states; cancellation and late-response guard |

Goal identity and local collapse survive cursor updates and goal reordering.
Expected-type identity does not depend on the tactic-goal count. Incoming native
objects are retained without cloning or mutation, including the exact reference
passed to `Lean.Widget.InteractiveDiagnostics.infoToInteractive`.

Pragmatic UI choices: settings use an accessible disclosure with checkboxes;
popups render inline; documentation remains plain text; settings belong to each
mounted panel. The upstream session, transport, editor context and widget host
remain responsible for integration with Lean and the editor.

Remaining interactive-code parity is substantive: hypothesis/target/subexpression
selection, modifier-key definition navigation, context menus, floating/nested
tooltip geometry and Markdown/math documentation. There is no upstream config
persistence or screenshot-level visual parity claim. Selection and navigation
are the next useful API exercise, before adding further cosmetic fidelity.

## API assessment

The useful division so far is **native data at the boundary, Lean records for
presentation state, and ordinary React component/effect lifecycles**.

- Native JSX plus `js%{}` handles element props and styles without a builder
  catalogue. `Html.text` makes Lean-string conversion explicit but compact.
- The native renderer's `CodeProps` is a compile-time schema with one
  `fmt : Js CodeWithInfos` field. `<Code fmt={value}/>` constructs native props;
  `js_field% props "fmt"` projects the exact value without a Lean record or
  `WithData` box. External-component props remain the separate boundary above.
- `Props.WithData` and `LeanRef` keep internal records and functional state
  updates straightforward. Reconstructing these as JavaScript records would add
  conversions without serving an upstream API.
- Presentation projections retain each original hypothesis alongside its visible
  names. Object-spread/update notation is not needed to implement filtering.
  Names are decoded for the existing Lean filtering rules, but the projection
  retains the native string and computed inaccessible flag for display; it does
  not re-encode the name. Goal prefixes remain native throughout display.
- Name filtering builds that projection in one pass; anonymous-name checks use
  substring matching without splitting strings. The empty-bundle decision still
  precedes anonymous-name removal, so anonymous-only bundles remain visible.
- Names, hypotheses and goal cards compose as `Array Html` directly, without
  first executing the children and then mapping `pure` over their nodes. This
  removes intermediate staging, not the remaining Lean arrays. Native array
  literals already use `js#[]`; easier native iteration, mapping and JSX splicing
  remain API follow-ups, including the proposed `js%[]` authoring surface.
- Stable factories are constructed once, outside render. The recursive tagged
  renderer passes a render closure to a stable tag component; it needs no mutable
  self-reference or generic component framework.
- Append traversal reads native children by index and pushes rendered nodes
  directly into the native output array. Only the loop bound/index cross into
  Lean; neither the input entries nor output nodes are staged in Lean arrays.
- Ten exact field projections suffice for this slice. Tagged unions still require
  manual narrowing, and `Js.Object.get` erases field knowledge. This is a better
  target for a small API improvement than adding many presentation helpers.
- After the construction refinement, tuple and array parameters both describe
  native shapes. The consumer tag-tuple declaration follows that convention.
- Exact-object component calls use `@props={props}`. JSX component identifiers
  are tracked by the elaborator; the previous false-positive unused-variable
  warnings are gone without disabling linting.

A live-server test exposed a boundary discrepancy absent from the initial
fixtures: Lean encodes missing popup documentation as `null`, although the
pinned TypeScript declaration says `doc?: string`. The popup renderer explicitly
treats `null` and `undefined` as absence for optional popup fields. It does not
coerce non-string code or documentation to text, nor normalize the original
server objects. The local wire policy is explicit: omitted, `undefined`, and
`null` documentation mean absence; an empty primitive string produces no doc
element; a nonempty primitive string is displayed literally, preserving Unicode,
whitespace and Markdown characters. Other present values must pass the existing
`Js.String.fromAny` check: they are not converted with JavaScript `String(...)`
or accepted as string-wrapper objects. This consumer policy does not change the
upstream TypeScript declaration or general optional-field semantics. Focused
regressions cover the absence/empty cases, literal Unicode documentation and
null optional code. Malformed Boolean/number/array/boxed-string/coercible-object
docs are rejected by the primitive-string check without coercion; the existing
render error propagates to the embedding host's error boundary and unmounting
cleans up the popup request. This is not a new in-panel error-recovery policy.
Validated documentation stays `Js String`: native `Js.String.length` supplies
the empty/nonempty test, and `Node.text` displays it directly. Only the length
crosses into Lean for control flow; documentation is not decoded and re-encoded.

The port also exceeded the shared demo package's 128-import limit. It now has a
separate `native-infoview.irpkg` entry in the existing browser package catalog;
`build:demo-package` builds both packages. This keeps the runtime format unchanged
and tests the same module-sized packaging used by the infoview host.

## Validation

After the normal dependency/runtime setup:

```sh
CHROMIUM=/path/to/chromium npm run test:infoview:native
CHROMIUM=/path/to/chromium npm run test:infoview:composition
npm run check:bindings
npm run build:demo-package
npm run test:infoview
```

The focused command builds the Lean component and generates fresh IR, then runs
the actual interpreter with official React in Chromium. It checks 86 behaviors:
filters, copying, state isolation/reconciliation, native identity, expected-type
transitions, tagged text/diffs, popup interaction, cancellation, errors and null
fields, including pinned-popup identity and request lifetime across sibling text
updates during native append traversal. React warnings are failures.
Boundary probes also verify exact native `fmt` props without `WithData`, native
documentation length checks and absence of documentation decoding to Lean strings.
They also forbid hypothesis-name re-encoding and custom-prefix round trips.

The first conversion-reduction pass measured the same two initial panel mounts:
`js.string.value` calls decreased from 28 to 24 and `js.string` calls from 982
to 966. These are bridge-call counts, not a timing or allocation benchmark;
encoding counts include literals, property names and formatted strings. The
fixture records current counts in `result.json`; the prior control is retained
in `conversions-before.json`. Lean filtering/copy formatting and genuine
Lean-owned state/closure boxes remain explicit rather than hidden by helpers.

A second stage uses a real Lean server and official `RpcSessions` at two source
positions under React StrictMode. Each position fetches goals and type
information. The test injects the exact official position session through a
small React context; it does not pretend to mount the full VS Code infoview.

The composition command separately generates fresh comparison IR and mounts it
inside the actual upstream `renderInfoview` host. Widget discovery and module
source are synthetic test inputs; goal and popup RPCs go to real Lean at two
positions. This exercises the public component, exact native `fmt`, real private
host contexts and independent Lean goal settings without reimplementing the
component in the test. The harness adapts React 18's `react-dom.createRoot` entry
point to this workspace's React 19 client export and retains the root for
teardown; production code does not need this test adapter.

This comparison acceptance uses production React, as the shipped infoview does.
An experimental development run exposed an upstream lifecycle caveat: a popup
request can be cancelled during StrictMode effect replay and leave
`RequestCancelled` displayed rather than retrying. The native renderer's separate
development/StrictMode acceptance stays enabled. To investigate the external
component's development behavior without changing its implementation:

```sh
VIR_INFOVIEW_COMPOSITION_MODE=development CHROMIUM=/path/to/chromium npm run test:infoview:composition
```

This is a recorded limitation, not a passing development-mode gate or a claim of
fully qualified upstream React 19 support.
The bounded comparison gate uses leaf `n`/`p` type popups. An exploratory
outer-expression popup with large documentation emitted a browser ResizeObserver
loop warning; large-tooltip geometry remains a separate qualification task.

Results and a static visual preview are written under
`build/native-infoview-port/`. The fixture probe is also reused by the existing
native-infoview pages acceptance test. The focused command uses the existing
`web/public/vir-upstream.wasm`: fresh component IR is not evidence of a fresh
whole-Wasm build. Follow `docs/HARNESS.md` when runtime sources have changed.
