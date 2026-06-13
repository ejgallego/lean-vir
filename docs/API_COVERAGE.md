# API Coverage

This document is the canonical API coverage source. The machine-readable data
lives in the `vir-api-coverage` fenced block below. `docs/API_COVERAGE.tsv` is a
generated compatibility artifact for tools that prefer a plain TSV file.

The fenced block stays intentionally simple: tab-separated, one header row, one
feature per row, and no multiline fields. If this repository later grows a
Verso manual, keep this data in the documentation source as a named block or
directive and update `scripts/check-api-coverage.mjs` to extract it there; do
not move the source of truth back to a detached table.

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
core.interface.scalars	core	interface	supported	Vir.GeneratePackage	vir-runtime	test:runtime;test:fixtures	Nat Int Bool String Float Float32 UInt8 UInt16 UInt32 UInt64 USize ByteArray Unit supported	none
core.interface.containers	core	interface	supported	Vir.GeneratePackage	vir-runtime	test:runtime;test:fixtures	Array List Option Prod Sum Except over supported types supported	none
core.interface.structures	core	interface	supported	Vir.GeneratePackage	vir-runtime	test:runtime;test:fixtures	Non-indexed structures including inherited fields supported	none
core.interface.inductives	core	interface	partial	Vir.GeneratePackage	vir-runtime	test:runtime;test:fixtures	Custom inductives and simple recursive inductives supported; mutual non-uniform and inherited recursive structures limited	improve recursive and rectype coverage
core.interface.resources	core	interface	supported	Vir.Host	vir-runtime;vir-host-bindings	test:runtime	Opaque resource handles cross boundary by host-owned handles	none
core.interface.callbacks	core	interface	supported	Vir.Host;Vir.Browser;Vir.React	vir-runtime;vir-host-bindings	test:runtime;test:upstream	Lean closures retained by JS and released on remove cancel rerender unmount package reload or runtime dispose	closure release optimization
core.interface.expr	core	interface	supported	Vir.GeneratePackage	vir-runtime	test:runtime;test:fixtures	Lean.Expr and Level structural wire representation supported	none
browser.document.query	browser	dom	supported	Vir.Browser.Document	vir-host-bindings	test:runtime;test:upstream	querySelector getTitle setTitle supported	none
browser.element.text_attr	browser	dom	supported	Vir.Browser.Element	vir-host-bindings	test:runtime;test:upstream	getTextContent setTextContent getAttribute setAttribute supported	none
browser.element.lifecycle	browser	dom	missing	none	none	none	createElement append remove replace classList not exposed	add blessed DOM mutation API
browser.events	browser	dom	supported	Vir.Browser.Event;Vir.Browser.Element	vir-host-bindings	test:runtime;test:upstream	addEventListener removeEventListener target currentTarget preventDefault stopPropagation supported	none
browser.inputs	browser	dom	supported	Vir.Browser.HTMLInputElement;Vir.Browser.Event	vir-host-bindings	test:runtime;test:upstream	fromElement getValue setValue getChecked setChecked inputValue? formValue? inputChecked? supported	none
browser.timers	browser	dom	supported	Vir.Browser.Timer	vir-host-bindings	test:runtime;test:upstream	setTimeout clearTimeout supported including retained callback cleanup	none
browser.animation	browser	dom	supported	Vir.Browser.Animation	vir-host-bindings	test:runtime;test:upstream	requestAnimationFrame cancelAnimationFrame supported including retained callback cleanup	none
react.root	react	renderer	supported	Vir.React.Root	vir-host-bindings	test:runtime;test:upstream	create createFromSelector mountFromSelector render unmount plus selector-owned renderIntoSelector unmountSelector supported	none
react.html.tree	react	renderer	supported	Vir.React.Html	vir-host-bindings	test:runtime;test:upstream	Recursive text and element tree with optional key props handlers children supported	none
react.props.scalar	react	renderer	supported	Vir.React.Property;Vir.React.PropValue	vir-host-bindings	test:runtime;test:upstream	string bool int float props and raw escape hatches supported	none
react.props.style_class	react	renderer	supported	Vir.React.Property;Vir.React.PropValue	vir-host-bindings	test:runtime;test:upstream	style object and classList supported; style values are strings	typed CSS helpers
react.props.blessed	react	renderer	partial	Vir.React.Property	vir-host-bindings	test:runtime;test:upstream	id name className title role aria data tabIndex form input textarea select checkbox props covered	add missing common DOM props as demos require
react.events	react	renderer	supported	Vir.React.EventHandler	vir-host-bindings	test:runtime;test:upstream	onClick onInput onChange onSubmit and raw handler helpers supported	none
react.elements.blessed	react	renderer	partial	Vir.React.Html	vir-host-bindings	test:runtime;test:upstream	div span input textarea label form select option button section article header nav main ul li p pre code strong and h1-h6 helpers covered; Lean helper declarations are table-driven	add table details summary dialog as demos require
react.components	react	renderer	missing	none	none	none	No Lean component abstraction beyond functions returning Html	add blessed component pattern
infoview.widget_module	infoview	shell	supported	Vir.Infoview.widget	vir-infoview-widget	test:infoview	Embedded ES module externalizes react react-dom and @leanprover/infoview	none
infoview.assets	infoview	shell	supported	Vir.Infoview.readAsset;Vir.Infoview.statAsset	vir-infoview-widget	test:infoview	Local path asset read and stat over RPC with base64 byte transport supported	raw binary asset transport when host supports it
infoview.live_ir_package	infoview	shell	supported	Vir.Infoview.IRPackage;Vir.Infoview.buildIRPackage;Vir.Infoview.statIRPackage	vir-infoview-widget	test:infoview;test:upstream	Live package built from active Lean server snapshot and range-token stat reload supported	dependency fingerprinting for imported live widget helpers
infoview.surface.cursor	infoview	surface	supported	Vir.Infoview.DocumentPosition	vir-infoview-widget	test:infoview;test:runtime;test:upstream	URI fileName zero-based line character and display label supported	none
infoview.surface.goals	infoview	surface	supported	Vir.Infoview.Surface;Vir.Infoview.Goal;Vir.Infoview.Hypothesis	vir-infoview-widget	test:infoview;test:runtime;test:upstream;test:pages:browser	Goals termGoal target hypotheses values fvarIds userName mvarId status supported and shown in ReactProofWidget API strip	none
infoview.surface.selections	infoview	surface	supported	Vir.Infoview.SelectedLocation	vir-infoview-widget	test:infoview;test:runtime;test:upstream;test:pages:browser	Selected locations normalized to id kind label supported and shown in ReactProofWidget surface panel	none
infoview.clipboard	infoview	action	supported	Vir.Infoview.Clipboard	vir-host-bindings	test:runtime;test:upstream;test:pages:browser	writeText host command exposed to Lean and showcased by ReactProofWidget target/context copy actions	add typed edit and hover commands
infoview.command.reveal_position	infoview	action	supported	Vir.Infoview.Command	vir-host-bindings;vir-infoview-widget	test:runtime;test:upstream;test:pages:browser	revealPosition host command exposed to Lean and dispatched through upstream EditorConnection.revealPosition in the infoview shell	add location range reveal support
infoview.rpc.commands	infoview	rpc	missing	none	none	none	No typed edit hover go-to-definition command surface yet	add typed edit hover and go-to-definition APIs
infoview.rpc.refs	infoview	rpc	missing	none	none	none	No server-side references or widget-specific RPC handle model yet	add narrow RPC reference model
proofwidgets.html_subset	proofwidgets	compat	partial	Vir.React.Html	vir-host-bindings;vir-infoview-widget	test:runtime;test:upstream	Substrate supports recursive Html and callbacks but no ProofWidgets-style DSL	add blessed Html DSL close to ProofWidgets.Data.Html
proofwidgets.rpc	proofwidgets	compat	missing	none	none	none	ProofWidgets edit RPC tactic UI and expression interaction APIs not implemented	start with typed edit command and location model
proofwidgets.build_integration	proofwidgets	compat	partial	Vir.Infoview.widget;scripts/build-infoview-widget.mjs	vir-infoview-widget	test:infoview	Repo-local esbuild bundle path works; no ProofWidgets package/build integration	add only if needed by real ProofWidgets example
```
