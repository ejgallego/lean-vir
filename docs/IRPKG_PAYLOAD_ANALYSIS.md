# IR Package Payload Analysis

This format-10 snapshot measures package payload size and identifies the code
needed to decode each section. It was generated on 2026-07-23 with
`npm run probe:upstream`; the numbers do not track later package changes.

To reproduce the source data, generate the packages and inspect each one:

```bash
npm run probe:upstream
for package in demo-host fixtures-basic fixtures-boundary fixtures-lean pretty-printer; do
  npm run inspect:irpkg -- --json "build/generated/${package}.irpkg" > "/tmp/${package}.json"
done
```

The JSON reports expose the total byte length, declaration count, per-section
byte lengths, and manifest export/host-import arrays used by the tables below.
Comparisons need the same package inputs and recorded Lean toolchain/date.

## Section Sizes

| Package | Total bytes | Declaration bytes | Decl % | Manifest bytes | Manifest % | Export-summary bytes | Host-import bytes | Init-global bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `demo-host.irpkg` | 1,133,485 | 1,028,007 | 90.7 | 91,757 | 8.1 | 2,402 | 11,220 | 4 |
| `fixtures-basic.irpkg` | 314,844 | 235,568 | 74.8 | 72,134 | 22.9 | 7,039 | 4 | 4 |
| `fixtures-boundary.irpkg` | 62,258 | 50,368 | 80.9 | 10,050 | 16.1 | 1,737 | 4 | 4 |
| `fixtures-lean.irpkg` | 908,670 | 894,529 | 98.4 | 9,939 | 1.1 | 1,578 | 4 | 2,525 |
| `pretty-printer.irpkg` | 102,580 | 90,901 | 88.6 | 11,151 | 10.9 | 425 | 4 | 4 |

The corresponding entry counts are:

| Package | Declarations | Exports | Host imports |
| --- | ---: | ---: | ---: |
| `demo-host.irpkg` | 3,083 | 55 | 84 |
| `fixtures-basic.irpkg` | 730 | 106 | 0 |
| `fixtures-boundary.irpkg` | 268 | 26 | 0 |
| `fixtures-lean.irpkg` | 1,555 | 25 | 0 |
| `pretty-printer.irpkg` | 217 | 6 | 0 |

Aggregate over these five packages:

| Section | Bytes | Share |
| --- | ---: | ---: |
| Declarations | 2,299,373 | 91.2% |
| Interface manifest | 195,031 | 7.7% |
| Export summaries | 13,181 | 0.5% |
| Host imports | 11,236 | 0.4% |
| Init globals | 2,541 | 0.1% |
| Package headers and section directories | 475 | <0.1% |

The declaration payload dominates byte size. The manifest can be visible in
export-heavy packages, but it is JavaScript-facing product surface and does not
drive shim complexity.

## Maintenance Surface

| Payload | Size pressure | Shim maintenance pressure | Current owners |
| --- | --- | --- | --- |
| Declarations | Very high | Very high | `Vir/GeneratePackage/Emit.lean` mirrors Lean IR encoding; `package/package_ir_decoder.cpp` mirrors the decoder; `package/package_ir_builders.cpp` reconstructs Lean IR objects. |
| Interface manifest | Medium | Low in C++, medium in JS | Lean manifest encoder and JavaScript validator/runtime tooling. The C++ shim treats it as an opaque string. |
| Export summaries | Low | Low | Small package-owned call metadata consumed by `vir_call_resolved_objects`. |
| Host imports | Low bytes, medium behavior | Medium | Small metadata section, but it drives host import dispatch, slot lookup, arity checks, and trampolines. |
| Init globals | Negligible | Low | Package-backed initializer-name lookup. |

The declaration section is the main maintenance hotspot because the IR
declaration payload shape is hand-maintained twice: once in Lean emission and
once in C++ decoding. The C++ side also owns object construction details and
reference-counting behavior while materializing upstream `Lean.IR` values.

The package name/IR declaration payload tag table in
`Vir/GeneratePackage/PackageIRTags.lean` defines the wire values, and
`scripts/native/ir-codec-tags.mjs` maps them into the generated
`build/generated/wasm/package/package_ir_tags.h`. Name tags are shared by
declarations, initializer globals, host imports, and export summaries; the
remaining tag groups are declaration-IR-specific. This removes duplicated
numeric tag literals from the Lean emitter and C++ decoder, but the field order
and object materialization code are still intentionally direct handwritten
code.

## Maintenance tradeoffs

Every supported `Lean.IR.Expr`, `FnBody`, `Alt`, `Arg`, `Param` and `IRType`
case has parallel Lean/C++ encoding code. The decoder also allocates objects
whose constructors and reference counts must match upstream IR layouts. Shared
tags do not eliminate field-order or object-layout drift.

This snapshot does not break declaration bytes down into names, strings, IR
bodies or extern entries, so it cannot predict savings from interning or
compression. Either technique adds decoder state. Host-import metadata is
already a tiny share of these packages despite its behavioral complexity.

Native externs are encoded as full extern declarations. A smaller encoding
would still need to preserve the static registry boundary; package size alone
does not justify general native lookup. The current binary and metadata
validation contract is in [IRPKG_FORMAT.md](IRPKG_FORMAT.md).
