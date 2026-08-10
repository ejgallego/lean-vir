# Fixture Coverage

`npm run test:fixtures` runs the upstream-backed conformance fixture surface.
Each fixture is Lean source under `fixtures/`, elaborated into real
`Lean.IR.Decl` values by the compiled `vir_irpkg` package generator, and then
compared against Lean's host IR interpreter with
`interpreter.prefer_native=false`. The package generator is built from
`tools/GeneratePackage.lean` and the `Vir/GeneratePackage/` library modules.
The runner schedules fixtures in parallel using half of Node's reported
`availableParallelism()` by default; set `VIR_FIXTURE_JOBS=1` for serial
debugging or another positive value to pin the worker count.

Known unsupported fixtures can be tracked in `fixtures/manifest.json` so
boundary gaps remain explicit. The runner writes `build/fixtures/summary.json`
with per-fixture status, imported IR declarations, native externs, and
missing-boundary diagnostics for CI and boundary debugging.

The Lean-dependent runtime smoke also generates temporary packages with
intentionally unsupported or ambiguous interface exports and asserts that
package generation fails loudly with package diagnostics.
Those negative cases cover recursive inherited structures, indexed inductive
families, mutual recursion, erased proof fields, and implicit arguments. A
raw-marker fallback case bypasses both marker callbacks and confirms package
generation applies the same indexed-inductive, naked-resource, erased/implicit
export, and startup parameter/result diagnostics. Direct attribute cases assert
that indexed inductives and naked JavaScript resource markers instead fail at
the marked declaration after compilation. The indexed cases also require a
source-like nested type such as `Array (IndexedPair 0 × Option (IndexedPair 1))`
without exposing synthesized numeric-literal evidence in either diagnostic path.
The package-generator smoke separately checks normal Lean frontend processing
for both markers. Negative `@[vir_export]` cases cover unsupported binder
shapes, theorem, axiom, private declarations, and a local helper that reaches
the unregistered `IO.getEnv` primitive. Negative `@[vir_startup]` cases cover
arguments, non-`Unit` results, an unsupported effect constructor, theorem and
private declarations, and the same unsupported runtime dependency. Positive
startup cases cover every supported effect head, pure `Unit`, a reducible
effect alias, and adding and removing the marker with `attribute`; the
generated manifest is checked for each expected effect. The smoke also checks
the informational postponed-compilation path. The Lake facet smoke also builds
external `module` sources that import the typed marker preflight, full interface
classifier, and complete `Vir.GeneratePackage` pipeline APIs. It covers the
safe stop at an opaque imported declaration, while package generation loads the
owning module and reports the remaining unsupported dependency path.

The browser smoke resolves dev-runner entries from each package's embedded
manifest, so UI coverage follows generated entry ids and export counts rather
than a separate hand-maintained list of JavaScript names. It also checks that
the generated focused browser packages appear in `/dev.html` selectors, that
`pretty-printer.irpkg` powers the dedicated `/format.html` workbench, and that
selecting each entry renders the expected control kinds from the manifest.

## Current Passing Surface

The current fixture surface covers:

- recursion, inductive pattern matching, local list processing, partial
  application, branches over comparisons, `Bool`, `Option`, `Prod`, `Sum`, and
  `Except`;
- standard `List.map`/`List.filter`/`List.foldl`/`List.any`/`List.all`/
  `List.find?`/`List.zip`;
- standard `Array.map`/`Array.foldl`/`Array.any`/`Array.filter`/`Array.find?`,
  array push/toList, and array construction/mutation through
  `Array.emptyWithCapacity`/`Array.getInternal`/`Array.replicate`/`Array.set`/
  `Array.set!`/`Array.swap`/`Array.swapIfInBounds`/`Array.pop`;
- basic `String.append`/`String.length`/`String.utf8ByteSize`/
  `String.getUTF8Byte`/`String.push`/`String.Internal.next`/
  `String.Internal.extract`/`String.Pos.Raw.get`/`String.Pos.Raw.prev`/
  `String.Internal.atEnd`/`String.decEq`, string ordering, `String.toUTF8`,
  `String.ofByteArray`, case conversion, hashing, containment, and position
  validity;
- public string helpers including `String.fromUTF8?`/`String.contains`/
  `startsWith`/`drop`/`dropEnd`/`trimAscii`/`splitOn`/`intercalate`/`any`/
  `front`/`pushn`/`isEmpty`/`String.Pos.Raw.nextWhile`/`String.find`/
  `String.Pos.Raw.offsetOfPos`, direct `String.Internal.trim`/`isPrefixOf`/
  `foldl`/`isEmpty` boundary fixtures, and a direct
  `String.Internal.getUTF8Byte` raw-byte fixture over mixed-width UTF-8;
- `Char.toUpper`/`Char.toLower`/`Char.utf8Size`;
- `ByteArray.mk`/`ByteArray.empty`/`ByteArray.push`/`ByteArray.get`/
  `ByteArray.get!`/`ByteArray.set!`/`ByteArray.extract`/
  `ByteArray.copySlice`/`ByteArray.size`/`ByteArray.validateUTF8`, including
  growing and overlapping slice copies;
- `UInt8`/`UInt16` `toNat` plus arithmetic/bitwise/shift/comparison
  operations;
- `UInt32` literals, `UInt32.ofNat`/`toNat`/`toUInt8`, and `UInt32`
  arithmetic/bitwise/shift/comparison operations;
- `UInt64.ofNat`/`ofNatLT`/`toNat`/`toUSize`/`toFloat`, `UInt64`
  arithmetic/bitwise/shift/comparison operations, and large `UInt64.toNat`
  results returned through the decimal-string Nat API;
- package-backed `Nat` literals wider than 32 bits, `Nat.div`/`pow`/`log2`/
  `shiftLeft`/`shiftRight`, small `Int` arithmetic, `USize` `sub`/`mul`/
  `land`/`shiftLeft`/`shiftRight`/`toNat`/`decLe`, `Float.scaleB`, and
  `Float.toUInt32`; the slide canvas smoke additionally covers `Float.sub`;
- `Float.abs`/`sqrt`/`sin`/`cos`/`acos`/`atan2`/`cbrt`/`floor` over finite
  values, both signed zeros, infinities, NaN, inverse-cosine boundaries,
  `atan2` quadrants, positive and negative cube roots, and positive and
  negative floors, with bit-level predicates and no JavaScript math imports;
- `ByteArray.emptyWithCapacity`/`decEq`/`uget`/`data`/`hash`, including
  capacity-backed construction, equality, inequality, in-bounds indexing,
  conversion to `Array UInt8`, and content hashing;
- `Lean.Expr` package closure and structural JS/WASM marshaling for constants,
  applications, literals, binders, levels, variables, projections, metadata
  results, and bound-variable inputs/results;
- direct recursive custom structures, such as linked chains, and direct
  recursive custom inductives such as trees and lambda terms;
- mixed nullary/payload custom inductives, such as JSON-like trees;
- manifest-backed recursive interface calls including `Array String`,
  `List UInt32`, `Option Nat`, `Option String`, `Nat × Nat`,
  `Option (Array Nat)`, `List (Nat × String)`, `Sum Nat Nat`,
  `Except Nat (Option (Sum Nat Nat))`, non-indexed user-defined structures
  with object, scalar, `USize`, enum, parameterized, scalar-only trivial
  wrapper, `UInt64` trivial wrapper, and inherited parent fields, direct
  top-level `UInt64`, `Float`, `Float32`, and `Array Lean.Expr`;
- hash/name/substring/pointer-address primitives reached by parser data paths,
  including `mixHash`, `Lean.Name.beq`, `Substring.Raw.Internal.beq`, and
  `ptrAddrUnsafe`;
- parser input setup through `Lean.Parser.mkInputContext`,
  `Lean.FileMap.toPosition`, `Lean.Parser.mkParserState`, and the vertical
  `Lean.Parser.parseHeader` fixture backed by packaged initialized
  parser/environment extension globals;
- a minimal real `Lean.Expr` construction and structural renderer over
  constants, applications, literals, binders, and universe levels, backed by
  explicit `Lean.Expr`/`Lean.Level` data-helper externs;
- `Std.Format.pretty` over grouped soft lines, hard text newlines, nesting, and
  alignment;
- the dedicated `pretty-printer.irpkg` component package and `/format.html`
  workbench for the `Std.Format.pretty` fixture surface;
- narrow synchronous coverage for already-resolved `Task.pure`/`Task.get`/
  `Task.map`, because real `Environment` values store a checked kernel
  environment behind `Task`;
- normal execution as post-initialization (`IO.initializing = false`),
  initialization mode while packaged `builtin_initialize` globals run through
  upstream `lean_run_init`, and single-threaded `ST.Prim.mkRef`/
  `ST.Prim.Ref.get`/`ST.Prim.Ref.set`/`ST.Prim.Ref.take` support for ref access
  reached by fixtures and parser setup.

## Known Pretty-Printer Boundary

The current pretty-printer fixture is `Std.Format.pretty`, not
`Lean.PrettyPrinter.ppExpr`. A local probe of `ppExpr` over a minimal
constructed expression works in host Lean and prints `Type -> Nat.succ 41`
modulo Lean's Unicode arrow, but package generation is much larger than the
format fixture. The delaborator-only closure already loads more than seven
thousand declarations and reaches native boundaries for `Task`/`Promise`,
`Environment` async constants, `Lean.Meta.inferType`, `Lean.Meta.whnf`,
expression substitution/equality helpers, and related IO/task state. The full
pretty path adds the parenthesizer and formatter interpreter boundary.

`Task` is pulled in through Lean's `Environment`: `Environment.checked` is a
`Task Kernel.Environment`, `addConstAsync` and `promiseChecked` use
`IO.Promise.result?.bind`, `AsyncConsts.findRecTask` uses `Task.bind`, and
`Lean.addDecl` can use `BaseIO.mapTask`. Supporting `ppExpr` should therefore
be a separate runtime-boundary effort, not an extension of the minimal
`Std.Format.pretty` component package.
