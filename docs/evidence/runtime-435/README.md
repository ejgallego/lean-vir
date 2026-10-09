# Lean 4.35 runtime qualification

Lean 4.35.0-rc4 support landed in
[PR #198](https://github.com/ejgallego/lean-vir/pull/198) as
`a1b4bfaeff165eb095ca36edee8e2c9365bcec2c` on 2026-10-09. Its published runtime includes the
landed native compiler/library separation and the current constructor/callback
implementation, with descriptor schema 2 and resource compatibility 3.
The [4.34 publication](../runtime-release/README.md) remains historical evidence
and a maintenance-line artifact.

## Published identity

| Field | Value |
| --- | --- |
| Runtime content ID | `6cddc4b897410d7524a69bdaff0327d9f07916735078a0b12d548e2f88c23d20` |
| Pack SHA-256 | `8fbf3dd2cc065c714ba17b7093edbcd1e285e7fc6353b7b7594c5031781dccf3` |
| Pack size | 1,114,116 bytes |
| Lean revision | `c29b6dda4f7c20e3eeaa717c4e565663c5cfa364` (v4.35.0-rc4) |
| Descriptor schema | 2 |
| Runtime lock schema | 1 |
| VIR compatibility version | 3 |
| Runtime ABI | 4 |
| IR package binary format / interface manifest | 11 / 9 |
| Package-set format / VIRRES binary framing | 2 / 1 |
| JavaScript size | 239,305 bytes |
| JavaScript SHA-256 | `b216a5964e9cdc4115877eaa71a27fa32108a40c805ff87f0f29bb51700cf039` |
| Wasm size | 771,527 bytes |
| Wasm SHA-256 | `4a2da5b488dfd6db62918079147b8d7bda3c3654ed43d76f65d80de0f67596d2` |
| Producer source | `606df8ea5611b2ccd532db4e0a41bbdc71b7bf38`, based on main `fb5af647` |
| Tested committed source / release target | `e0d1e29141e0398242463afded29d7898527eaa7` |

The e0 lock/evidence successor changes no runtime implementation inputs. The
[runtime release](https://github.com/ejgallego/lean-vir/releases/tag/resource-6cddc4b897410d7524a69bdaff0327d9f07916735078a0b12d548e2f88c23d20)
is public, marked prerelease and non-latest, and targets that exact tested source.
The lock's
[public pack URL](https://github.com/ejgallego/lean-vir/releases/download/resource-6cddc4b897410d7524a69bdaff0327d9f07916735078a0b12d548e2f88c23d20/6cddc4b897410d7524a69bdaff0327d9f07916735078a0b12d548e2f88c23d20.virres)
was acquired anonymously and verified against the full SHA-256 and length above.
Qualified local, CI, draft-downloaded and anonymous-downloaded packs are
byte-identical. Existing assets were not replaced; the previous e415 release
remains latest. The earlier publication-pending checkpoint is superseded by
this completed publication and acquisition record.

## Matching runtime qualification

The release/debug Wasm pair was refreshed with WASI SDK 33 and clean Lean source
matching the pinned compiler; the strict link has zero unresolved symbols.
Build provenance records clang/LLD 22.1.0, LLVM revision
`4434dabb69916856b824f68a64b029c67175e532`, target `wasm32-wasip1`, release
`-O3`, 4 MiB initial memory and a 1 MiB stack. The packed `runtime.js` and
`runtime.wasm` have the exact hashes above; they are one matching pair.

This content-addressed runtime release is not a general SDK release. The public
acquisition campaign used committed Lean source and the packed pair, without a
separate SDK archive. The retained earlier local SDK archive identifies dirty
source `4db4d1b3` and release Wasm SHA-256
`ce53f8f57ed57f0c0247f1f1ff30d079840db57264333a4a2492ab02a7118286`;
it does not qualify the 6cdd pair and must not be selected as its matching SDK.

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

[CI run 37900059597](https://github.com/ejgallego/lean-vir/actions/runs/37900059597)
completed successfully on exact e0: build-demo, runtime, runtime-lean and fixtures.
The squash onto intervening main `7e06a10d` preserved disjoint PR225 changes;
these checks do not claim a post-merge CI campaign on a1.

## Public acquisition acceptance

After publication, `npm run test:resources:published` passed on the committed e0
source. The test archives HEAD into a fresh producer without `.lake` or
`.vir-generated`, creates fresh client/user fixtures, and acquires the HTTPS
pack through the ordinary leaf command `lake exe generate-site DESTINATION`.
Published mode does not seed a supplied runtime pack.

| Check | Result |
| --- | --- |
| Cold ordinary build | Public acquisition, Lean tools/library build and native site generation pass from empty producer cache/stage. |
| Warm offline acquisition | Explicit `--offline` reuse passes; cache/stage inode, modification time and size remain unchanged. |
| Cold offline acquisition | Expected `RESOURCE_OFFLINE_MISS` for the exact content ID; no absent cache or stage is created. |
| Warm ordinary build | Program/runtime stages and carrier input remain unchanged; no Client/Main/Runtime rebuild. |
| Stage repair | Missing/corrupt program stage and missing carrier input are restored byte-identically. |
| Program edit and restoration | Program pack changes while the runtime stage stays unchanged; restoring the source passes. |
| Admission and cycles | Missing/duplicate selection, foreign module/package, carrier-as-root and prerequisite cycle are rejected; qualified selection passes. |
| Relocated native execution | Site generation passes from `/tmp` with the raw program pack removed and emits the matching runtime and program resources. |

The maintainer's immutable acquisition receipt is
`VIR-435-PUBLIC-RUNTIME-QUALIFICATION-20261009-001`, SHA-256
`6975b44f8597c4b48018d7aac20c9584c342896c772ecc3ecd3a1fe71a85c1c1`.
Its retained logs distinguish the expected cold-offline failure from success.
This documentation correction reuses those completed tests; it performs no
rebuild, republication or duplicate campaign.

## Scope and subsequent native qualification

The 19 browser resource checks and supplied-pack campaign preceded publication
and qualify the byte-identical pair. The public leaf campaign proves
acquisition/build/native publication; its relocated native execution does not
itself execute Wasm in a browser. Warm offline acquisition is pack-acquirer
reuse, not an entire offline application rebuild. Release existence alone
does not establish these acquisition results.

The native owner separately reports qualification of
[PR #226](https://github.com/ejgallego/lean-vir/pull/226) at
`caa8261928423fc4c656f099c4c61c7099cab8b1` against exact main a1 on the same
Lean 4.35.0-rc4 toolchain: interface, cold native client, generator and ABI checks
pass. Baseline/candidate whole packages are identical at 33,760 bytes, SHA-256
`b65deed7daf4952f2e40bf8546b5f507c13d0b92f67d2c6985655bbb92f7c10e`;
full manifests are identical, SHA-256
`97a04a3587b7d01ee996b150c01dec4e6a5aeb177921d9fd62940d8778fc5561`.
This is native's separate evidence, not a rerun by the runtime owner. Native's
sole checker owns CI runs 37914190842 and 37914190841 and records their final
results separately; no PR226 CI acceptance is inferred here.

The importer body is preserved in its new `Vir.Compiler` module. The earlier
rc4 ordinary/resolved import-equivalence campaign remains separate evidence;
this refresh does not claim to rerun that complete campaign. These checks do
not establish downstream Slides adoption or complete product acceptance.
Catalog ports follow the [migration roadmap](../../HARNESS.md#catalog-migration-roadmap).

The earlier local `60760476` compatibility-2 candidate and the rc3 candidates
remain historical. Their browser/client/cache campaigns do not qualify this
new pair. The 4.34/e415 history and consumer pins remain unchanged; this record
does not activate a maintenance line or select downstream adoption.
