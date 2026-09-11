# Documentation

Start with the [quickstart](../README.md) to use VIR, or the
[developer guide](DEVELOPER_GUIDE.md) to change its implementation.

## Use VIR

- [Packages](PACKAGES.md): register modules, select exports, build/load packages
  and install the browser SDK.
- [Lean library](LEAN_VIR_LIBRARY.md): effects, boundary values and API entry points.
- [Call Lean from JavaScript](CALL_LEAN_FROM_JS.md): an end-to-end example;
  [JavaScript API](JS_API.md) is the runtime reference.
- [React](REACT.md): native values, components, hooks, JSX and supported calls.
- [Infoview widgets and RPC](INFOVIEW.md): editor activation, sessions, server
  references and ProofWidgets compatibility; try the
  [RPC tutorial](../examples/tutorials/RpcReferenceWidget.md).

## Extend and maintain

- [Host bindings](HOST_BINDINGS.md) owns JS identity, foreign-value lifetime,
  rollback, UI cleanup and runtime disposal.
- [Binding translation](BINDING_MODALITIES.md) and the
  [binding reference workflow](SHIPPED_BINDINGS.md) cover generation and review.
  [Type anchors](TYPE_ANCHORS.md) are separate structural-debugging fixtures.
- [Examples and fixtures](EXAMPLES_AND_FIXTURES.md) covers contribution and oracle
  rules; [Harness](HARNESS.md) selects checks and explains their prerequisites.
- [Performance](PERFORMANCE.md) and the [browser benchmarks](../benchmarks/browser/README.md)
  cover measurement. [Surface analysis](SURFACE_ANALYSIS.md) inspects static
  dependencies; the [API inventory](API_COVERAGE.md) is a separate coverage record.

## Implementation reference

- [Generator](GENERATE_PACKAGE.md): module inputs, closure selection and output.
- [Package format](IRPKG_FORMAT.md): binary sections and embedded manifest/types.
- [Object ABI](OBJECT_ABI.md): Lean object construction and pointer ownership.
- [Upstream boundary](UPSTREAM_BOUNDARY.md): interpreter and package-provider contract.
- [Client-native externs](CLIENT_NATIVE_EXTERNS.md): C/C++ provider integration.

Contribution and coordination rules live in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Design and evidence

The [upstream proposal](roadmap/README.md) explains the declaration-provider
API request and the experiment behind it.

- [Environment lookup](ENVIRONMENT_LOOKUP_PERFORMANCE.md) and
  [object conversion](OBJECT_CONVERSION_PERFORMANCE.md) record measured design
  decisions. Their timings belong to the recorded workloads and versions,
  not to every current build.
- [Package payload analysis](IRPKG_PAYLOAD_ANALYSIS.md) is a dated size snapshot,
  not a report of current package sizes.
