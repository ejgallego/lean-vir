# API Coverage

This document is the canonical API coverage source. The machine-readable data
lives in the `vir-api-coverage` fenced block below. Tools that need a plain TSV
can generate `build/analysis/api-coverage.tsv` without duplicating it in Git.

The fenced block stays intentionally simple: tab-separated, one header row, one
feature per row, and no multiline fields. If this repository later grows a
Verso manual, keep this data in the documentation source as a named block or
directive and update `scripts/check-api-coverage.mjs` to extract it there; do
not move the source of truth back to a detached table.

This table records whether an API is implemented and available through the
runtime; it is not a type-fidelity audit. A `supported` row can still contain
individual bindings awaiting semantic review against their upstream contract.
Use the generated binding explorer for reviewed types, unmapped members, and
binding findings.

The columns are:

- `id`: stable machine identifier, using dotted lowercase segments.
- `area`: broad owner area such as `core`, `browser`, `react`, `infoview`, or
  `proofwidgets`.
- `layer`: smaller implementation layer such as `interface`, `dom`,
  `renderer`, `shell`, `surface`, `rpc`, or `compat`.
- `status`: one of `supported`, `partial`, or `missing`.
- `lean_surface`: Lean module, namespace, declaration family, or `none`.
- `js_surface`: JavaScript runtime module or `none`.
- `tests`: semicolon-separated validation tags or `none`.
- `notes`: short human summary. Do not use tabs or newlines.
- `next`: short follow-up item or `none`.

Useful commands:

```bash
node scripts/check-api-coverage.mjs
node scripts/check-api-coverage.mjs --write
```

```vir-api-coverage
id	area	layer	status	lean_surface	js_surface	tests	notes	next
core.interface.scalars	core	interface	supported	Vir.Interface;Vir.GeneratePackage	vir-runtime	test:runtime;test:fixtures	Nat Int Bool String Float Float32 UInt8 UInt16 UInt32 UInt64 USize ByteArray Unit supported	none
core.interface.containers	core	interface	supported	Vir.Interface;Vir.GeneratePackage	vir-runtime	test:runtime;test:fixtures	Array List Option Prod Sum Except over supported types supported	none
core.interface.structures	core	interface	supported	Vir.Interface;Vir.GeneratePackage	vir-runtime	test:runtime;test:fixtures	Non-indexed structures including inherited fields supported	none
core.interface.inductives	core	interface	partial	Vir.Interface;Vir.GeneratePackage	vir-runtime	test:runtime;test:fixtures	Custom inductives and simple recursive inductives supported; mutual non-uniform and inherited recursive structures limited	improve recursive and rectype coverage
core.interface.resources	core	interface	supported	Vir.Host	vir-runtime;vir-host-bindings	test:runtime	Exact JavaScript values cross the interpreter boundary through private externref roots	none
core.interface.js_collections	core	interface	supported	Vir.Js	vir-host-bindings	test:runtime	Js.Array and Js.NodeList preserve JS-owned containers; length item toArray and resource-specialized toLeanArray supported	none
core.interface.lean_ref	core	interface	supported	Vir.Js	vir-runtime;vir-host-bindings	test:runtime	LeanRef toJSL/fromJSL use self-owning JavaScript identity; normal reachability governs references and runtime teardown releases remaining Lean roots	none
core.interface.runtime_ref	core	interface	supported	Vir.Runtime	vir-runtime	test:runtime	RuntimeRef new get set modify and modifyGet share Lean-owned state across callbacks; replaced values follow Lean reference counting	none
core.interface.callbacks	core	interface	supported	Vir.Host;Vir.Browser;Vir.React	vir-runtime;vir-host-bindings	test:runtime;test:upstream	Lean closures are ordinary self-owning JavaScript functions; collection is a backstop and runtime disposal releases remaining roots	closure root allocation optimization
core.interface.expr	core	interface	supported	Vir.Interface;Vir.GeneratePackage	vir-runtime	test:runtime;test:fixtures	Lean.Expr and Level structural interface representation supported	none
core.package.markers	core	interface	supported	Vir.Attributes	vir-runtime	test:lake;test:runtime	vir_export selects explicit JavaScript calls and vir_startup selects exported zero-argument Unit startup hooks	none
browser.document.query	browser	dom	supported	Vir.Browser.Document	vir-host-bindings	test:runtime;test:upstream	querySelector querySelectorAll createElement getTitle setTitle supported; querySelectorAll returns Js.NodeList (Js Element)	none
browser.element.text_attr	browser	dom	supported	Vir.Browser.Element	vir-host-bindings	test:runtime;test:upstream	querySelector querySelectorAll getInnerHTML setInnerHTML getTextContent setTextContent getAttribute and setAttribute supported	none
browser.element.lifecycle	browser	dom	partial	Vir.Browser.Document;Vir.Browser.Element	vir-host-bindings	test:runtime;test:upstream	createElement appendChild remove classList add remove toggle and style setProperty supported	add replace only when a demo requires it
browser.canvas	browser	dom	supported	Vir.Browser.HTMLCanvasElement;Vir.Browser.CanvasRenderingContext2D	vir-host-bindings	test:runtime;test:upstream	canvas narrowing sizing 2D context rectangles paths styles state transforms and animation demo supported	none
browser.events	browser	dom	supported	Vir.Browser.Event;Vir.Browser.Element	vir-host-bindings	test:runtime;test:upstream	addEventListener removeEventListener target currentTarget key preventDefault and stopPropagation supported	none
browser.inputs	browser	dom	supported	Vir.Browser.HTMLInputElement;Vir.Browser.Event	vir-host-bindings	test:runtime;test:upstream	fromElement getValue setValue getChecked setChecked inputValue? formValue? inputChecked? supported	none
browser.timers	browser	dom	supported	Vir.Browser.Timer	vir-host-bindings	test:runtime;test:upstream	setTimeout clearTimeout setInterval clearInterval supported with explicit active-registration teardown	none
browser.animation	browser	dom	supported	Vir.Browser.Animation	vir-host-bindings	test:runtime;test:upstream	requestAnimationFrame cancelAnimationFrame supported with explicit active-registration teardown	none
react.root	react	renderer	supported	Vir.React.Root	vir-host-bindings	test:runtime;test:upstream	create createFromSelector mountFromSelector faithful renderNode plus Lean-composed render renderComponent renderIntoSelector renderComponentIntoSelector and unmountSelector	none
react.node.resource	react	renderer	supported	Vir.React.Node;Vir.React.ElementType	vir-host-bindings	test:runtime;test:upstream	Exact ReactNode ElementType Props and generic JS child-array values with native createElement and Fragment support	none
react.props.scalar	react	renderer	supported	Vir.React.Property;Vir.React.PropValue	vir-host-bindings	test:runtime;test:upstream	string bool int float props and raw escape hatches supported	none
react.props.style_class	react	renderer	supported	Vir.React.Property;Vir.React.PropValue	vir-host-bindings	test:runtime;test:upstream	style object and classList supported; style values are strings	typed CSS helpers
react.props.blessed	react	renderer	partial	Vir.React.Property	vir-host-bindings	test:runtime;test:upstream	id name className title role aria data tabIndex form input textarea select checkbox props covered	add missing common DOM props as demos require
react.events	react	renderer	supported	Vir.React.EventHandler	vir-host-bindings	test:runtime;test:upstream	onClick onInput onChange onSubmit and raw handler helpers supported	none
react.elements.blessed	react	renderer	partial	Vir.React.Node	vir-host-bindings	test:runtime;test:upstream	div span input textarea label form select option button section article header nav main ul li p pre code strong h1-h6 and text-child helpers covered; Lean helper declarations are table-driven	add details summary dialog as demos require
react.components	react	renderer	supported	Vir.React.Component;Vir.React.Hooks;Vir.React.StateTuple;Vir.React.ReducerTuple	vir-host-bindings	test:runtime;test:upstream	Exact reusable JavaScript component-function identity with nested keyed boundaries plus exact useState useReducer useRef useMemo useCallback useContext and native effect values; Lean function conversions remain explicit	add root options reducer initializer and context creation when required
infoview.widget_module	infoview	shell	supported	Vir.Infoview.Widget;Vir.Infoview.widget	vir-infoview-widget	test:infoview	Embedded ES module externalizes react react-dom and @leanprover/infoview	none
infoview.assets	infoview	shell	supported	Vir.Infoview.Assets;Vir.Infoview.readAsset;Vir.Infoview.statAsset	vir-infoview-widget	test:infoview	Local path asset read and stat over RPC with base64 byte transport supported	raw binary asset transport when host supports it
infoview.live_ir_package	infoview	shell	supported	Vir.Infoview.Package;Vir.Infoview.Widget;Vir.Infoview.IRPackage;Vir.Infoview.ReactWidget;vir_proof_widget;Vir.Infoview.buildIRPackage;Vir.Infoview.statIRPackage	vir-infoview-widget	test:infoview;test:upstream	Blessed widget activation uses bundled shell plus wasmPath plus live IRPackage built from active Lean server snapshot and closure-IR revision token	replace polling with editor invalidation signal when available
infoview.surface.cursor	infoview	surface	supported	Vir.Infoview.DocumentPosition	vir-infoview-widget	test:infoview;test:runtime;test:upstream	URI fileName zero-based line character and display label supported	none
infoview.surface.goals	infoview	surface	supported	Vir.Infoview.Surface;Vir.Infoview.Goal;Vir.Infoview.Hypothesis	vir-infoview-widget	test:infoview;test:runtime;test:upstream	Goals termGoal target hypotheses values fvarIds userName mvarId and status support context-derived proof actions	none
infoview.surface.selections	infoview	surface	supported	Vir.Infoview.SelectedLocation	vir-infoview-widget	test:infoview;test:runtime;test:upstream	Selected locations normalize to id kind and label for clients that need source selection context	none
infoview.clipboard	infoview	action	supported	Vir.Infoview.Clipboard	vir-host-bindings	test:runtime;test:upstream	writeText is exposed to Lean and used as the proof-action fallback when no editor is connected	none
infoview.command.reveal_position	infoview	action	supported	Vir.Infoview.Command	vir-host-bindings;vir-infoview-widget	test:runtime;test:upstream	revealPosition host command exposed to Lean and dispatched through upstream EditorConnection.revealPosition in the infoview shell	add location range reveal support
infoview.command.insert_text	infoview	action	supported	Vir.Infoview.Command	vir-host-bindings;vir-infoview-widget	test:runtime;test:upstream	insertText applies a zero-width workspace edit at a typed document position and powers the proof-action widget	none
infoview.rpc.commands	infoview	rpc	missing	none	none	none	No typed hover or go-to-definition command surface yet	add hover and go-to-definition APIs when a client requires them
infoview.rpc.refs	infoview	rpc	partial	Vir.Infoview.ProofWidgetsRpc;Vir.ProofWidgets.Rpc;Vir.Infoview.Surface	vir-host-bindings;vir-infoview-widget	test:infoview;test:runtime;test:upstream	Surface.proofWidgetsExpr carries a server-owned WithRpcRef ExprWithCtx prop through a Js ServerRef host resource; the infoview shell asks Lean.Vir.Infoview.createProofWidgetsExprWithCtxAtPos for the current interactive goal instead of synthesizing it in JavaScript; proofwidgets.rpc.resolveRef can resolve that standard Lean.Server.WithRpcRef path or fall back to descriptor refs with source position revision store-key and known-constant metadata	broaden ExprWithCtx beyond current goals plus edit and tactic APIs
proofwidgets.html_subset	proofwidgets	compat	partial	Vir.ProofWidgets.Html;Vir.ProofWidgets.Jsx;Vir.React.Node	vir-host-bindings;vir-infoview-widget	test:runtime;test:upstream	Shallow Html facade and native JSX lower directly to exact React values with text attributes spreads keyed child-bearing Lean components callbacks and the static Jsx.lean fixture	broaden Html/component parity only as real ports require
proofwidgets.rpc	proofwidgets	compat	partial	Vir.ProofWidgets.Rpc;Vir.ProofWidgets.Html;Vir.Infoview.ProofWidgetsRpc	vir-host-bindings;vir-infoview-widget	test:infoview;test:runtime;test:upstream	WithRpcRef resolveRef and ExprWithCtx.save support the InteractiveExpr-shaped compatibility fixture; editor edits use the narrower infoview command boundary	broaden ExprWithCtx only when a real client requires it
proofwidgets.build_integration	proofwidgets	compat	partial	Vir.Infoview.widget;scripts/build-infoview-widget.mjs	vir-infoview-widget	test:infoview	Repo-local esbuild bundle path works; no ProofWidgets package/build integration	add only if needed by real ProofWidgets example
```
