# Documentation

Start with the [quickstart](../README.md) to use VIR, or the
[developer guide](DEVELOPER_GUIDE.md) to change its implementation.

## Guides: use VIR

- [Packages](guides/PACKAGES.md): register modules, select exports, build/load packages
  and install the browser SDK.
- [Lean library](guides/LEAN_VIR_LIBRARY.md): effects, boundary values and API entry points.
- [Call Lean from JavaScript](guides/CALL_LEAN_FROM_JS.md): an end-to-end example;
  [JavaScript API](guides/JS_API.md) is the runtime reference.
- [React](guides/REACT.md): native values, components, hooks, JSX and supported calls.
- [Infoview widgets and RPC](guides/INFOVIEW.md): editor activation, sessions, server
  references and ProofWidgets compatibility; try the
  [RPC tutorial](../examples/tutorials/RpcReferenceWidget.md).

## Reference: implementation contracts

- [Host bindings](reference/HOST_BINDINGS.md) owns JS identity, foreign-value lifetime,
  rollback, UI cleanup and runtime disposal.
- [Binding translation](reference/BINDING_MODALITIES.md) and the
  [binding reference workflow](SHIPPED_BINDINGS.md) cover generation and review.
  [Type anchors](TYPE_ANCHORS.md) are separate structural-debugging fixtures.
- [Generator](reference/GENERATE_PACKAGE.md): module inputs, closure selection and output.
- [Package format](reference/IRPKG_FORMAT.md): binary sections and embedded manifest/types.
- [Object ABI](reference/OBJECT_ABI.md): Lean object construction and pointer ownership.
- [Upstream boundary](reference/UPSTREAM_BOUNDARY.md): interpreter and package-provider contract.
- [Client-native externs](reference/CLIENT_NATIVE_EXTERNS.md): C/C++ provider integration.

## Development: contribute and validate

- [Examples and fixtures](development/EXAMPLES_AND_FIXTURES.md): contribution and oracle
  rules; [Harness](HARNESS.md): checks and their prerequisites.
- [Performance](development/PERFORMANCE.md) and the
  [browser benchmarks](../benchmarks/browser/README.md): measurement workflows.
- [Surface analysis](development/SURFACE_ANALYSIS.md): static dependencies;
  [API inventory](API_COVERAGE.md): tracked coverage.
- [CONTRIBUTING.md](../CONTRIBUTING.md): contribution rules;
  [Mailbox protocol](development/MAILBOX_PROTOCOL.md): agent coordination.

## Design: proposals and dated evidence

The [upstream proposal](design/IR_DECLARATION_LOOKUP.md) explains the declaration-provider
API request and the experiment behind it.

- [Environment lookup](design/ENVIRONMENT_LOOKUP_PERFORMANCE.md) and
  [object conversion](design/OBJECT_CONVERSION_PERFORMANCE.md) record measured design
  decisions. Their timings belong to the recorded workloads and versions,
  not to every current build.
- [Package payload analysis](design/IRPKG_PAYLOAD_ANALYSIS.md) is a dated size snapshot,
  not a report of current package sizes.
