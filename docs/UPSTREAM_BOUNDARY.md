# Upstream Interpreter Boundary

VIR runs Lean's real IR interpreter in `wasm32-wasip1` over package-owned
`Lean.IR.Decl` objects. This guide owns the native calling, declaration-provider
and interpreter lifecycle contracts. [HOST_BINDINGS.md](HOST_BINDINGS.md) owns
JavaScript identity and foreign-value lifetime; [OBJECT_ABI.md](OBJECT_ABI.md)
owns the object-helper interface.

## Boundary and provenance

Keep `third_party/lean4-src/src/library/ir_interpreter.cpp` unmodified and compile
it against the pinned Lean headers. Link upstream runtime implementations before
adding local providers. Local WASI policy and unsupported operations must remain
explicit in [the shim](../wasm/upstream_shim/README.md); a stub is not an
implementation of an operation required by a new workload.

The build selects upstream runtime, utility and kernel sources plus pinned
stage0 C modules from
[`native-support-sources.txt`](../wasm/upstream_shim/native-support-sources.txt).
The [build script](../scripts/build-upstream-probe.sh) owns that source selection.
Its generated `lean/config.h` leaves `LEAN_MIMALLOC` disabled because the pinned
source checkout lacks vendored mimalloc sources for a WASI rebuild; Lean's
ordinary allocator is used. The `githash.h` overlay records the source commit,
and `LEAN_BUILD_TYPE` is supplied to the platform implementation.

Local `Name`, `Level` and `Expr` constructors let the package decoder and object
ABI create real Lean objects without loading the full generated Lean-library
constructor modules. Their fields and cached hash/data layout must agree with
the linked kernel operations. `VIR_USE_UPSTREAM_KERNEL_EXPR_DATA` disables
duplicate local cached-data exports when upstream `expr.cpp`/`level.cpp` supply
them. The remaining level hash/depth helpers read that layout, and the binder-info
helper reads the actual binder field, returning `.default` for non-binders.

Native lookup is closed: `dlsym` accepts only the generated native registry and
finite package host-import trampoline symbols. An `@[extern]` declaration alone
does not prove provider availability. Project providers extend this static
selection through [CLIENT_NATIVE_EXTERNS.md](CLIENT_NATIVE_EXTERNS.md), using the
same manifest for package native-over-fallback selection and the Wasm build.

## Native boxed wrappers

[`NativeExternSpec`](../Vir/GeneratePackage/NativeExterns.lean) stores VIR policy:
declaration name, wrapper selection, explicit closure dependencies and an optional
provider-symbol override. Its resolver obtains parameter IR types, borrow bits
and result IR type from `Lean.IR.findEnvDecl`, and the C symbol from
`Lean.getExternNameFor` unless explicitly overridden. Package generation, wrapper
generation, surface analysis and catalog validation consume this resolved
metadata. Provider selection remains VIR policy, not a compiler-metadata inference.

The upstream interpreter invokes native functions through homogeneous boxed
calls. Lean's normal `_boxed` declarations, with native `___boxed` symbols,
perform scalar conversion and reference-count operations inferred by LCNF.
Set `generateBoxedWrapper := true` when that compiler output is sufficient.
The generator emits selected raw Lean bodies when available; imported
implementation closures available only in compiled upstream output use the
listed stage0 providers. Canonical inline runtime operations can likewise be
materialized by generated adapters without a new shim provider.

Local behavior belongs in raw providers. The three handwritten boxed ownership
exceptions are `Array.ugetBorrowed`, `Array.getInternalBorrowed` and
`Array.get!InternalBorrowed`. In
[`native_symbols.cpp`](../wasm/upstream_shim/runtime/native_symbols.cpp), they
consume temporary input references retained by the interpreter and return the
raw borrowed result. The calling IR also treats that result as borrowed;
adding a result retain would leak. Do not replace these wrappers by an
apparently equivalent owned getter or infer ownership from the symbol spelling.
The native-wrapper inventory enforces this explicit exception set.

A shared raw symbol does not establish an interchangeable boxed ABI. For example,
`UInt8.ofNatLT` needs its own lookup stem despite sharing `lean_uint8_of_nat`
with `UInt8.ofNat`; its proof argument changes the call shape.
`String.Pos.set`, `String.Pos.Raw.set` and `String.set` also have distinct stems
for different boxed arities over one raw helper. Package calls preserve
irrelevant arguments, so proof-bearing operations require an independently
checked interpreter/wrapper match. Registration and successful linking alone
are insufficient; remaining unsupported cases are listed below.

Native constants use symbol addresses, not boxed nullary function calls.
For example, `ByteArray.empty` is registered as `l_ByteArray_empty`, initialized
once and marked persistent by the interpreter bridge.

The build prelinks local exceptions, generated adapters and pinned stage0
support in that precedence order. Duplicate-definition tolerance is confined
to this relocatable bundle; an `llvm-nm` audit rejects collisions outside the
explicit local/generated symbol set. The final Wasm link remains strict.
Keep provider overrides explicit, and remove an override when it becomes
redundant according to the metadata check.

## Real IR and declaration lookup

`lean_ir_find_env_decl` and `lean_ir_find_env_decl_boxed` delegate to
[`package/decl_provider.h`](../wasm/upstream_shim/package/decl_provider.h).
The provider returns `Option Decl` in Lean's actual constructor layout:

- `Fun`/`Extern` declarations carry the real names, parameters, result type and
  body. Unused function metadata is reconstructed as `none`, and extern
  attributes as an empty array.
- Bodies, expressions and alternatives use upstream constructors; the codec
  covers their current constructor set. Variables are constructor-backed,
  erased arguments scalar, and arrays are Lean arrays rather than C arrays.
- Scalar IR types are decoded directly. `IRType.struct` and `IRType.union`
  remain explicit package-generation errors.

[IRPKG_FORMAT.md](IRPKG_FORMAT.md) owns the wire tags and layouts.
[GENERATE_PACKAGE.md](GENERATE_PACKAGE.md) and [MODULE_INPUTS.md](MODULE_INPUTS.md)
own closure extraction and compiled/live module inputs. The browser reconstructs
selected declarations from packages; it does not load raw Lean module artifacts
or construct a normal compiler `Environment`.

The decoder owns every materialized object. IR builder helpers consume owned
children, and the decoded-package owner releases declarations, names,
initializer mappings, host imports and export summaries on failure or clear.
Binary fields are read into named locals before constructor calls, so decoding
does not depend on C++ argument evaluation order.

Keep alternative declaration loading behind the provider boundary, independent
of the interpreter and WASI policy. [ULC-0001](roadmap/cards/ULC-0001-ir-declaration-lookup-boundary/README.md)
records why a real compiler-environment prototype was disproportionate for
declaration-only execution and motivates an upstream provider API. That proposal
does not change the current package format or interpreter lifetime.

## Package instance lifecycle

Upstream has instance-wide native-symbol/initialized-global caches and
per-interpreter declaration/evaluated-nullary caches. VIR keeps one interpreter
session per loaded package set, preserving lazy nullary evaluation across public
calls. `@[implemented_by]` closures use that same cache; initializer globals
retain their explicit metadata and `lean_run_init` path.

The session adapter includes the pinned interpreter implementation unchanged
because its class is implementation-private. It discards the session on caught
evaluation exceptions rather than reusing possibly unwound private stacks.
Beginning or clearing a package set destroys the session before releasing its
package-owned declarations.

Public replacement requires a fresh `WebAssembly.Instance`; the compiled
`WebAssembly.Module` may be reused. The existing public JS wrapper adopts a
candidate only after loading, validation and initialization succeed. Candidate
failure disposes that candidate and leaves the active generation callable.
Successful handover tears down old callbacks, resources, host state and binding
leases before adopting new exports. Old pointers, closure roots and package-local
slots never cross the handover. If old-generation cleanup fails, cleanup still
attempts all resources, disposes the candidate and leaves the public wrapper
terminally disposed. See [the replacement API](JS_API.md#replacing-a-package-set)
and [cleanup rules](HOST_BINDINGS.md#ui-cleanup-versus-runtime-disposal).

The package-set transaction inside the fresh instance is:

1. `vir_begin_ir_package_set` clears candidate state.
2. `vir_append_ir_package` decodes each format-11 member transactionally.
   Duplicate declarations, initializer globals, host imports/symbols and export
   summaries are rejected before append.
3. `vir_prepare_ir_package_set` builds aggregate indices without running user
   initializers. The final root member supplies the manifest and export summaries.
4. JavaScript validates the manifest's format/member/target invariants and calls
   `vir_validate_package_contract` before installing its host-import manifest.
   That check compares ordered binary export/host-import fields with one manifest
   projection.
5. `vir_finish_ir_package_set` runs the initializer table through `lean_run_init`
   once for a successful set. Generated descriptors order members dependency-first,
   with each member retaining its owning initializer metadata.

Decode, prepare, manifest or initializer failure aborts staged state.
Manifest checksums detect corruption but do not prove agreement with binary call
tables; the contract comparison is separately required. Runtime ABI 2 rejects
Wasm without `vir_validate_package_contract`, rather than skipping validation.
Use matching JavaScript and Wasm revisions. The check does not authenticate a
package or prove that its IR implements its interface types; see the
[format contract](IRPKG_FORMAT.md#section-directory).

Rollback protects provider state and public handover. It cannot undo arbitrary
external effects, such as console output or unmanaged DOM mutation performed by
an initializer before a later initializer fails. Browser activity should use
reached `@[vir_startup]` entries and managed host resources so candidate disposal
can release it.

Manifest export indices belong to the root manifest. Individual member unload,
version solving, remote resolution and hot replacement of one member are not
implemented; replacement installs a complete set.

## Package call ABI

JavaScript maps `entry`, `id` and `jsName` to a manifest export, then resolves
its zero-based array index with `vir_resolve_call_export`. The provider matches
structurally decoded names and prefers the packaged boxed declaration when
present. The result is a package-local, 1-based slot; `0` means failure.
Repeated calls use `vir_call_resolved_objects(slot, argv, argc)`, without reparsing
a display name.

The call requires a package-owned summary specifying argument count, effect
handling and boxed wasm32 boundary requirements. It consumes owned argument
objects after accepting the argument array and returns one owned object on
success or `0` on a reported call failure. A base declaration may be used without
a packaged `_boxed` declaration only when its signature does not require that
boxed boundary. IO calls supply the world token and unwrap the successful IO
result; an IO error is reported as call failure.

JavaScript drives construction and inspection through `vir_obj_*`, and releases
temporary arguments/results on its success and failure paths. Supported
structural values, resources, callbacks and effectful calls all use this object
lane. There is no JavaScript value byte-payload fallback; binary package call
summaries are metadata, not a value codec.

[OBJECT_ABI.md](OBJECT_ABI.md#export-surface) specifies each helper's consuming,
owned-result or borrowed-view behavior. In particular, string/byte-array views
must be read before their object is released, and decimal scratch data before
the next decimal inspection. These exports, package slots, closure roots and
`env.vir_js_call_objects` are internal hooks for matching runtime/Wasm revisions,
not the JavaScript application API.

## Host imports and reentrant callbacks

A `@[vir_js]` declaration receives a finite package trampoline symbol; it does
not widen native lookup. Package metadata supplies arity, erased-prefix count
and effect information. The shim passes borrowed object arguments to
`env.vir_js_call_objects`; JavaScript lifts them with manifest descriptors and
lowers the returned value to an owned Lean object.

For converted Lean functions, `vir_obj_closure_root` retains a closure with its
arity and effect bit. JavaScript keeps the full function descriptor privately,
lowers callback inputs to owned objects, and lifts the owned result of
`vir_closure_call_objects`. Reentry may root more closures and reallocate the
root table. The native caller therefore snapshots the selected function, arity
and effect flag, retaining no table-entry pointer across application.
[HOST_BINDINGS.md](HOST_BINDINGS.md#lean-backed-javascript-values) owns collection
and explicit `vir_closure_release` lifetime rules.

Synchronous host exceptions use a shared out-of-band error slot because the C++
trampoline must return a structurally valid Lean object. Both top-level object
calls and closure calls clear and consume that slot around execution; the boxed
placeholder must never turn an exception into success. Callbacks created while
lifting a host call are released if any later phase fails. Successful calls may
retain them under the host contract's reachability rules.

## Explicit limitations

| Boundary | Current behavior and limit |
| --- | --- |
| Tasks and blocking IO | `Task.pure`, `Task.get` and `Task.map` support only the exercised synchronous, already-resolved mode. There is no task scheduler or general blocking-IO implementation. |
| Native thunk forcing | `Thunk.mk`/`Thunk.get` wrappers can link, but the native forcing path cannot apply an interpreter closure as a compiled function pointer. Supporting this requires a closure-aware design. |
| Proof-bearing native calls | `Char.ofNatAux` has an observed indirect-call signature mismatch. `Int.divExact`, `Nat.divExact`, `String.Internal.ugetUTF8Byte`, `String.get'`, `String.getUtf8Byte`, `String.next'`, `UInt16.ofNatLT` and `USize.ofNat32` remain unsupported pending independent calling-convention checks. |
| Parser environment policy | `evalConstCore` delegates to upstream `lean_eval_const`; `isReservedName` delegates to packaged IR; the raw `evalCheckMeta` provider accepts the check. This is not full Lean environment-policy fidelity. |
| Budget, tracing and options | System/heartbeat, stack-info, timing and trace hooks are inert. Boolean option lookup returns its default; option registration exposes no discovery. Do not infer cancellation, budget enforcement or trace-sensitive behavior. |
| Environment queries | Sorry-dependency and export-name lookup return `none`. Initializer-name queries are instead package-backed and aligned with the table run through `lean_run_init`. |
| Local IO/reference providers | `IO.initializing` is scoped true during package initializer execution and restored afterward. ST references implement single-threaded allocation, get, set and take. Stderr/error-printing helpers are no-ops. |
| Native exceptions | Unsupported C++ exception throwing and assertion-violation paths trap; they do not provide ordinary native exception recovery. |
| Expression pretty printing | The fixture supports `Std.Format.pretty`. `Lean.PrettyPrinter.ppExpr` additionally needs Meta/Environment tasks/promises and parenthesizer/formatter support; see [the existing boundary analysis](FIXTURE_COVERAGE.md#known-pretty-printer-boundary). |

Use the resolved native catalog and [fixture coverage](FIXTURE_COVERAGE.md) for
the supported surface, not an inferred promise of full Lean runtime support.
[REACT_WASM_BINDINGS.md](REACT_WASM_BINDINGS.md) owns prospective Wasm interfaces;
native Promises already cross synchronously as exact JS values without
suspending the interpreter.

## Validation

[Native tooling](../scripts/native/README.md) owns registry and wrapper checks;
[HARNESS.md](HARNESS.md) selects checks and prerequisites. `npm run probe:upstream`
produces the strict-link boundary report at `build/upstream-probe/boundary.md`.
Use `npm run inspect:native-wrappers` for the generated/handwritten classification
and `npm run check:native-externs` for compiler-metadata resolution. Generated
registries, wrappers and cached objects stay under ignored `build/`.
