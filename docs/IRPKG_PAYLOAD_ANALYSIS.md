# IR Package Payload Analysis

This note looks past the format-10 package envelope and focuses on payload
cost. The useful question is not only which section is large, but which section
forces the most shim-side maintenance.

The snapshot below was generated on 2026-07-23 by running
`npm run probe:upstream`. Treat these numbers as a representative baseline, not
as values that update automatically when the browser package set changes.

To reproduce the source data, generate the packages and inspect each one:

```bash
npm run probe:upstream
for package in demo-host fixtures-basic fixtures-boundary fixtures-lean pretty-printer; do
  npm run inspect:irpkg -- --json "build/generated/${package}.irpkg" > "/tmp/${package}.json"
done
```

The JSON reports expose the total byte length, declaration count, per-section
byte lengths, and manifest export/host-import arrays used by the tables below.
Record the Lean toolchain and date with any refreshed snapshot so later changes
can be compared against the same inputs.

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

The first centralization step is now the package name/IR declaration payload
tag table: `scripts/ir-codec-tags.mjs` generates
`Vir/GeneratePackage/PackageIRTags.lean` and
`wasm/upstream_shim/package/package_ir_tags.h`. Name tags are shared by
declarations, initializer globals, host imports, and export summaries; the
remaining tag groups are declaration-IR-specific. This removes duplicated
numeric tag literals from the Lean emitter and C++ decoder, but the field order
and object materialization code are still intentionally direct handwritten
code.

## Main Risks

1. **IR payload drift.** Every supported `Lean.IR.Expr`, `FnBody`, `Alt`,
   `Arg`, `Param`, and `IRType` case has parallel Lean and C++ code.
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
2. **Extend IR declaration codec generation.** The tag table is centralized.
   The next step would be a generated field-order table or generated decoder
   skeleton for the IR cases, still producing direct Lean/C++ code rather than a
   runtime manifest interpreter.
3. **Review native extern entries only when a real demo requires it.** Native
   externs are encoded as full extern declarations today. A smaller
   representation might reduce payload bytes, but it must preserve the current
   static registry boundary and must not introduce general native lookup without
   a concrete demo case.
4. **Consider name/string interning only after measurement.** It is probably a
   real size win, but it should not be the first move unless repeated-name data
   proves it is worth the added decoder state.

The strongest candidate is therefore not compression. It is a declaration
payload inventory tool followed by deeper IR codec generation, because that
attacks both package size understanding and the shim-side maintenance burden.
