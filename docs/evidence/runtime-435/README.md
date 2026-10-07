# Lean 4.35 runtime qualification

The Lean 4.35.0-rc4 toolchain requires its own runtime pack. This candidate is
built on current main, including Wasm-owned resource roots, direct scalar
transport and compatibility version 2. The earlier
[4.34 publication](../runtime-release/README.md) remains historical evidence
and a maintenance-line artifact.

## Candidate identity

| Field | Value |
| --- | --- |
| Runtime content ID | `60760476a82195e1ca366d7c99e2c0a85f866c4e3a29d48aa40fdbcdc0adefe3` |
| Pack SHA-256 | `ae220cbe5dac130265005ebe8621ad36db81f67f2082c01b94ca0f7fea26e00e` |
| Pack size | 1,122,996 bytes |
| Lean revision | `c29b6dda4f7c20e3eeaa717c4e565663c5cfa364` (v4.35.0-rc4) |
| VIR compatibility version | 2 |
| JavaScript SHA-256 | `bb79ddd547a6eb030ec3ee99b2084295c333dcc5efbe30f854d49fb41123bfc2` |
| Wasm SHA-256 | `ce53f8f57ed57f0c0247f1f1ff30d079840db57264333a4a2492ab02a7118286` |
| Producer source | `4db4d1b3e12df78b4a9f80d9b1ca7f0591db6213`, based on main `b8d8fc0c` |

The lock/evidence successor changes no runtime implementation inputs.
Publication is pending; the lock names the intended content-addressed release.
The selected bytes must become anonymously downloadable before this upgrade
lands. There is no anonymous-download acceptance claim for this candidate.

## Qualification

A fresh release build uses WASI SDK 33, clean Lean source matching the pinned
compiler and zero unresolved symbols. Upstream's 105 fixtures, 118 runtime
units, 22 pure and 22 Lean runtime cases and the Wasm root allocator pass. Native/Wasm
reference fixtures agree, including fresh shared/unique swap and heap-valued
modifyGet. Infoview Smoke and current-toolchain package units also pass.

The pinned importer source is byte-identical between rc3 and rc4; its provenance
link is refreshed to the new revision. Import equivalence passes for ordinary
and relocated module/host contexts, including negative controls and region reuse.
Resource core, acquisition, packing, native program and descriptor checks pass.
The real-browser resource suite passes all 16 checks, with its runtime inventory
matching this candidate. An exact supplied-pack leaf campaign passes cold/warm
builds, program edits, stage repair, cycle rejection and relocated native rendering.
These checks qualify the upstream runtime and resource workflow, without establishing downstream Slides
adoption or complete product acceptance. Catalog ports follow the
[catalog migration roadmap](../../HARNESS.md#catalog-migration-roadmap).

The earlier local `1e46923f` and `9f2ab417` rc3 candidates remain historical
evidence. Their browser/client/cache campaigns do not qualify this new compiler
and compatibility-version-2 pair. No release was published by this update.
