# Documentation

Start with [the application workflow](guides/EMBEDDED_RESOURCES.md), or the
[developer guide](DEVELOPER_GUIDE.md) to work on VIR itself.
Read [support scope](SUPPORT.md) for the officially supported boundary and
experimental conveniences; shipped coverage is not a support commitment.

## Guides: use VIR

- [Application setup](guides/EMBEDDED_RESOURCES.md): a complete plain greeting
  project, its Lake build, site publication and JavaScript call.
- [Lean library](guides/LEAN_VIR_LIBRARY.md#choose-a-boundary-representation): choose
  value representations for core interop,
  alongside explicitly identified experimental helpers.

## Experimental

- [Native-precompiled clients](guides/NATIVE_CLIENTS.md): native authoring tools,
  interface classification/encoding, library ownership and import migration.
- [DOM helpers](guides/LEAN_VIR_LIBRARY.md): browser receivers, events, timers and canvas.
- [React and JSX](guides/REACT.md): native values, components, hooks and implemented call shapes.
- [Infoview widgets and RPC](guides/INFOVIEW.md): editor activation, sessions, server
  references and ProofWidgets compatibility; try the
  [RPC tutorial](../examples/tutorials/RpcReferenceWidget.md).

## Reference: implementation contracts

- [Build internals](guides/BUILD_WORKFLOWS.md): Lake acquisition, generation,
  runtime distribution and retained contributor tools.
- [Optional resource contracts and lifecycle](guides/RESOURCE_LIFETIME.md):
  independent callable expectations, cancellation and overlapping loads.
- [Package tooling](guides/PACKAGES.md): loose compiler outputs and SDK installation.
  [Direct runtime calls](guides/CALL_LEAN_FROM_JS.md) and the
  [JavaScript runtime API](guides/JS_API.md) document the lower-level loader.
  These are not extra application setup steps.
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

- [Review assumptions](development/REVIEW_ASSUMPTIONS.md): supported inputs,
  validation boundaries, evidence and cross-project contract changes.
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

- [Runtime simplification](development/RUNTIME_SIMPLIFICATION.md) separates the
  Infoview loader cleanup from proposed runtime ownership and reload changes.
  [Use-case contracts](design/VIR_USE_CASES.md) state the behavior those changes
  must preserve and the remaining acceptance gaps.
- [Environment lookup](design/ENVIRONMENT_LOOKUP_PERFORMANCE.md) and
  [object conversion](design/OBJECT_CONVERSION_PERFORMANCE.md) record measured design
  decisions. Their timings belong to the recorded workloads and versions,
  not to every current build.
- [Package payload analysis](design/IRPKG_PAYLOAD_ANALYSIS.md) is a dated size snapshot,
  not a report of current package sizes.
