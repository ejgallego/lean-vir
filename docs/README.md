# Documentation

Start with the [quickstart](../README.md) to use VIR, or the
[developer guide](DEVELOPER_GUIDE.md) to change its implementation.
The guides below own the detailed contracts; this page is a route to them,
not a second API inventory.

## Find a guide

- **Use VIR in a Lean project:** [Lake integration](LAKE_INTEGRATION.md)
  covers exports, module facets and SDK installation; the
  [Lean library reference](LEAN_VIR_LIBRARY.md) covers the host APIs.
- **Call Lean from JavaScript:** follow the [end-to-end guide](CALL_LEAN_FROM_JS.md),
  then consult the [runtime API](JS_API.md).
- **Generate or inspect a package:** start with [local packages](LOCAL_IRPKG.md).
  See [module input rules](MODULE_INPUTS.md) for compiled and live snapshots,
  [interface manifests](INTERFACE_PIPELINE.md) for configuration and types, and
  [the binary format](IRPKG_FORMAT.md) or [generator internals](GENERATE_PACKAGE.md)
  when changing the producer.
- **Build a browser or infoview widget:** use the [React guide](REACT_NODE.md).
  The [RPC tutorial](../examples/tutorials/RpcReferenceWidget.md) demonstrates a
  real server method; the [RPC contract](PROOFWIDGETS_RPC_COMPATIBILITY.md)
  explains sessions, Promises, references and current authoring limits.
- **Add or audit a binding:** read the [translation contract](BINDING_MODALITIES.md)
  and [binding reference workflow](SHIPPED_BINDINGS.md). The
  [React fidelity audit](REACT_API_FIDELITY.md) compares supported calls and gaps;
  [type anchors](TYPE_ANCHORS.md) are separate structural-debugging fixtures,
  not the shipped-binding audit.
- **Understand ownership or change the runtime:** the [host contract](HOST_BINDINGS.md)
  owns JS identity, foreign-value lifetime, UI cleanup and runtime disposal.
  Use the [object ABI](OBJECT_ABI.md) and [upstream boundary](UPSTREAM_BOUNDARY.md)
  for interpreter details, or [client-native externs](CLIENT_NATIVE_EXTERNS.md)
  to supply a C/C++ provider.
- **Run checks or add an example:** the [harness guide](HARNESS.md) selects checks;
  [examples and fixtures](EXAMPLES_AND_FIXTURES.md) explains where client code
  belongs, and [adding demos](ADDING_DEMOS.md) gives the browser workflow.
- **Investigate support or performance:** distinguish the [API inventory](API_COVERAGE.md),
  [tested fixture surface](FIXTURE_COVERAGE.md) and
  [static dependency analysis](SURFACE_ANALYSIS.md). For timing and profiling,
  start with [performance](PERFORMANCE.md) and the
  [browser benchmark guide](../benchmarks/browser/README.md).

Contribution and coordination rules live in [CONTRIBUTING.md](../CONTRIBUTING.md)
and the [agent mailbox protocol](MAILBOX_PROTOCOL.md).

## Proposals and follow-up work

The [roadmap index](roadmap/README.md) links scoped upstream questions and
proposed extensions. Those plans are not current API guarantees. Some reference
guides also contain explicitly marked future-work sections; that does not make
their implemented contracts proposals.

## Design rationale and historical evidence

- [Implementation notes](IMPLEMENTATION_NOTES.md) collect architecture rationale
  and implementation history; use the task guides above for current workflows.
  [Wasm interop](REACT_WASM_BINDINGS.md) explains the current boundary and
  possible future features; [callback notes](EVENT_CALLBACK_ROADMAP.md) likewise
  cover current behavior as well as remaining work.
- [Environment lookup](ENVIRONMENT_LOOKUP_PERFORMANCE.md) and
  [object conversion](OBJECT_CONVERSION_PERFORMANCE.md) record measured design
  decisions. Their timings belong to the recorded workloads and versions,
  not to every current build.
- [Surface experiments](SURFACE_EXPERIMENTS.md) preserve historical decisions,
  and [package payload analysis](IRPKG_PAYLOAD_ANALYSIS.md) is a dated size
  snapshot. Neither is a current coverage or size report.

When editing documentation, follow the [writing policy](../CONTRIBUTING.md#documentation):
keep enduring contracts and useful rationale, not routine development logs.
