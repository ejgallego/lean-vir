# Fixture Coverage

`npm run test:fixtures` runs the upstream-backed conformance fixture surface.
Each fixture is Lean source under `fixtures/`, elaborated by Lean 4.30-rc2 into
real `Lean.IR.Decl` values, packaged with `tools/GeneratePackage.lean`, and
then compared against Lean's host IR interpreter with
`interpreter.prefer_native=false`.

Known unsupported fixtures can be tracked in `fixtures/manifest.json` so
boundary gaps remain explicit. The runner writes `build/fixtures/summary.json`
with per-fixture status, imported IR declarations, native externs, and
missing-boundary diagnostics for CI and boundary debugging.

The runtime smoke also generates temporary packages with intentionally
unsupported interface exports and asserts that package generation fails loudly.
Those negative cases cover function fields, recursive structures, indexed
inductive families, implicit arguments, and direct top-level `UInt64` exports.

The browser smoke resolves dev-runner entries from each package's embedded
manifest, so UI coverage follows generated entry ids and export counts rather
than a separate hand-maintained list of JavaScript names. It also checks that
every generated `vir-demo.irpkg` export appears in the `/dev.html` selector and
that selecting each entry renders the expected control kinds from the manifest.

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
  `String.Pos.Raw.offsetOfPos`;
- `Char.toUpper`/`Char.toLower`/`Char.utf8Size`;
- `ByteArray.mk`/`ByteArray.empty`/`ByteArray.push`/`ByteArray.get`/
  `ByteArray.get!`/`ByteArray.set!`/`ByteArray.extract`/`ByteArray.size`/
  `ByteArray.validateUTF8`;
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
  `Float.toUInt32`;
- `Lean.Expr` package closure and structural JS/WASM marshaling for constants,
  applications, literals, binders, levels, variables, projections, metadata
  results, and bound-variable inputs/results;
- manifest-backed recursive interface calls including `Array String`,
  `List UInt32`, `Option Nat`, `Option String`, `Nat × Nat`,
  `Option (Array Nat)`, `List (Nat × String)`, non-indexed user-defined
  structures with object, scalar, `USize`, enum, parameterized, scalar-only
  trivial wrapper, and inherited parent fields, and `Array Lean.Expr`;
- hash/name/substring/pointer-address primitives reached by parser data paths,
  including `mixHash`, `Lean.Name.beq`, `Substring.Raw.Internal.beq`, and
  `ptrAddrUnsafe`;
- parser input setup through `Lean.Parser.mkInputContext`,
  `Lean.FileMap.toPosition`, `Lean.Parser.mkParserState`, and the vertical
  `Lean.Parser.parseHeader` fixture backed by packaged initialized
  parser/environment extension globals;
- narrow synchronous coverage for already-resolved `Task.pure`/`Task.get`/
  `Task.map`, because real `Environment` values store a checked kernel
  environment behind `Task`;
- normal execution as post-initialization (`IO.initializing = false`),
  initialization mode while packaged `builtin_initialize` globals run through
  upstream `lean_run_init`, and single-threaded `ST.Prim.mkRef`/
  `ST.Prim.Ref.get`/`ST.Prim.Ref.set`/`ST.Prim.Ref.take` support for ref access
  reached by fixtures and parser setup.
