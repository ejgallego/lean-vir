# Upstream Interpreter Boundary

VIR runs Lean's real IR interpreter in `wasm32-wasip1` over package-owned
`Lean.IR.Decl` objects. This guide owns the native calling, declaration-provider
and interpreter lifecycle contracts. [HOST_BINDINGS.md](HOST_BINDINGS.md) owns
JavaScript identity and foreign-value lifetime; [OBJECT_ABI.md](OBJECT_ABI.md)
owns the object-helper interface.

## Boundary and provenance

VIR compiles the unmodified `third_party/lean4-src/src/library/ir_interpreter.cpp`
against the pinned Lean headers. [The local shim](../../wasm/upstream_shim/README.md)
supplies WASI policy and stubs for unsupported operations.

The build selects upstream runtime, utility and kernel sources plus pinned
stage0 C modules from
[`native-support-sources.txt`](../../wasm/upstream_shim/native-support-sources.txt).
The [build script](../../scripts/build-upstream-probe.sh) owns that source selection.
Its generated `lean/config.h` leaves `LEAN_MIMALLOC` disabled because the pinned
source checkout lacks vendored mimalloc sources for a WASI rebuild; Lean's
ordinary allocator is used. The `githash.h` overlay records the source commit,
and `LEAN_BUILD_TYPE` is supplied to the platform implementation.

Pinned generated `Init/Prelude.c`, `Lean/Level.c` and `Lean/Expr.c` supply the
`Name`, `Level` and `Expr` constructors and their consuming accessors. Upstream
`expr.cpp`/`level.cpp` supply the cached-data primitives; section garbage
collection retains only the linked dependency closure. The shim does not
duplicate constructor hashes, flags or reference-counting formulas. Identifier
wrapper structures erase to `Name` at runtime, but their generated hashes
include the wrapper's hash seed. `npm run test:constructor-providers` compares
native Lean and Wasm metadata and ownership, including large Nat values.

Typed expressions use packed binder/let metadata. The raw bound-variable
constructor rejects indices above `1048574` before the kernel's fatal range
check; the JavaScript adapter validates the same limit.

Native lookup is closed: `dlsym` accepts only the generated native registry and
finite package host-import trampoline symbols. An `@[extern]` declaration alone
does not prove provider availability. Project providers extend this static
selection through [CLIENT_NATIVE_EXTERNS.md](CLIENT_NATIVE_EXTERNS.md), using the
same manifest for package native-over-fallback selection and the Wasm build.

## Native boxed wrappers

[`NativeExternSpec`](../../Vir/GeneratePackage/NativeExterns.lean) stores VIR policy:
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
[`native_symbols.cpp`](../../wasm/upstream_shim/runtime/native_symbols.cpp), they
consume temporary input references retained by the interpreter and return the
raw borrowed result. The calling IR also treats that result as borrowed;
adding a result retain or substituting an owned getter would leak.
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

## Real IR and declaration lookup

`lean_ir_find_env_decl` and `lean_ir_find_env_decl_boxed` delegate to
[`package/decl_provider.h`](../../wasm/upstream_shim/package/decl_provider.h).
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
[GENERATE_PACKAGE.md](GENERATE_PACKAGE.md) owns closure extraction and
compiled/live module inputs. The browser reconstructs
selected declarations from packages; it does not load raw Lean module artifacts
or construct a normal compiler `Environment`.

The decoder owns every materialized object. IR builder helpers consume owned
children, and the decoded-package owner releases declarations, names,
initializer mappings, host imports and export summaries on failure or clear.
Binary fields are read into named locals before constructor calls, so decoding
does not depend on C++ argument evaluation order.

[ULC-0001](../design/IR_DECLARATION_LOOKUP.md)
records why a real compiler-environment prototype was disproportionate for
declaration-only execution and motivates an upstream provider API. That proposal
does not change the current package format or interpreter lifetime.

## Package instance lifecycle

Upstream has instance-wide native-symbol/initialized-global caches and
per-interpreter declaration/evaluated-nullary caches. VIR keeps one interpreter
session per loaded package set. Initializers, named calls and JavaScript-entered
Lean callbacks share its declaration and lazy nullary caches, including
`@[implemented_by]` closures. Initializers retain their explicit metadata and
use upstream `interpreter::run_init` within that session.

Supported package execution uses a fixed environment/options pair. Entry with
a foreign active interpreter or a pending reset fails before evaluation;
owned arguments are consumed once. Reset during an active entry is deferred
until the outer entry unwinds. Arbitrary foreign captured closures supplied by
raw native callers are outside this contract; upstream's captured-context
selection remains unchanged.

The session adapter includes the pinned interpreter implementation unchanged
because its class is implementation-private. It discards the session on caught
evaluation exceptions rather than reusing possibly unwound private stacks.
Beginning or clearing a package set destroys the session before releasing its
package-owned declarations.

Each package generation uses a fresh `WebAssembly.Instance`; the compiled
`WebAssembly.Module` may be reused. A factory creates and validates a candidate
runtime before returning it. Candidate failure disposes that candidate and does
not affect an already-owned generation. Old pointers, closure roots and
package-local slots never cross between runtimes. Callers select the new
generation and explicitly dispose the old one when its callbacks and resources
should become invalid. See [runtime generations](../guides/JS_API.md#runtime-generations)
and [cleanup rules](HOST_BINDINGS.md#ui-cleanup-versus-runtime-disposal).

The package-set transaction inside the fresh instance is:

1. `vir_begin_ir_package_set` clears candidate state.
2. `vir_append_ir_package` decodes each format-11 member transactionally.
   Duplicate declarations, initializer globals, host imports/symbols and export
   summaries are rejected before append.
3. `vir_prepare_ir_package_set` builds aggregate indices and resolves each public
   export against all appended declarations without running user initializers.
   Missing declarations and required boxed wrappers are rejected here. Call slots
   are opaque, package-local handles for these resolved exports. The final root
   member supplies the manifest and export summaries.
4. JavaScript validates the manifest's format/member/target invariants and calls
   `vir_validate_package_contract` before installing its host-import manifest.
   That check compares ordered binary export/host-import fields with one manifest
   projection.
5. `vir_finish_ir_package_set` runs the initializer table through the package
   interpreter's upstream `run_init`
   once for a successful set. Generated descriptors order members dependency-first,
   with each member retaining its owning initializer metadata.

The JS loader aborts staged state on decode, prepare, manifest or initializer
failure.
Manifest checksums detect corruption but do not prove agreement with binary call
tables; the contract comparison is separately required. Runtime ABI 4 rejects
Wasm without `vir_validate_package_contract`, rather than skipping validation.
Use matching JavaScript and Wasm revisions. The check does not authenticate a
package or prove that its IR implements its interface types; see the
[format contract](IRPKG_FORMAT.md#section-directory).

The raw loader exports are trusted primitives for matching hosts, not an
independent manifest validator. The supported JS loader checks member order and
schema, compares the manifest with binary tables, and installs host bindings
before finish. The standalone benchmark uses its build-time generated package
and export indices. Raw callers must establish those same preconditions for
their inputs; they must not reset a package while calls or retained roots are
live, or invoke lifecycle operations from an initializer.

Under runtime ABI 4, begin/append/prepare/finish return `1` on success and `0` on
failure. `vir_package_decl_count` reports the count separately. A package set
must contain at least one member, but a well-formed member or entire set may
contain zero declarations. Query the root manifest after preparation and the
final count after successful finish. Returned string pointers are borrowed and
must be copied before another loader operation can invalidate them.

The provider has one state owner and phases idle, appending, prepared,
initializing, ready and failed. A failed append leaves previously staged members
intact; failed index/export resolution during preparation requires abort or
begin before appending again. Preparing before any member is appended leaves
the transaction open.
An ordinary initializer failure retires the interpreter session and clears the
staged package; the JS runtime remains usable for a fresh installation. A fatal
host failure or Wasm trap retires the entire Wasm generation and cannot be
recovered by retrying on that instance. Invalid or repeated transitions return
failure without changing state, so a repeated finish neither reruns
initializers nor unloads a ready package. Abort is idempotent and preserves the
last diagnostic; begin clears it and starts a fresh transaction.
The JS loader aborts on any failed transaction step. Package retirement also
clears upstream initializer names and cached native-symbol lookups so a later
installation cannot reuse their values or package-local host slots. Upstream
marks initialized values persistent; this cleanup removes names
but does not reclaim their storage. Ordinary call errors retain initialized
globals.

Rollback protects staged provider state and candidate construction. It cannot undo arbitrary
external effects, such as console output or unmanaged DOM mutation performed by
an initializer before a later initializer fails. Browser activity should use
reached `@[vir_startup]` entries and managed host resources so candidate disposal
can release it.

Manifest export indices belong to the root manifest. Individual member unload,
version solving, remote resolution and hot replacement of one member are not
implemented; each runtime installs one complete set.

## Package call ABI

JavaScript maps `entry`, `id` and `jsName` to a manifest export, then resolves
its zero-based array index with `vir_resolve_call_export`. The provider matches
structurally decoded names and prefers the packaged boxed declaration when
present. The result is a package-local, 1-based slot; `0` means failure.
Repeated calls use `vir_call_resolved_objects(slot, argv, argc)`, without reparsing
a display name.

Manifest 9 uses canonical structural `nameKey` values for binary agreement and
native registry lookup. Human-readable names remain aliases. Runtime ABI 4
requires matching JavaScript and Wasm artifacts, and its package contract uses
the manifest-9 structural identity directly. The loader has no legacy
display-name comparison path.

The call requires a package-owned summary specifying argument count, effect
handling and boxed wasm32 boundary requirements. It consumes owned argument
objects after accepting the argument array and returns one owned object on
success or `0` on a reported call failure. A base declaration may be used without
a packaged `_boxed` declaration only when its signature does not require that
boxed boundary. IO calls supply the world token and unwrap the successful IO
result; an IO error is reported as call failure. Read `vir_call_error` only when
the call returns `0`: a successful outer call can retain a diagnostic from a
caught nested failure.

These entry points do not use upstream `interpreter::run_main`. That unlinked
command-line path needs `lean_io_result_show_error`, which the shim does not
provide; enabling it would require an explicit error-display implementation.

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

The reusable trampoline grid covers slots 0–127 and IR arities 0–6. The producer's
`maxHostImportSlots` and `maxHostImportArity` definitions generate the C++ limits
through `scripts/packages/check-package-abi.mjs --write` during a Wasm build.
Compile-time index sequences generate each slot's seven fixed function
signatures and their lookup tables. Preparation rejects aggregate slot overflow,
excess arity, and impossible erased-prefix/world counts before initialization.
The dispatch path retains its argument cleanup and excludes erased/world
arguments from the values borrowed by JavaScript.

Package generation and preparation reject nullary pure host declarations: upstream native lookup treats
zero-arity declarations as addresses of constant storage, not callable function
pointers. The retained arity-0 trampoline does not provide that constant adapter.
Use an explicit `Unit` argument for a callable pure import. This is distinct
from an effectful import with no JavaScript arguments, whose IR
arity includes its world argument.

For converted Lean functions, `vir_obj_closure_root` retains a closure with its
arity and effect bit. JavaScript keeps the full function descriptor privately,
lowers callback inputs to owned objects, and lifts the owned result of
`vir_closure_call_objects`. Reentry may root more closures and reallocate the
root table. The native caller therefore snapshots the selected function, arity
and effect flag, retaining no table-entry pointer across application.
[HOST_BINDINGS.md](HOST_BINDINGS.md#lean-backed-javascript-values) owns collection
and explicit `vir_closure_release` lifetime rules.

Synchronous host exceptions use an out-of-band error slot, preserving the
original JavaScript Error at the owning named/closure/initializer boundary.
Effectful imports return `IO.Result.error` so Lean bind stops; ordinary IO
failure leaves the instance reusable. Pure imports have no error carrier and
trap rather than returning a fabricated value. Named calls, callbacks and
initializers include Lean's formatted IO error text in their diagnostics.

The SDK transfers consuming call arguments before Wasm entry. Any exception
escaping an exported Wasm function retires that instance: further calls,
callbacks, startup and package installation fail synchronously. A binding
cannot swallow a nested fatal call and resume its outer Lean frame; transactional
host resources roll back. The guarded export facade is runtime-owned and must
not be replaced or bypassed with raw exports. Constructor failure before the
facade exists is an instantiation failure; the factory never returns that
instance.

Disposal after a fatal failure runs JavaScript cleanup and clears host roots,
but does not call Wasm decrements, frees, closure releases or package abort.
Those allocations remain with the abandoned instance until it is collectible.
This makes no claim that traps unwind C++ frames or release every Lean object.
Recovery creates a fresh factory runtime. Raw Wasm callers must likewise discard
an instance after a trap; the raw ABI does not implement stack recovery.
Callbacks and Lean-backed JS handles retain ordinary reachability semantics
until disposal; they cannot invoke the failed instance.

## Explicit limitations

| Boundary | Current behavior and limit |
| --- | --- |
| Tasks and blocking IO | `Task.pure`, `Task.get` and `Task.map` support only the exercised synchronous, already-resolved mode. There is no task scheduler or general blocking-IO implementation. |
| Native thunk forcing | `Thunk.mk`/`Thunk.get` wrappers can link, but the native forcing path cannot apply an interpreter closure as a compiled function pointer. Supporting this requires a closure-aware design. |
| Proof-bearing native calls | `Char.ofNatAux` has an observed indirect-call signature mismatch. `Int.divExact`, `Nat.divExact`, `String.Internal.ugetUTF8Byte`, `String.get'`, `String.getUtf8Byte`, `String.next'`, `UInt16.ofNatLT` and `USize.ofNat32` remain unsupported pending independent calling-convention checks. |
| Parser environment policy | `evalConstCore` delegates to upstream `lean_eval_const`; `isReservedName` delegates to packaged IR; the raw `evalCheckMeta` provider accepts the check. This is not full Lean environment-policy fidelity. |
| Budget, tracing and options | System/heartbeat, stack-info, timing and trace hooks are inert. Boolean option lookup returns its default; option registration exposes no discovery. Do not infer cancellation, budget enforcement or trace-sensitive behavior. |
| Environment queries | Sorry-dependency and export-name lookup return `none`. Initializer-name queries are package-backed and aligned with the table run through `interpreter::run_init` in the persistent package session. |
| Lazy constant providers | Pinned generated constants use eight local single-threaded `*_once_cold` providers implementing the [pinned `lean_once_cell_t` ABI](https://github.com/leanprover/lean4/blob/293d5d0c0c3f3dded4688b3ccd6a33939ac5102b/src/include/lean/lean.h#L3374). The upstream [`lean_obj_once_cold` implementation](https://github.com/leanprover/lean4/blob/293d5d0c0c3f3dded4688b3ccd6a33939ac5102b/src/runtime/object.cpp#L2896) waits on its atomic lock and marks object results persistent. VIR's replacement in [`runtime/once.cpp`](../../wasm/upstream_shim/runtime/once.cpp#L17) preserves exactly-once initialization and persistent object roots without atomic waits or WASI clocks. Nested initialization of a different cell remains valid; recursive initialization of the same cell traps by VIR policy, and the host must retire that instance. The build renames only the upstream definitions; pinned sources remain unchanged. |
| Local IO/reference providers | `IO.initializing` is scoped true during package initializer execution and restored afterward. ST references implement single-threaded allocation, get, set and take. `lean_io_eprintln` consumes and discards its string; no stderr sink is installed. Call/initializer IO errors have separate detailed diagnostics. |
| Native exceptions | Unsupported C++ exception throwing and assertion-violation paths trap; the SDK retires the instance. They do not provide ordinary native exception recovery. |
| Expression pretty printing | The fixture supports `Std.Format.pretty`. `Lean.PrettyPrinter.ppExpr` additionally needs Meta/Environment tasks/promises and parenthesizer/formatter support; see [the existing boundary analysis](../development/EXAMPLES_AND_FIXTURES.md#known-pretty-printer-boundary). |

Use the resolved native catalog and [fixture coverage](../development/EXAMPLES_AND_FIXTURES.md) for
the supported surface, not an inferred promise of full Lean runtime support.

### Provider capability boundaries

These providers serve the packaged interpreter, whose environment and options
are fixed. They do not emulate a compiler session.

| Provider | Live role | Supported limit |
| --- | --- | --- |
| `check_system`, `reset_heartbeat`, `save_stack_info` | Interpreter/kernel budget checkpoints | No cancellation, timeout or stack-budget enforcement. Clients needing interruption must own a worker/process boundary. |
| `time_task`, `scope_trace_env` | Interpreter entry instrumentation | No timing/trace capture from these hooks; SDK call timing measures its own boundaries. |
| `options::get_bool`, `register_option` | Interpreter's default policy and option setup | Returns the supplied Boolean default; no general option store or declaration discovery. |
| `elab_environment::to_kernel_env` | Fixed environment reference plumbing | Retains the existing object; does not construct missing compiler metadata. |
| `lean_decl_get_sorry_dep`, `lean_get_export_name_for` | Upstream interpreter declaration admission/native-name fallback | Return `none`; neither sorry checking nor compiler `@[export]` metadata is supplied. Native lookup remains allowlisted. |
| `lean_eval_check_meta` | Packaged parser/evaluation policy | Accepts the meta check. Packages requiring full compiler phase enforcement are outside this environment. |
| `lean_is_reserved_name` | Parser reserved-name query | Delegates to packaged Lean IR; its declaration closure must be included. |
| Initializer-name lookup, `IO.initializing`, ST refs | Package initialization and runtime state | Real package-backed lookup and single-threaded reference ownership; no general concurrent runtime. |
| `lean_io_eprintln` | Lean IO diagnostic side effect | Intentionally silent. Existing explicit console host bindings are available to client-authored code; no additional diagnostic sink was found necessary. |

These limits remain unchanged because live callers depend on the narrow
package environment. The parser/Expr and upstream fixture checks cover exercised
behavior, not general elaborator, kernel-environment or scheduler support.


## Validation

[Native tooling](../../scripts/native/README.md) owns registry and wrapper checks;
[HARNESS.md](../HARNESS.md) selects checks and prerequisites. `npm run probe:upstream`
produces the strict-link boundary report at `build/upstream-probe/boundary.md`.
Use `npm run inspect:native-wrappers` for the generated/handwritten classification
and `npm run check:native-externs` for compiler-metadata resolution. Generated
registries, wrappers and cached objects stay under ignored `build/`.
