# Lean 4.35 runtime qualification

The Lean 4.35.0-rc3 toolchain requires its own runtime pack. The earlier
[4.34 publication](../runtime-release/README.md) remains historical evidence
and a maintenance-line artifact.

## Candidate identity

| Field | Value |
| --- | --- |
| Runtime content ID | `9f2ab417841c2d8cb63b6184f2e29f25ca13112aac20334f582fb57efe21c6e7` |
| Pack SHA-256 | `83843e1caff179f665bf11524e5c75356534c41e323aef019178392c4fb194bb` |
| Pack size | 1,121,847 bytes |
| Lean revision | `470d5ce1400764999581fd26d5d72b00d990b0f4` (v4.35.0-rc3) |
| VIR compatibility version | 1 |
| JavaScript SHA-256 | `b9fa28797af2787b4bae53a4d4a6a440b718512b54553717c65630b239b5829a` |
| Wasm SHA-256 | `4fbd283c098f679460bf6ef67de962749e2e65ad7d87d782b06afc7a7405e931` |

Publication is pending. The selected lock names the intended content-addressed
release; it must become anonymously downloadable before this upgrade lands.
There is no anonymous-download acceptance claim for this candidate yet.

## Qualification

The producer uses WASI SDK 33 and the release Wasm profile, with clean Lean
source matching the pinned compiler and zero unresolved symbols. The runtime
JavaScript payload is unchanged from the 4.34 pack; the Wasm and compatibility
identity change. The real-browser resource suite passes all 16 checks. Its
runtime member inventory and compatibility were independently compared with
this pack and match exactly; the test descriptor uses a different logical ID.

The supplied-pack leaf campaign passes ordinary cold/warm construction, program
editing, stage repair, cycle rejection and relocated native rendering with the
selected pack. Resource acquisition, packing, program construction and descriptor
checks pass under the new profile. The cache campaign also passes with this
exact supplied pack, including ordinary library/leaf builds and shared-producer
artifact reuse. The reference fixture covers fresh heap allocations through
shared/unique swap and heap-valued modifyGet; native/Wasm results agree at 32.

These gates qualify the upstream runtime and resource workflow. They do not
establish downstream Slides adoption, a complete product acceptance, or catalog
compatibility. Every active catalog entry needs current-toolchain qualification.
