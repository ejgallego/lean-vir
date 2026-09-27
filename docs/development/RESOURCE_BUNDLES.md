# Resource bundles: implementation checkpoint

The new client contract is compiled resource data: an intermediary library owns
its browser program and resources, and its users keep an ordinary dependency
and executable command. The application does not discover VIR build paths or
invoke a resource preparation command.

**This checkpoint implements data, packing, embedding, native acquisition,
automatic carriers, the client recipe and browser role loading.** The three-package
build test passes with a maintainer-seeded, verified runtime. The local Slides
PrettyM demo has passed its shared native/browser corpus and bounded lifecycle
review; durable anonymous runtime distribution remains a release gate.
See [review order and acceptance status](RESOURCE_ACCEPTANCE.md)
for the exact covered, partial and pending gates; this is still a draft workflow.

## Portable values

`Vir.Resources` imports types and pure validation, not a runtime carrier. A
`Bundle` contains a descriptor, content identity and every payload as bytes.
Lookup operations (`file?`, `entryPath?`, `exportName?`) perform no I/O.

`Bundle.validate` checks the schema, portable paths, exact inventory, required
roles, byte lengths, SHA-256 and descriptor identity. It does not execute JavaScript
or inspect Lean package declarations. The program producer and browser
loader also verify the complete package-set closure and actual exports;
passing structural bundle validation alone is not executable-program acceptance.

`ResourceSet.validate` requires exact compiler/ABI/JS/IR compatibility and rejects
conflicting contents under one logical identity. `ResourceSet.bundles` validates
first and returns one copy of each repeated identical logical/content identity.
Program compatibility does not include a runtime content hash, so compatible
runtime JavaScript repackaging need not change program bytes.

All resource hashing is pure Lean, without Node, subprocesses or FFI. The SHA-256
implementation follows [FIPS 180-4](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf)
and is tested against an independent host implementation. This is integrity
checking, not publisher authentication or a claim of cryptographic certification.

## Identity and internal pack

`encodeDescriptor` emits canonical UTF-8 JSON. All schema fields are present;
object keys are sorted, files are sorted by path, and entries/exports by role.
Controls use lowercase `\u00xx`; other Unicode scalars are preserved. Identity is
SHA-256 of `"vir-resource-bundle-v1\n"` followed by those bytes.

The internal v1 pack is deliberately not a public client file format:

1. Eight bytes: `56 49 52 52 45 53 00 01` (hex).
2. A four-byte little-endian descriptor length.
3. Canonical descriptor bytes.
4. Payload bytes in descriptor path order, using lengths from that descriptor.

There is no second inventory, extraction utility, or link entry. Decode rejects
truncation, trailing bytes, duplicate/unknown JSON fields, noncanonical encodings,
unsafe paths and integrity mismatches before returning a bundle. Limits are 4096
files or roles, 4096 UTF-8 bytes per metadata string/path, 4 MiB descriptor bytes,
512 MiB total payload and JSON nesting depth 16. Numeric digit runs are bounded
and exponent notation is rejected before JSON parsing, preventing the parser
from expanding a short exponent token into an enormous integer. Quoted metadata
is unaffected. Version fields are positive
JavaScript-safe integers. Runtime packages must still contain their full JS/data/
notice closure; these bounds do not permit missing dependencies.

## Embedding

The inclusion elaborator only reads an already-prepared, validated pack:

```lean
module
public import Vir.Resources.Types
meta import Vir.Resources.Embed

public def bundle : Vir.Resources.Bundle :=
  include_vir_bundle "prepared.virres"
```

The path is relative to this source file. This example describes the low-level
operation, **not** a manual preparation requirement for application
users. Library prerequisites own preparation, staging and dependency traces.
The elaborator does not download, spawn processes or run another Lake build.

Generated terms contain typed descriptor constructors and binary literals, not
paths to reopen. Binary bytes use a checked Z85 string transport so the generated
term does not contain one expression node per byte. The technique is adapted
from Apache-2.0 `VersoUtil.BinFiles`; VIR has no Verso dependency. The pure decoder
is exposed through `Types` so a meta-only `Embed` import still produces legal
runtime code under Lean's module phase rules.

The focused test uses a separate downstream package and custom build directory,
then removes its pack and runs the native executable from another working
directory. `lake env lean --run Main.lean` also works with the compiled carrier
and pack absent. Re-elaborating the carrier itself still requires preparation;
raw invocations that skip its library prerequisites are not promised.

## Native acquisition and staging

`vir_resource_pack` is a build tool below the carrier libraries, not a command
application authors should run. Its internal operations are:

```text
vir_resource_pack acquire CONTENT_ID SOURCE CACHE STAGE [--offline]
vir_resource_pack pack DESCRIPTOR ROOT OUT
```

The producer supplies a pinned bundle identity. `SOURCE` is a local complete pack,
an anonymous HTTPS URL, or `-` for already-available bytes only. Cache and staging
are checked against that identity and the native tool's exact Lean build identity;
a transport override cannot change either. The content identity also binds all
ABI compatibility fields. Source-distributed packs need no external host tool;
HTTPS uses `curl`, with user curl configuration disabled, HTTPS-only redirects,
size/time limits, and no GitHub authentication or source-build fallback.

Valid cache or staging bytes suffice offline. Missing staging is repaired even
when compilation is otherwise warm. Corrupt candidates are replaced only from
verified bytes; a cold offline miss identifies the required bundle. There is no
fallback revision, filename-based trust or successful return after a failed
download. Reads are bounded independently of a prior filesystem size check.

Installation writes to a fresh sibling directory, then renames the complete
file. It never truncates a cached/hardlinked destination and leaves valid warm
files untouched. Link ancestors and nonregular destination leaves are rejected.
Concurrent same-identity producers can safely install equivalent complete files.
An interrupted process can leave an unreferenced `.vir-resource-*` temporary
directory; retries never treat it as a cache candidate. These temporary directories
are producer-private generated state, not resources to publish. This is atomic
visibility, not crash-durable storage or protection against a hostile process
replacing ancestor directories during an operation.

The downstream regression fetches the native executable through Lake, prepares
the staged pack in a library `needs` job, and imports that carrier from a leaf
whose only dependency is the intermediary. The prerequisite checks staging on
every build and preserves content traces. Its checked-in-equivalent synthetic
pack proves ordering/repair, not anonymous distribution or executable runtime
completeness. The public carrier and client facet use the same installation rules.

The `pack` operation reads a canonical descriptor and the declared payloads below
`ROOT`. Paths, size budgets, actual lengths/hashes and exact compiler identity are
checked before installation. Inputs must be regular files without symlink
ancestors. This operation uses the same atomic installation as acquisition, so
valid warm outputs retain their inode/mtime and corrupt hardlinked outputs are
replaced without modifying their other names. It does not establish provenance
of a supplied Wasm binary: release producers remain responsible for building and
recording the exact compiler/runtime pair.

## Client libraries and automatic preparation

For the short authoring path, start with the
[client-library guide](../guides/EMBEDDED_RESOURCES.md).

`import Vir.Resources.Runtime` exposes `Vir.Resources.Runtime.bundle`. Its
optional `VirResourceRuntime` library fetches and validates the selected runtime
before elaboration. Core types, the native producer and browser program modules
must not import that carrier.

The runtime selection is `vir-resources/runtime.json` in VIR. It selects one
content ID and acquisition source; `vir-resources/compatibility.json` independently
defines the exact compiler/ABI/JS/IR profile shared by program production. The
current lock deliberately uses `source: "-"`: a maintainer must seed the verified
pack cache until a durable distribution is published. Missing bytes produce an
acquisition error, never an implicit Wasm build. This is not yet the anonymous
cold-checkout release experience.

A client library registers an independent program module and a carrier library.
For example (see `fixtures/resources/client` for the complete three-package test):

```lean
lean_lib ClientProgram where
  srcDir := "program"
  roots := #[]
  globs := #[.one `Client.Program]

lean_lib ClientResources where
  srcDir := "resources"
  roots := #[]
  globs := #[.one `Client.Resources]
  needs := #[`@client_fixture/ClientResources:virResourcePack]
```

The owning package supplies `vir-resources/ClientResources.json`:

```json
{
  "schemaVersion": 1,
  "logicalId": "client-fixture/greeting",
  "module": "Client.Program",
  "exports": [{
    "role": "greet",
    "declaration": "Client.Program.greet",
    "interfaceId": "vir-fixture-greet-v1"
  }],
  "supportFiles": []
}
```

The program uses `module`, `meta import Vir.Attributes`, and public declarations
marked `@[vir_export]`. Each requested export must exist in the generated root
package. V1 accepts one registered composition root; import contributions there
and expose the intended public wrappers. The recipe has one `module` field;
the obsolete experimental `modules` array is rejected, even with one element.
Export roles must be unique; distinct roles may name the same declaration.
Optional support entries contain `source`, `path`, and `mediaType`: sources are
portable paths relative to the owning package, destinations relative to the
bundle, and neither may traverse links or escape their root.

The facet stages `.vir-generated/ClientResources.virres` in the owning package.
`resources/Client/Resources.lean` embeds it with
`include_vir_bundle "../../.vir-generated/ClientResources.virres"`. The path is
source-relative, not relative to the caller or build directory. An umbrella
client module constructs a `ResourceSet` from that bundle and `Runtime.bundle`.
The leaf depends only on the client and runs its normal native generator.

Keep carrier and program ownership disjoint: broad overlapping library globs
can change which library Lake assigns a module to. Before fetching compilation,
the facet checks the source import graph and rejects a program that belongs to,
or imports, its own carrier library. It fetches Lake's returned native executable
and full compiled artifact groups, including private implementation traces.
Setup maps remain producer-local. No Node, nested Lake or npm is used in this
application preparation path. Every build validates/repairs staging from the
actual returned artifact, including cache hits, while retaining semantic traces.
Before Lake touches the program output, setup, trace or hash file, the facet
rejects symlink ancestors and nonregular leaves. Native checks alone would be too
late: Lake can remove outputs or write trace/hash files before invoking the tool.
These checks assume trusted single-writer directories, not hostile concurrent
replacement. Setup replacement also preserves existing hardlink aliases.

Runtime planning and staging use the lightweight `vir_resource_pack` tool.
They share bounded native file/JSON operations with program production, but do
not depend on the generator or acquire program inputs. Neither runtime selection
nor compatible JavaScript-only runtime changes are program recipe inputs.

Native rendering consumes compiled bytes only; moving the executable or removing
raw program packs does not turn rendering into acquisition. The complete test
uses a custom build directory with spaces and retains failure evidence.

Runtime production is a separate maintainer operation:

```sh
node scripts/resources/pack-runtime.mjs RELEASE_WASM BUILD_IDENTITY NEW_OUTPUT_DIR
```

It bundles the JS import closure, Wasm and notices, verifies the compiler/profile
metadata and emits a native-validated pack plus provenance. Qualification of the
supplied Wasm remains the maintainer's responsibility. This command is never
called by an application's build or renderer.

## Browser facade

The runtime distribution's `runtimeModule` role exports `createProgram`:

```js
const { createProgram } = await import(runtimeModuleUrl.href);
const program = await createProgram({ runtimeManifestUrl, programManifestUrl });
try {
  const result = program.call("prettyM", requestJson);
} finally {
  program.dispose();
}
```

All three URLs come from the host's published bundle plan, not from build paths.
The two manifest arguments must be explicit same-origin HTTP(S) `URL` objects,
without credentials, query strings or fragments. The envelope is
`{contentId, descriptor}`. The loader bounds requests/JSON, rejects duplicate
keys and redirects, validates canonical identity and every declared payload,
checks exact compatibility, then delegates complete package-set validation and
loading to the existing interpreter. The set can only read members present in
the verified outer inventory. Export roles are resolved against actual package
root exports and bound to exact installed entries, not `id`/`jsName` aliases.
Dependency-only exports do not become callable roles. No PrettyM protocol or
Slides policy is built into this API.

Each `createProgram` creates an independent runtime instance. `dispose` is
idempotent; later calls fail. No startup markers are invoked. The existing call
API's value representation is preserved (for example, Nat results are decimal
strings); this facade does not introduce a second marshaller. `interfaceId` is
client-owned protocol metadata, not a runtime proof of a function's semantics.

The publisher's ESM bootstrap is trusted: importing JavaScript executes it before
its loader can verify a manifest. These checks prevent unverified Lean execution,
not malicious replacement of the whole website. The selected runtime module
must identify the executing module URL. Wasm bytes are handed to existing runtime
APIs; Infoview RPC asset revisions/path caches are not involved.

The browser regression bundles the complete JS import closure into one ESM file
(esbuild reports no remaining external imports), includes the exact local Wasm
and VIR/Lean notices, creates real native-validated runtime/program packs, and
serves the same files at root and nested URLs. A marked Lean wrapper delegates to
the existing real Format fixture; expected result is 6093. This exercises a real
multi-member set and interpreter, not the separate Slides corpus or default
runtime acquisition. Diagnostic identities and full packs are retained locally.

## Validation and remaining work

```sh
npm run test:resources:core
npm run test:resources:embedding
npm run test:resources:acquisition
npm run test:resources:packing
npm run test:resources:program
npm run test:resources:cache
npm run test:resources:descriptor
# Local maintainer qualification of the three-package build:
npm run test:resources:client -- EXACT_RUNTIME_PACK
# Requires a matching locally built Wasm and its build identity; no implicit build:
npm run test:resources:browser
```

Core tests include Unicode/empty-export canonical identity, reorder invariance,
byte mutation, unsafe/case-colliding/prefix paths, role errors, compatibility and
logical-identity conflicts, every truncation of a small pack, unknown/duplicate
fields, and native/interpreted checks. SHA-256 is compared with 138 independent
binary vectors, including padding boundaries and a million-byte input. Binary
literal tests cover all byte values, padding, invalid characters and overflow.
The embedding fixture uses synthetic integrity payloads; it does not claim a
browser runtime session. Failed fixture inputs/logs are retained under `build/`.
Acquisition checks cover warm no-op, missing/corrupt candidates, read-only
hardlink preservation, symlink rejection, bounded reads, mismatched content and
compiler, eight concurrent producers, interrupted/failed transport and retry,
and a downstream library prerequisite with a custom build directory. Transport
fault injection uses a test-only curl stub; it is not anonymous HTTPS acceptance.
The compiled leaf still runs from another directory after raw inputs disappear.

The selected baseline is main's Lean `v4.34.0`, exact
`293d5d0c0c3f3dded4688b3ccd6a33939ac5102b`. The resource API does not require the
separate Lean 4.35 support change. Runtime packs are nevertheless compiler-specific:
select a matching pack rather than copying Wasm or a lock from another toolchain.
Source builds and native-to-Wasm reference/format/parser checks do not substitute
for the complete PrettyM/resource acceptance. The browser
facade additionally tests role calls, independent instances, disposal/remount,
root/nested hosting, corrupt payload/identity, MIME, duplicate JSON keys, depth,
missing exports, undeclared members, incompatibility and rejected redirects.
Negative cases assert that no Wasm instance was created.

Next gates are runtime distribution and the remaining cases enumerated in the
acceptance status. The historical downstream PrettyM demo remains qualified on
its frozen Lean 4.35.0-rc3 pair; changing this PR's base does not repin it. The client
build regression covers cold
and warm ordinary builds, program edits without runtime replacement, missing and
corrupt staging repair, carrier-cycle rejection, and native execution with the
raw program pack removed. The producer tests cover deterministic complete packs,
required exports, strict recipes/locks, profile mismatches, and atomic replacement
of larger hardlinked outputs without altering their other names.
Anonymous cold acquisition needs a durable prebuilt distribution; a local archive
is not evidence for that requirement. The full T01–T30 campaign and resource
size/compile-memory/browser measurements remain outstanding. The actual Slides
pixel-measured formatter is untouched; the accepted local canary uses columns only.
