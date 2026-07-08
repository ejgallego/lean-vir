# IR Package Payload Analysis

This note looks past the format-10 package envelope and focuses on payload
cost. The useful question is not only which section is large, but which section
forces the most shim-side maintenance.

The data below comes from the current generated browser package set after
`npm run probe:upstream`.

## Section Sizes

| Package | Total bytes | Declarations | Decl % | Manifest | Manifest % | Export summaries | Host imports | Decl count | Exports | Host imports |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `demo-host.irpkg` | 1,130,425 | 1,026,885 | 90.8 | 90,080 | 8.0 | 2,360 | 11,001 | 3,079 | 54 | 82 |
| `fixtures-basic.irpkg` | 312,398 | 235,025 | 75.2 | 70,308 | 22.5 | 6,962 | 4 | 727 | 105 | 0 |
| `fixtures-boundary.irpkg` | 59,887 | 48,361 | 80.8 | 9,686 | 16.2 | 1,737 | 4 | 259 | 26 | 0 |
| `fixtures-lean.irpkg` | 908,498 | 894,529 | 98.5 | 9,767 | 1.1 | 1,578 | 4 | 1,555 | 25 | 0 |
| `pretty-printer.irpkg` | 102,536 | 90,901 | 88.7 | 11,107 | 10.8 | 425 | 4 | 217 | 6 | 0 |

Aggregate over these five packages:

| Section | Bytes | Share |
| --- | ---: | ---: |
| Declarations | 2,295,701 | 91.3% |
| Interface manifest | 190,948 | 7.6% |
| Export summaries | 13,062 | 0.5% |
| Host imports | 11,017 | 0.4% |

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

The declaration section is the main maintenance hotspot because the schema is
hand-maintained twice: once in Lean emission and once in C++ decoding. The C++
side also owns object construction details and reference-counting behavior while
materializing upstream `Lean.IR` values.

The first schema-centralization step is now the declaration payload tag table:
`scripts/ir-codec-tags.mjs` generates `Vir/GeneratePackage/PackageIRTags.lean`
and `wasm/upstream_shim/package/package_ir_tags.h`. This removes duplicated
numeric tag literals from the Lean emitter and C++ decoder, but the field order
and object materialization code are still intentionally direct handwritten code.

## Main Risks

1. **Schema drift.** Every supported `Lean.IR.Expr`, `FnBody`, `Alt`, `Arg`,
   `Param`, and `IRType` case has parallel Lean and C++ code.
2. **Object layout coupling.** The decoder does not just parse bytes; it
   directly allocates Lean objects with constructors that must match upstream IR
   layouts.
3. **Size work can add maintenance.** Name/string interning or compression
   could shrink packages, but it would add stateful decoding logic unless it is
   generated or kept sharply isolated.
4. **Host import bytes are not the issue.** Host import behavior has real shim
   complexity, but its package payload is tiny. Optimizing that section for size
   would not matter.

## Best Next Targets

1. **Add a declaration-payload inventory tool.** Count declaration entries,
   extern entries, IR node tags, name/string bytes, and repeated names. This
   tells us whether size comes from names, bodies, imported closures, or native
   extern entries before changing the format.
2. **Extend declaration codec schema generation.** The tag table is centralized.
   The next step would be a generated field-order schema or generated decoder
   skeleton for the IR cases, still producing direct Lean/C++ code rather than a
   runtime manifest interpreter.
3. **Review native extern entries.** Native externs are encoded as full extern
   declarations today. If they can become a smaller explicit native-symbol
   section, that reduces payload bytes and may simplify part of the decoder.
4. **Consider name/string interning only after measurement.** It is probably a
   real size win, but it should not be the first move unless repeated-name data
   proves it is worth the added decoder state.

The strongest candidate is therefore not compression. It is a declaration
payload inventory tool followed by deeper codec schema generation, because that
attacks both package size understanding and the shim-side maintenance burden.
