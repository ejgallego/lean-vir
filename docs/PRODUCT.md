# VIR Product Direction

Status: Living
Owner: VIR maintainers
Last reviewed: 2026-08-13
Validated baseline: Lean 4.33.0-rc2 at the
[2026 project review](project-review/PROJECT_REVIEW.md)

## Purpose

VIR lets developers run selected Lean declarations and Lean-authored
interaction in a browser through Lean's real IR interpreter. It is intended for
cases where sharing Lean code and semantics with a client is more valuable
than rewriting the logic in JavaScript or operating a Lean server.

VIR is not an attempt to place an unrestricted Lean process in every browser.
The product thesis is a bounded, versioned execution substrate for
project-controlled Lean code.

## Primary Users And Jobs

The initial user is a Lean library or application developer who controls both
the Lean source and the web application. The primary jobs are:

1. call selected Lean logic from an existing browser application;
2. author a small browser interaction, canvas, or presentation in Lean;
3. reuse Lean data types and functions without maintaining a second
   TypeScript implementation; and
4. deploy the result as ordinary static web assets without a Lean backend.

Infoview and ProofWidgets integration remains a promising adjacent use case,
but it is not the first productization pilot.

## Usage Path

```text
Lean source
  -> @[vir_export] and @[vir_startup]
  -> Lake module :vir facet
  -> trusted .irpkg declaration package
  -> commit-matched development SDK, later tagged :virSdk artifact
  -> browser JavaScript runtime
  -> explicit calls, startup hooks, callbacks, and selected host APIs
```

The Wasm runtime contains Lean's unmodified upstream IR interpreter, selected
Lean runtime support, a package-backed declaration provider, and a restricted
native-symbol surface. The JavaScript layer owns loading, value conversion,
host resources, callbacks, and browser integration.

## Current Development Contract

The currently validated development boundary is:

- trusted packages generated from Lean source controlled by the project;
- a matching VIR SDK, package format, and Lean toolchain;
- one active package set per runtime instance;
- explicit calls and startup hooks declared in the package interface;
- synchronous JavaScript host imports;
- documented scalar, container, structure, inductive, recursive,
  `ByteArray`, and expression shapes; and
- selected resource, callback, reload, and disposal behavior covered by the
  current tests, without a compatibility promise beyond the exact revision.

Experimental surfaces include browser binding authoring, resource and callback
ownership across cancellation and replay, React components and hooks,
infoview loading, and partial ProofWidgets compatibility. The first supported
release surface is intentionally not frozen while those binding and lifecycle
semantics are being resolved.

VIR does not currently promise:

- safe execution of arbitrary uploaded or third-party packages;
- general `.olean`, `.ir`, or complete Lean module loading;
- asynchronous Promise-valued host imports;
- unrestricted native or dynamic symbol lookup;
- full React or ProofWidgets compatibility;
- native execution speed; or
- compatibility between unmatched Lean, SDK, and package revisions.

The detailed API inventories remain in
[LEAN_VIR_LIBRARY.md](LEAN_VIR_LIBRARY.md),
[JS_API.md](JS_API.md), and [API_COVERAGE.md](API_COVERAGE.md).

## First Productization Pilot

The first pilot, following the completed internal all-hands, remains the
Lake/browser path.
It is a learning pilot, not a declaration that the current binding API is
stable. A real downstream project should:

1. mark selected declarations;
2. build a package through `:vir`;
3. install an exact commit-matched SDK initially, and exercise a tagged SDK
  once the binding/lifecycle gate permits the first release;
4. call one explicit export and execute one startup hook;
5. deploy the result as a static browser application; and
6. repeat the workflow after changing the package or SDK.

The pilot is successful only if the user can repeat the workflow without the
original guided session and if VIR has a clear advantage over the best
available alternative at an acceptable support cost.

The comparison against that alternative follows the multidimensional contract
in [ALTERNATIVES.md](ALTERNATIVES.md): semantic parity, time to first correct
result, warm execution, deployable size, memory, integration effort, and
update behavior remain separate observations. The pilot does not inherit a
universal winner from a microbenchmark.

Execution is tracked by
[L-002](project-review/cards/active/L-002-lake-browser-pilot.md). The product
decision after the pilot is `continue`, `revise`, or `stop`; productization
sponsorship does not predetermine the evidence.

## Product Signals

The strongest signals are:

- repeated use by someone other than the primary maintainer;
- a tagged release consumed from a clean downstream repository;
- a workflow that is materially simpler or more faithful than its alternative;
- bounded support and upgrade cost; and
- reuse by a second project without broadening the trust boundary.

Before the first release, an additional product signal is required: one
coherent ownership and lifecycle contract should cover the representative DOM,
callback, cancellation, reload, disposal, and React cases that the release
claims to support.

The all-hands added a second evidence requirement: accepted JS/VIR/FIR claims
must come from frozen artifacts and a controlled, reproducible comparison
protocol. That work is tracked by
[L-004](project-review/cards/active/L-004-js-vir-fir-comparison.md).

Repository demos, test breadth, and technical feasibility are necessary
evidence, but they do not substitute for repeated user use.
