# Exact runtime publication and anonymous acquisition

Checkpoint date: 2026-10-01. This is an executed upstream acquisition checkpoint,
not a fresh Slides cold-deck, browser or complete product qualification.

## Published identity

| Field | Value |
| --- | --- |
| Release/source checkpoint | `af3052cac2740f41bd701de3646df348b7e2dbb3` |
| Pack-producing source | `0f720625c95bac32d200cc582d49eaea25f2795f` |
| Acquisition/test checkpoint | `3a7c836c430cb13668f3e8c240b65f10f739e876` |
| Runtime content ID | `832ab095ad79df0f10f538bcf71272731bb74b90df44f965dac2f086c222897d` |
| Pack SHA-256 | `d06bda0aba96547679093da441cd3d9b2b7a9291d1757f16c5c6fcf6ed081ba1` |
| Pack size | 1,120,731 bytes |
| Lean revision | `293d5d0c0c3f3dded4688b3ccd6a33939ac5102b` (v4.34.0) |
| VIR compatibility version | 1 |
| JavaScript SHA-256 | `b9fa28797af2787b4bae53a4d4a6a440b718512b54553717c65630b239b5829a` |
| Wasm SHA-256 | `e74e7f8e663537a4f0035c0edf594fbea9699f40b4b683ffe563922b4f453ec4` |

Public [release and producer notes](https://github.com/ejgallego/lean-vir/releases/tag/resource-832ab095ad79df0f10f538bcf71272731bb74b90df44f965dac2f086c222897d)
and [exact pack](https://github.com/ejgallego/lean-vir/releases/download/resource-832ab095ad79df0f10f538bcf71272731bb74b90df44f965dac2f086c222897d/832ab095ad79df0f10f538bcf71272731bb74b90df44f965dac2f086c222897d.virres).
The native embedding successor does not change the runtime payload. This pack
is not an SDK archive or a program package; program generation stays independent.

Publication created a draft, uploaded without overwriting an asset, downloaded
and checked the draft bytes, then published with `latest=false`. The release's
asset digest, a separate anonymous `curl -q` download, the retained producer pack,
and the campaign's acquired cache/stage all match the checksum above. The release
tag's exact source target was independently read back. The non-`v` tag does not
trigger the separate SDK source-build workflow.

The repository does not enable GitHub-enforced immutable releases. Its contract
is exact verified content identity, not trust in a mutable filename. Modification
or corruption cannot silently satisfy the selected identity; availability remains
a hosting concern. No settings or older release assets were changed.

## Executed acceptance

`npm run test:resources:published` passed at the acquisition/test checkpoint.
It uses a fresh committed source archive, intermediary library and leaf application.
No producer `.lake`, runtime stage or manually supplied pack is copied. Relevant
runtime caches start empty; ordinary Lean/toolchain caches are not claimed empty.

- The leaf's ordinary `lake exe generate-site` acquired the public runtime through
  library prerequisites and published one runtime plus one program.
- Native `--offline` reused that exact cache/stage with unchanged inode, mtime
  and size. An independent empty cache/stage rejected with
  `RESOURCE_OFFLINE_MISS: required bundle 832ab095ad79df0f10f538bcf71272731bb74b90df44f965dac2f086c222897d`.
- The ordinary warm build left staging unchanged. Deleted/corrupt program staging
  repaired. A program-only edit changed its pack without changing runtime staging.
- The carrier-cycle negative rejected, restoration passed, and the native executable
  rendered from another working directory with its raw program pack withheld.
- No Wasm source build, authentication, alternative revision or fallback pack was
  involved in acquisition. No new browser/PrettyM semantic campaign was run.

The explicit network-dependent command is not added to the routine CI aggregate.
All fixture sources and the qualification command are committed. The full local
inputs and ten logs remain in `build/resource-client-FsQMQp`; direct publication
downloads remain in `build/resource-release-20261001-5gK8K2`.

| Campaign log | SHA-256 |
| --- | --- |
| `cold.log` | `a2995e272c5a01c2e88695acd12f9548f20a36920dc70b793a1c33dccf521ce8` |
| `warm-offline.log` (empty successful output) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `cold-offline-miss.log` | `c4f397ab46aca60653190d101d48f51c3c51c3f66e08b4f97e8547d99ae74351` |
| `warm.log` | `c1c00d547b80d81755be338f9396fb86cc7c0b35f97b15cfd30c0a47542d7ec0` |
| `repair-stage.log` | `21f87bf02f1e46ff7885ac6c28ea3495938a84271fb0017c84b7a55eab64ab31` |
| `repair-corrupt-stage.log` | `c1c00d547b80d81755be338f9396fb86cc7c0b35f97b15cfd30c0a47542d7ec0` |
| `program-edit.log` | `a2f205e264c3b89d09c983d28743d97b9ee61b22a16823af17a72583a951e6cd` |
| `carrier-cycle.log` | `6742a968131a831675efa65ee20afa6111a1f74e2077874b172f21660db61b25` |
| `restored.log` | `2a5a6b1927388c0f83a490504aca1eb43e862227c81efcab9a8d0ca20537ad1d` |
| `native-raw-program-absent.log` | `a386b369fd06042ea1b55ce87595b224f0cd49c4bd7ceebd16d8c206a6dacf50` |

## Downstream boundary

Slides' supplied-pack acceptance remains independently credited at source
`ea079cd7bff00f986e5f4a7edcd2e74aafb59bda`, evidence head
`3f7dbc93f10f1ed2ef88ee65dda9019b5c298233`, VIR `af3052ca`, runtime `832ab095`,
and unchanged program `97b280b7`. Only a deliberate pin/manifest update is needed
for the public-source successor; no creation API, carrier syntax, interface ID,
formatter policy or runtime payload changes. A fresh ordinary Slides build without
supplied bytes must be qualified by its owner before claiming downstream cold
installation. Final geometry, performance and retention remain separate gates.
