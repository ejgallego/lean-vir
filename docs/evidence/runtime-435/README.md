# Lean 4.35 runtime qualification

Lean 4.35.0-rc4 requires its own runtime pack. This candidate includes the
landed native compiler/library separation and the current constructor/callback
implementation, with descriptor schema 2 and resource compatibility 3.
The [4.34 publication](../runtime-release/README.md) remains historical evidence
and a maintenance-line artifact.

## Candidate identity

| Field | Value |
| --- | --- |
| Runtime content ID | `6cddc4b897410d7524a69bdaff0327d9f07916735078a0b12d548e2f88c23d20` |
| Pack SHA-256 | `8fbf3dd2cc065c714ba17b7093edbcd1e285e7fc6353b7b7594c5031781dccf3` |
| Pack size | 1,114,116 bytes |
| Lean revision | `c29b6dda4f7c20e3eeaa717c4e565663c5cfa364` (v4.35.0-rc4) |
| Descriptor schema | 2 |
| VIR compatibility version | 3 |
| JavaScript SHA-256 | `b216a5964e9cdc4115877eaa71a27fa32108a40c805ff87f0f29bb51700cf039` |
| Wasm SHA-256 | `4a2da5b488dfd6db62918079147b8d7bda3c3654ed43d76f65d80de0f67596d2` |
| Producer source | `606df8ea5611b2ccd532db4e0a41bbdc71b7bf38`, based on main `fb5af647` |

The lock/evidence successor changes no runtime implementation inputs.
Publication is pending; the lock names the intended content-addressed release.
The selected bytes must become anonymously downloadable before this upgrade
lands. There is no anonymous-download acceptance claim for this candidate.

## Qualification

The release/debug Wasm pair was refreshed with WASI SDK 33 and clean Lean source
matching the pinned compiler; the strict link has zero unresolved symbols.
Upstream's 105 fixtures, 54 package and 133 runtime units, 22 pure runtime cases
and four focused Lean cases pass. The focused cases cover names, recursive owner
contexts, managed core and shared Lean ownership. Three native/Wasm reference
fixtures agree, including fresh shared/unique swap and heap-valued modifyGet.

A cold native-precompiled client passes compiler classification, marker/resource
imports, native calls, generator admission and module ownership checks. Native
extern/client checks and Infoview Smoke also pass on the separated libraries.
Resource core, acquisition, packing, native program and descriptor checks pass.
The browser resource suite passes all 19 checks; its runtime inventory agrees
with this exact pack. A supplied-pack leaf campaign passes ordinary cold/warm
builds, program edits, stage repair, cycle rejection and relocated native rendering.

The importer body is preserved in its new `Vir.Compiler` module. The earlier
rc4 ordinary/resolved import-equivalence campaign remains separate evidence;
this refresh does not claim to rerun that complete campaign. These checks do
not establish downstream Slides adoption or complete product acceptance.
Catalog ports follow the [migration roadmap](../../HARNESS.md#catalog-migration-roadmap).

The earlier local `60760476` compatibility-2 candidate and the rc3 candidates
remain historical. Their browser/client/cache campaigns do not qualify this
new pair. No release was published by this update.
