# Lean 4.35 runtime qualification

The Lean 4.35.0-rc3 toolchain requires its own runtime pack. This candidate
includes PR #212's Wasm-owned JavaScript resource roots and matching JavaScript.
The earlier [4.34 publication](../runtime-release/README.md) remains historical
evidence and a maintenance-line artifact.

## Candidate identity

| Field | Value |
| --- | --- |
| Runtime content ID | `1e46923f479af195736f95fe8e6fe0afde85224a02c7f87eb5d372159d9a2261` |
| Pack SHA-256 | `9d61936abc328812f68a227d5eb81531f35925447980a47afba6decbfabfd4b9` |
| Pack size | 1,118,386 bytes |
| Lean revision | `470d5ce1400764999581fd26d5d72b00d990b0f4` (v4.35.0-rc3) |
| VIR compatibility version | 1 |
| JavaScript SHA-256 | `4da19219feb67c65a6129a383ad14141bc4b8f2cb3bbda755cc5f68eb0c6dd6e` |
| Wasm SHA-256 | `a635e35f7f5648c4d3c61dfb7b64bc1417c44b64f0d31378c2497bd35a6e7f15` |
| Producer source | `61c96a7a0441c2e9fc6c8d364410a4e5dc616c87`, based on PR #212 `1d81e567` |

The lock/evidence successor changes no runtime implementation inputs.
Publication is pending; the lock names the intended content-addressed release.
The selected bytes must become anonymously downloadable before this upgrade
lands. There is no anonymous-download acceptance claim for this candidate.

## Qualification

A fresh release build uses WASI SDK 33, clean Lean source matching the pinned
compiler and zero unresolved symbols. Upstream's 105 fixtures, 110 runtime
units, 19 pure runtime cases, the Wasm root allocator and the integrated real-trap
root-retirement checks pass. Native/Wasm reference fixtures agree, including
fresh shared/unique swap and heap-valued modifyGet. The Infoview Smoke and
current-toolchain client-native extern checks also pass.

Resource core, acquisition, packing, native program and descriptor checks pass
under the matching profile. The real-browser resource suite passes all 16
checks; its runtime inventory matches this candidate. These checks qualify the
upstream runtime and resource workflow. A supplied-pack leaf campaign also
passes ordinary cold/warm builds, program edits, stage repair, cycle rejection
and relocated native rendering with this exact pack. They do not establish downstream Slides
adoption or complete product acceptance. Catalog ports follow the
[catalog migration roadmap](../../HARNESS.md#catalog-migration-roadmap).

The earlier local `9f2ab417` candidate and its supplied-pack/cache campaign
predate PR #212. They remain historical evidence and do not qualify this new
JavaScript/Wasm pair. No release was published by this rebase.
