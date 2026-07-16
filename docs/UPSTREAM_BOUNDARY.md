# Upstream Interpreter Boundary

The demo goal is to compile Lean's real `src/library/ir_interpreter.cpp` for
`wasm32-wasip1` and then supply only the runtime and environment surface needed
for small browser examples such as `fib`, the Lean-rendered DOM Tamagotchi, and
`SortDemo.demoFromArray`.

Run the boundary probe with:

```bash
npm run probe:upstream
```

The generated report is written to `build/upstream-probe/boundary.md`.

Current status: the strict `wasm32-wasip1` link succeeds with the real upstream
`ir_interpreter.cpp`, the linked Lean runtime subset, and
`wasm/upstream_shim/`. The demo closure is supplied through a package-backed
provider as real Lean IR declaration objects, and manifest-supported browser
calls execute that closure through the real upstream interpreter via package
call slots.

## Policy

- Keep `third_party/lean4-src/src/library/ir_interpreter.cpp` unmodified.
- Compile the exact upstream file against the pinned Lean `v4.32.0-rc1`
  headers.
- Link real Lean runtime source files into the WASI probe before adding local
  stubs.
- Do not model the demo interpreter with a parallel bespoke IR schema.
- Provide real Lean IR declaration objects through `lean_ir_find_env_decl`.
- Stub only runtime/library pieces that the current demo paths do not execute.
- Keep general native symbol lookup unsupported; register only the demo externs
  that are needed by the current closure.

## Linked Runtime

The probe links these upstream runtime sources:

- `src/runtime/alloc.cpp`
- `src/runtime/apply.cpp`
- `src/runtime/exception.cpp`
- `src/runtime/hash.cpp`
- `src/runtime/mpn.cpp`
- `src/runtime/mpz.cpp`
- `src/runtime/object.cpp`
- `src/runtime/object_ref.cpp`
- `src/runtime/platform.cpp`
- `src/runtime/utf8.cpp`

It also links `src/util/name.cpp`, which is not runtime proper but is needed by
the interpreter's name formatting and diagnostics.

The probe additionally links `wasm/upstream_shim/`. This is local demo code,
not a fork of Lean. It is split by responsibility:

- `interpreter/interpreter_bridge.cpp` owns upstream interpreter lifecycle,
  `lean_ir_find_env_decl` hooks, and boxed function execution.
- `abi/call_abi.cpp` owns the package call surface exposed to JavaScript.
- `abi/closure_abi.cpp` owns Lean closure roots and callback calls used when
  function values cross to JavaScript.
- `package/host_import_trampolines.cpp` owns the package-scoped JavaScript host-import
  trampoline grid used by restricted `dlsym` lookup.
- `package/package_decl_provider.cpp` owns direct package-call summaries used
  to compute call arity, IO handling, and boxed-boundary requirements.
- `runtime/name_utils.cpp` owns shared Lean `Name` construction helpers.
- `abi/object_abi.cpp` owns generic owned `lean_object *` helpers used by the
  runtime object call path.
- `abi/object_expr_abi.cpp` owns the temporary `Lean.Level`, `Lean.Expr`, literal,
  and name-string helpers used by current object-boundary fixtures.
- `abi/resource_abi.cpp` owns the shared external resource class used by
  `Lean.Vir.Js α` values.
- `runtime/native_symbols.cpp` owns native extern wrappers that still require
  shim-specific implementation or policy.
- `runtime/native_symbol_lookup.cpp` owns the generated native registry include,
  restricted `dlsym` lookup, native symbol stem lookup, and C++ exception
  stubs.
- `tools/GenerateNativeWrappers.lean` recompiles native externs marked with
  `generateBoxedWrapper` in `Vir/GeneratePackage/NativeExterns.lean`, selects
  their `_boxed` LCNF declarations, and emits their C definitions and registry
  entries through Lean's standard compiler pipeline. The build cross-compiles
  that generated C and links it statically into the WASI module.
- `runtime/runtime_environment_stubs.cpp`, `package/package_init_bridge.cpp`,
  `runtime/runtime_value_stubs.cpp`, and `runtime/io_stubs.cpp` own the
  WASI/platform, initializer, value-helper, and demo IO stubs.
- `runtime/lean_object_constructors.cpp` owns the temporary `Name`/`Level`/`Expr`
  constructor replacements for exported Lean-library constructors.
- `package/package_section_directory.cpp` owns `.irpkg` envelope and section
  directory decoding.
- `package/package_ir_decoder.cpp` owns section payload decoding and Lean IR
  object materialization, including cleanup of partial decode graphs.
- `package/package_decl_provider.cpp` owns loaded package state, declaration lookup,
  host import metadata, and initializer execution.
- `Vir/GeneratePackage/Closure.lean` owns extraction of the demo declaration closures
  from typed `Lean.IR.Decl` values into the focused `build/generated/*.irpkg`
  packages; `docs/GENERATE_PACKAGE.md` maps the full split generator, and
  `tools/GeneratePackage.lean` is the CLI wrapper.
- `package/decl_provider.h` is the replacement point for a future module-backed
  provider.

Together they supply:

- `lean_ir_find_env_decl` and `lean_ir_find_env_decl_boxed` for the generated
  package closures, including `fib`, `SortDemo.demoFromArray`, the
  `Lean.Vir.Browser`-backed Tamagotchi UI entrypoints, and the fixture
  dependencies.
- small WASI/platform stubs for C++ exception throwing, trace/time/options
  hooks, and the few environment helpers pulled in by the interpreter.
- the generic package call interface used by the JavaScript runtime for
  manifest-supported functions. The runtime resolves each manifest export once
  with `vir_resolve_call_export` and then calls `vir_call_resolved_objects` with
  the cached slot.
- package-scoped JavaScript host import trampolines for declarations marked
  with `@[vir_js "..."]`, routed through `env.vir_js_call_objects`.
- Lean closure roots for function-valued host-import arguments. The closure ABI owns
  `vir_obj_closure_root`, `vir_closure_call_objects`, and
  `vir_closure_release`; JavaScript owns the host-side lifetime policy for
  `VirCallback` objects.
- name construction primitives needed by `src/util/name.cpp`.

The exported `vir_obj_*`, `vir_call_resolved_objects`, closure-root, and
`env.vir_js_call_objects` symbols are internal WASM/runtime ABI hooks. They are
stable only within a matching `lean_vir` revision and should not be treated as
the JavaScript application API.

The WASI probe generates local `lean/config.h` and `githash.h` overlays. The
config overlay leaves `LEAN_MIMALLOC` disabled because the pinned Lean source
checkout does not include vendored mimalloc sources for a WASI rebuild; this
selects Lean's ordinary allocator path while still compiling Lean's real
runtime code. The git-hash overlay records the pinned source commit, and the
probe supplies Lean's normal `LEAN_BUILD_TYPE` input for `platform.cpp`.

The build compiles stable sources into cached objects under
`build/upstream-probe/obj`. Example edits regenerate the relevant
`web/public/*.irpkg` package without recompiling or relinking the WASM artifact.
Compiler-generated native wrappers and their registry fragment live under
`build/upstream-probe/generated`; they are build artifacts and are not checked
into Git. The artifact is relinked only when stable or generated objects, link
flags, the Lean source commit, or the generated runtime overlays change.

## Native Boxed Wrappers

The upstream interpreter invokes native code through homogeneous boxed calls.
For an extern with scalar or borrowed parameters, Lean's compiler normally
provides a `_boxed` declaration whose native symbol has the `___boxed` suffix.
That wrapper performs scalar unboxing/boxing and the reference-count updates
inferred by the normal LCNF passes before calling the raw extern symbol.

VIR keeps the final WASI module statically linked. Standard adapters can be
marked with `generateBoxedWrapper := true` in the native extern table; the
build then recompiles those imported extern declarations and emits only their
compiler-generated boxed wrappers. The native extern table is the source of
truth for the current selection; `npm run inspect:native-wrappers` reports it
without duplicating an evolving declaration list here. Wrappers that implement
additional behavior, unavailable runtime services, or deliberate WASI policy
remain explicit in `runtime/native_symbols.cpp`.

`npm run check:native-wrappers` rejects ordinary handwritten direct adapters.
The intentional ownership exception is `Array.ugetBorrowed`: its raw result is
borrowed from the array, while Lean's standard emitted boxed wrapper releases
the array without first retaining that result. The explicit shim wrapper keeps
the required retain visible and the inventory check fails if this exception is
removed, reclassified, or duplicated without updating the policy.

## Real IR Declarations

The upstream interpreter reads declarations through the Lean object layout
accessors in `ir_interpreter.cpp`. A package-backed provider therefore has to
return `Option decl` values using the same constructor layout:

- `decl` uses `Fun`/`Extern` constructors and carries `fun_id`, parameters,
  result type, and `fn_body`. Function declaration metadata is reconstructed as
  `none`, and extern attributes as an empty array, because the interpreter does
  not consume those fields.
- `fn_body`, `expr`, and `alt` use the real upstream constructors. The
  package codec covers every constructor in those current IR types rather than
  only the cases reached by one fixture closure.
- scalar `IRType` cases are decoded directly; `IRType.struct` and
  `IRType.union` remain explicit package-generation errors.
- `arg` uses constructor-backed variables and scalar erased arguments.
- arrays must be Lean array objects, not C arrays.

This is the critical distinction from the discarded bootstrap runners: the demo
does not use a parallel C/C++ interpreter schema.

## Package Closure Strategy

For the demo, `/dev.html` and the smoke tests load focused `.irpkg` files
containing the transitive declaration closure needed by each exported Lean
surface. This keeps `.olean` loading, module initialization, and full
environment construction out of scope while still exercising the real upstream
interpreter over real Lean IR objects.

The closure is extracted by `Vir/GeneratePackage/Closure.lean` from real
`Lean.IR.Decl` values. The generator starts with declarations produced for the
example sources, walks `FAp`/`PAP` references, and can now fall back to
`Lean.IR.findEnvDecl` for imported IR declarations already available through
the elaborated environment. This is still package-backed loading, not full
module loading, but it lets fixtures include small upstream library closures
such as `List.reverse._redArg`. The generator then emits a small binary package.
`wasm/upstream_shim/package/package_section_directory.cpp` reads the package
envelope, `wasm/upstream_shim/package/package_ir_decoder.cpp` decodes section
payloads into the upstream interpreter's expected object layout at runtime, and
`wasm/upstream_shim/package/package_decl_provider.cpp` owns the loaded package state.
The generator report separates missing Lean IR declarations from missing native
extern registrations, and the package decoder exposes its last load error for
browser and smoke-test diagnostics.
See `docs/GENERATE_PACKAGE.md` for the package generator module map and
diagnostic flow.

## Package Instance Lifecycle

The upstream interpreter caches native-symbol results and initialized globals
for its process lifetime. The local provider can clear decoded declarations,
but it cannot prove a complete reset of those upstream caches without changing
`third_party/lean4-src/src/library/ir_interpreter.cpp`. Public package
replacement therefore uses a fresh `WebAssembly.Instance` while reusing the
already-compiled `WebAssembly.Module`.

`VirRuntime.loadIrPackageBytes` first instantiates and fully loads a candidate.
A candidate failure disposes only that instance, leaving the active package
callable. A successful candidate is handed to the existing public runtime
wrapper after the old callbacks, resources, host state, and binding leases are
torn down. Nothing containing an old Wasm pointer or package-local slot may
cross the handover.

Teardown is best-effort and terminal. Host-binding disposers, resource
disposers, Lean object handles, and closure roots are all attempted in a stable
order; multiple failures are reported to JavaScript as an `AggregateError`
afterward. If old-instance teardown fails during handover, the candidate is
also disposed and the public wrapper is marked disposed.

The current runtime treats the active package set as containing exactly one
`.irpkg`; that cardinality is not intended as a permanent boundary. Future
modular loading should extend the same candidate-instance handover to the whole
package set: construct a fresh instance, load and validate the complete set,
then adopt it atomically. Adding, updating, or removing one package should not
leave the active instance with a partially updated dependency graph.

Manifest export indices are scoped to one package manifest and are not global
or stable package identities. A future multi-package call ABI will need package
context, an aggregate manifest, or an opaque handle around that index. This
work deliberately leaves package handles, dependency and initializer ordering,
conflict policy, and individual unload semantics undefined.

Within one instance, the package decoder owns every object it materializes.
The helpers in `package_ir_builders.*` consume their owned object arguments,
and the decoded-package owner releases top-level declarations, names,
initializer mappings, host imports, and export summaries on failure or clear.
The decoder also reads binary fields into named locals before constructor calls;
its correctness does not depend on C++ argument evaluation order.

## Package Call ABI

The browser runtime does not send or parse a Lean display name on every call.
After loading an `.irpkg`, it maps `entry`, `id`, and `jsName` to one manifest
export record and resolves that record's zero-based array index with
`vir_resolve_call_export(export_index)`. The provider matches the index against
the structurally decoded export-summary names, preferring the generated boxed
declaration when present. The returned call slot is package-local, 1-based, and
uses `0` as the failure sentinel. Repeated calls then use
`vir_call_resolved_objects(slot, argv, argc)` with owned Lean object arguments.

In package format 10, the package has an explicit section directory and a direct
export call-summary section. `vir_call_resolved_objects` uses that table to
validate object argument counts, effect handling, and boxed wasm32 boundary
requirements. Resolved calls without a package-owned summary fail.
The package also records host-import arity, erased-prefix count, and effect
metadata for Lean-to-JavaScript calls. The shim uses that metadata to send
borrowed Lean object arguments through `env.vir_js_call_objects`, and JavaScript
uses the JSON manifest descriptors to lift arguments and lower the owned Lean
object result. The
opaque `leanObject` descriptor for generic LeanRef object handles, surfaced to
Lean as `Lean.Vir.JSL α` so they do not typecheck as JavaScript-shaped `Js α`
resources.

`vir_call_resolved_objects(slot, argv, argc)` is the first object ABI call
helper. It accepts an array of owned `lean_object *` arguments, consumes those
arguments once called, and returns an owned Lean object result on success. It
uses a generated `_boxed` package declaration when one exists. If no `_boxed`
declaration exists, it may call the base declaration only when the package
signature does not require a boxed wasm32 boundary for the top-level argument or
result type. The helper keeps higher-level JS lowering out of the shim;
JavaScript drives it through the `vir_obj_*` construction and inspection
primitives while the broader JS boundary policy remains open.
The JavaScript runtime uses this lane for exported calls whose arguments can be
lowered from the supported object subset and whose result can be lifted from it.
Arguments and results support base values,
`Array`, `List`, `Option`, `Prod`, and manifest-described structures, tagged
unions, and custom inductive constructors whose fields recursively stay in this
subset. Nontrivial constructors may mix object fields, raw `USize` slots, and
packed scalar fields, including direct recursive references through supported
fields. Direct `Lean.Expr` values use the object lane:
JavaScript lowers the structural expression object through constructor-backed
`vir_obj_expr_*`, `vir_obj_level_*`, and literal helpers, and lifts the owned
Lean result back to the same structural JavaScript shape. Resources, callbacks,
and effectful calls also use object arguments/results.

The shim no longer exposes a JavaScript-to-Lean value byte payload call. The
descriptor-bearing named payload format was removed earlier, and the resolved
byte payload fallback has now been removed as well.
Package-call summaries are direct metadata, not a runtime value codec.

The shim also exposes the first experimental Lean object ABI helpers. The
complete value/call export surface is documented in
[OBJECT_ABI.md](OBJECT_ABI.md#export-surface).

These helpers are still internal runtime primitives, not public Lean signature
forms. They are the first step toward moving value lowering/lifting out of the
C++ descriptor codec and into the JavaScript runtime. Constructors return owned
Lean object references; `vir_call_resolved_objects` consumes owned arguments and
returns an owned result. String and byte-array data pointers are borrowed and
must be read before the object is released. Decimal scalar inspection uses a
shim-owned scratch buffer that must be read before the next decimal inspection
call. `vir_obj_array` consumes owned element references and returns one owned
array object. `vir_obj_array_get` and `vir_obj_field` return new owned
references. Lean lists use the generic scalar/constructor helpers: nil is scalar
constructor tag `0`, and cons is constructor tag `1` with head and tail object
fields.
`vir_obj_ctor` consumes owned object-field references. See
[OBJECT_ABI.md](OBJECT_ABI.md) for the staged plan and ownership rules.

The current explicit native externs cover the small fixture/demo surface for
`Nat`, `Int`, `Array`, `ByteArray`, `USize`, `UInt8`, `UInt32`, `UInt64`,
`Float`, `String`, and the helper externs reached by `Lean.Expr`/`Lean.Level`
data computation. This includes the arithmetic and comparison operations
needed by the demos, List/Array/String/ByteArray fixtures, array mutation
through `Array.emptyWithCapacity`/`Array.getInternal`/`Array.replicate`/
`Array.set`/`Array.set!`/`Array.swap`/`Array.swapIfInBounds`/`Array.pop`,
String raw-position iteration and slicing through `String.push`/
`String.Internal.next`/`String.Internal.extract`/`String.Pos.Raw.get`/
`String.Pos.Raw.prev`/`String.Internal.atEnd` plus string ordering, public
`String.contains`/`startsWith`/`drop`/`dropEnd`/`trimAscii`/`splitOn`/
`intercalate`/`any`/`front`/`pushn`/`isEmpty`/`String.Pos.Raw.nextWhile`/
`String.find`/`String.Pos.Raw.offsetOfPos`, plus parser-data primitives
`String.hash`/`String.Internal.contains`/`String.Pos.Raw.isValid`, backed by
imported upstream IR, plus UTF-8 conversion through `String.toUTF8`, `String.fromUTF8?`,
`String.ofByteArray`, and `ByteArray.validateUTF8`, case conversion and string
mutation through `String.toUpper`/`String.toLower`/`String.capitalize`/
`String.decapitalize`, `Char.toUpper`/`Char.toLower`/`Char.utf8Size`, and the
current numeric boundary fixtures for `Nat.div`/`pow`/`log2`/shifts, small `Int`
arithmetic, `UInt8`/`UInt16` `toNat` plus arithmetic, bitwise, shift, and
comparison operations, `UInt32.ofNat`/`toNat`/`toUInt8` plus arithmetic,
bitwise, shift, and comparison operations, `UInt64.ofNat`/`ofNatLT`/`toNat`/
`toUSize`/`toFloat` plus arithmetic, bitwise, shift, and comparison operations
including a wide `UInt64.toNat` fixture returned through the manifest-driven
package-call path, package-backed `Nat` literals wider than 32 bits,
`USize` `sub`/`mul`/`land`/`shiftLeft`/`shiftRight`/`toNat`/`decLe`,
`ByteArray.mk`/`ByteArray.get`, and
`Float.scaleB`/`toUInt32`. Parser-adjacent hash/name/substring/pointer-address
primitives (`mixHash`, `Lean.Name.beq`, `Substring.Raw.Internal.beq`, and
`ptrAddrUnsafe`) are covered by a separate unsafe fixture that only compares
stable same-object pointer equality. The parser input fixture additionally runs
`Lean.Parser.mkInputContext`, `Lean.FileMap.toPosition`, and
`Lean.Parser.mkParserState` over real upstream parser/input infrastructure.
`Task.pure`, `Task.get`, and `Task.map` are covered only in the synchronous,
already-resolved mode needed by real `Environment` values; the demo does not
attempt to provide a task scheduler.
This matters for Lean's expression pretty printer: probing
`Lean.PrettyPrinter.ppExpr` shows that it reaches `MetaM` and then
`Environment` async-constant state, where `Environment.checked` is a
`Task Kernel.Environment`, `addConstAsync` and `promiseChecked` use promises
and `Task.bind`, and `Lean.addDecl` can use `BaseIO.mapTask`. The current
`pretty-printer.irpkg` intentionally stops at `Std.Format.pretty`; supporting
`ppExpr` requires broadening the runtime boundary to Meta/Environment task and
promise support plus the parenthesizer/formatter interpreter externs.
`IO.initializing` is modeled as post-initialization, and `ST.Prim.mkRef`/
`ST.Prim.Ref.get` cover single-threaded ref allocation/read semantics. Mutation,
blocking IO, and scheduler behavior are still outside the demo boundary.
They are backed by a generated native registry include; a full native symbol
loader is still out of scope. The public String search/drop fixture currently
imports a small upstream IR closure and adds native registrations for the
runtime helper boundary that closure reaches (`Nat.ble`, `String.Pos.next`,
`String.decodeChar`, `String.extract`, and `String.Slice.Pattern.Internal.memcmpStr`).
`String.splitOn` additionally exercises the legacy `String.Pos.Raw.next`/
`String.Pos.Raw.extract`/`String.Pos.Raw.atEnd` aliases over the same runtime
helpers.
`ByteArray.empty` is exposed as
Lean's native constant symbol (`l_ByteArray_empty`), not as a boxed nullary
function, because the upstream interpreter loads native constants through the
symbol address. `ByteArray.extract` is exposed as Lean's compiled symbol stem
(`l_ByteArray_extract`) and delegates to the linked runtime
`lean_byte_array_copy_slice` path. Its registered IR parameters mirror the real
compiled declaration: the source byte array and stop index are borrowed, while
the start index is consumed.
`String.Pos.set`, `String.Pos.Raw.set`, and the legacy `String.set` each use a
distinct native stem in the shim because their boxed arities differ, but all
three wrappers delegate to the same linked runtime helper,
`lean_string_utf8_set`.
`runtime/lean_object_constructors.cpp` also owns minimal `Lean.Expr`/`Lean.Level` object
construction for direct object-ABI calls, so JavaScript can lower structural
boundary values into real `Lean.Expr` objects without depending on Lean-library
exported constructor wrappers.

JavaScript host imports deliberately do not widen the native extern policy.
`Vir/GeneratePackage/Interface/Collect.lean` collects `@[vir_js "..."]` extern
declarations into the package manifest and assigns each one a finite trampoline
symbol. The shim
recognizes only those package-provided symbols, calls the single imported
`env.vir_js_call_objects` dispatcher, and still rejects unrelated dynamic symbol
lookup.

Function-valued host-import arguments use the same package-scoped policy. The
JavaScript runtime roots the Lean closure with `vir_obj_closure_root`, passing
only the callback arity and effect bit to the shim. JavaScript keeps the full
manifest function descriptor on the `VirCallback` wrapper, lowers callback
arguments to owned objects, and lifts the owned object result returned by
`vir_closure_call_objects`. JavaScript must eventually release the root through
`vir_closure_release`. The closure root table is re-entrant: executing a callback
can register nested closures and may reallocate the table while a callback is
running.
The JavaScript import dispatcher records synchronous host exceptions out of
band because the C++ trampoline must return a structurally valid Lean object.
Both top-level object calls and closure calls clear and consume that same error
slot around their execution, so the trampoline's boxed placeholder cannot turn
a host exception into a successful retained-callback result. Callback roots
created while lifting a host call are released if any later phase of that call
fails; only a completely successful binding may retain them.
This keeps the Lean heap reference count explicit while avoiding any change to
the upstream interpreter file.

`Vir/GeneratePackage/NativeExterns.lean` is the source of truth for native extern
registrations. Run `npm run check:native-externs` after changing its
`nativeExterns` table; this verifies that the table's parameter, borrow, and
result ABI matches Lean's imported IR declarations. Run
`node scripts/check-boundary-registry.mjs --write` after adding, removing, or
renaming native extern entries; this regenerates
`wasm/upstream_shim/runtime/native_symbols_registry.inc`. The regular
`npm run check:boundary-registry` guard then verifies that the generated
registry is current and that every native extern has a matching `dlsym` symbol
plus one of a boxed wrapper in `wasm/upstream_shim/runtime/native_symbols.cpp`,
a compiler-generated wrapper selected by the native extern entry, or a native
constant entry in the generated registry. `npm test` runs these checks before
the smoke and fixture suites.

The boxed wrappers can be inventoried with:

```bash
npm run inspect:native-wrappers
```

This groups wrappers into compiler-generated wrappers, shim macro-generated
helpers and direct calls, remaining regular direct calls, direct calls that
retain a borrowed result, aliases, and custom shim behavior. The inventory
gives wrapper-generation work a concrete target without introducing another
handwritten ABI table. The remaining regular direct-call wrappers can be
grouped by broad ABI and wrapper-plumbing model with:

```bash
npm run inspect:native-wrapper-shapes
```

Use that shape report to select the next compiler-generation candidates. For a
standard ABI adapter, mark the native extern, build and exercise the generated
wrapper, then remove its shim definition. Add another shim macro class only
when Lean's normal compiler output cannot express the required runtime or WASI
policy. `npm run check:native-wrappers` continues to verify that the remaining
shim helper wrappers use the helper implied by the Lean-side ABI table and that
shim direct-call macros match their narrow modeled ABI shape. Aliases, retained
borrowed results, and custom behavior remain explicit until their policy is
handled separately.

The boundary between the two approaches is intentionally narrow:
`lean_ir_find_env_decl` and `lean_ir_find_env_decl_boxed` delegate to
`package/decl_provider.h`. Today that provider is backed by a small package decoded from
`Lean.IR.Decl` data. Later it can be backed by generated module data or a real
environment loader without changing `ir_interpreter.cpp` or the WASI/platform
shim.

## Current Boundary

The remaining gap is fidelity, not execution. The demo bodies now come from the
real Lean compiler IR for the example sources and selected imported IR
declarations, but they are loaded from a demo-specific package instead of Lean's
generated module data. A later provider can replace this package with generated
module data behind `package/decl_provider.h`.

The parser vertical target now reaches `Lean.Parser.parseHeader`. Package
generation records initialized globals as `(declaration, initializer)`
pairs using Lean's own init-attribute metadata, then the WASM loader executes
those initializers through upstream `lean_run_init` before evaluating demo
roots. This initializes the parser and environment extension globals needed by
the header parser while keeping the path compatible with a future generated
module loader.

The current parser support still uses a small shim boundary for opaque
environment bridges: `evalConstCore` delegates to upstream `lean_eval_const`,
`isReservedName` delegates back into packaged IR for `Lean.isReservedName`, and
`evalCheckMeta` is accepted for the demo. That is the next fidelity boundary to
remove if we want parser loading to behave exactly like a full Lean runtime.

The runtime/platform stub files keep the remaining platform boundary explicit:

- runtime budget and tracing hooks (`check_system`, heartbeat reset, time tasks,
  and trace scopes) live in `runtime/runtime_environment_stubs.cpp` and are inert in
  this single-threaded demo build;
- initializer metadata queries are package-backed, using the same init-global
  table that `vir_load_ir_package` executes through upstream `lean_run_init`;
- option registration, sorry dependency lookup, and export-name lookup remain
  demo no-ops in `runtime/runtime_environment_stubs.cpp`;
- stderr/error printing remains a demo no-op in `runtime/io_stubs.cpp` because the
  package generator and JavaScript runtime provide the active diagnostics for
  this path.

## Future Loading Path

The current loader is intentionally demo-specific: it decodes the package format
emitted by the `Vir/GeneratePackage/` modules. A future loading step is to make the
package format match Lean's generated `.ir` or module data more closely, so the
same stable `vir_load_ir_package(ptr, len)` boundary can load artifacts produced
by Lean itself.

## Future Wasm Interfaces

The closure/resource bridge is intentionally conservative for `wasm32-wasip1`.
Ordinary scalar and structured values use descriptor-guided object lowering over
the object ABI. Opaque resources cross the JS/Wasm boundary through
`externref` side-channel imports, and Lean stores them as GC-finalized external
objects that root JavaScript `HostResource` objects in the host runtime.
`INTERFACE_TAG.FUNCTION` likewise avoids a serialized numeric token; Lean closures remain
represented by runtime-owned closure roots surfaced to JavaScript as opaque
`VirCallback` objects.

See `docs/REACT_WASM_BINDINGS.md` for the React-first binding plan and local
feature probes. This repository uses `externref` terminology for host
references; `nativeref` is not a standard WebAssembly feature name. The
experimental React resource path requires `externref` instead of carrying a
plain JavaScript map fallback.

Useful WebAssembly features to track before widening the ABI:

- Reference Types are already part of the finished proposal set, and `externref`
  is now required for JavaScript host resources. Direct `externref` values for
  `Element`, callback-scoped `Event`, and `ReactRoot` now cross the C++/Wasm
  ABI through a resource side channel; `externref` does not remove the need to
  root and release Lean heap closures explicitly.
- The Component Model is still proposal-track and is the right semantic target
  for typed resources once this project moves beyond an internal `.irpkg`
  manifest. The current `Lean.Vir.Js α` marker model is intentionally
  compatible with that direction without committing to WIT today.
- JS Promise Integration and Stack Switching are the relevant future mechanisms
  for Promise-shaped or coroutine-shaped host calls. The current API avoids that
  problem by keeping host imports synchronous and modeling browser async APIs as
  callback registration plus cancellation handles.
- Wasm GC and typed function references are useful platform work to watch, but
  Lean closures are currently objects in Lean's own heap. They do not replace
  the refcounted root/release bridge in this phase.

Primary status references:

- [WebAssembly finished proposals](https://github.com/WebAssembly/proposals/blob/main/finished-proposals.md)
- [WebAssembly active proposals](https://github.com/WebAssembly/proposals)
- [WebAssembly feature status](https://webassembly.org/features/)
