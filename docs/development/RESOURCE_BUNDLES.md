# Resource bundles: implementation checkpoint

The new client contract is compiled resource data: an intermediary library owns
its browser program and resources, and its users keep an ordinary dependency
and executable command. The application does not discover VIR build paths or
invoke a resource preparation command.

**The Lean-name successor removes the resource export table and handwritten
recipe.** Root generated interfaces provide exact fully qualified call names;
ordinary package-local Lake registration selects the owner and module. Descriptor
schema 2/resource compatibility 3 require a new matching runtime pack. The prior
832/version1 public distribution and Slides checks remain historical evidence,
not qualification of this successor. See [acceptance status](RESOURCE_ACCEPTANCE.md).

## Portable values

The [review assumptions](REVIEW_ASSUMPTIONS.md) define the supported cooperative
input model. Validation diagnoses ordinary build/compatibility and byte-integrity
failures; it is not hostile-program admission or a Lean soundness certificate.

`Vir.Resources` imports types and pure validation, not a runtime carrier. A
`Bundle` contains a descriptor, content identity and every payload as bytes.
Lookup operations (`file?`, `entryPath?`) perform no I/O.

`Bundle.validate` checks the schema, portable paths, exact inventory, required
roles, byte lengths, SHA-256 and descriptor identity. It does not execute JavaScript
or inspect Lean package declarations. Compiled-program adaptation additionally
checks member inventory, ownership and interface/compiler metadata; browser and
runtime loading have their own ABI and executable-IR admission checks. Passing
structural bundle validation alone is not executable-program acceptance.

Portable inventories retain their exact spelling. Besides case-folded duplicate
filenames and file/directory collisions, shared directory prefixes must have one
consistent spelling: `Assets/a.js` plus `assets/b.js` is rejected with
`DIRECTORY_CASE_CONFLICT`, as is `Root/Icons/a.svg` plus `Root/icons/b.svg`.
Using `Assets/` consistently is valid; unrelated directories need not share
capitalization. This is lexical portability admission, not filesystem case
normalization or a claim that every filesystem has been tested.

`ResourceSet.validate` requires equal Lean revision and VIR compatibility version and rejects
conflicting contents under one logical identity. `ResourceSet.bundles` validates
first and returns one copy of each repeated identical logical/content identity.
Program compatibility does not include a runtime content hash, so compatible
runtime JavaScript repackaging need not change program bytes.

### Compatibility versus content identity

The public resource compatibility record has exactly two fields:

```json
{"leanRevision":"293d5d0c0c3f3dded4688b3ccd6a33939ac5102b","virVersion":3}
```

`leanRevision` is `Lean.githash` (also `lean --githash`): the compiler's reported
Lean source commit. It is not a hash of the compiler executable, build flags or
installed libraries. Qualification of the actual runtime bytes remains necessary.

`virVersion` is one combined contract for the client-facing JavaScript API,
runtime ABI and accepted program formats. It is independent of the runtime ABI
number. Version 3 currently covers descriptor schema 2, ABI 4, interface manifest 9, IR binary format
11 and the `createProgram` / `call` / `status` / `dispose` resource API. Internal
format versions remain in their headers and validators; applications do not
select them independently. Advance `virVersion` when any constituent contract
breaks; compatible fixes/repackaging retain it. Both native and JS constants are
checked together by `check:package-abi`.

Version 3 retains version 2's bigint results for Nat, Int and UInt64 and Number for wasm32 USize.
Version 1's decimal-string results are not accepted as the current contract.
See the [numeric value mapping](../guides/JS_API.md#calls-and-manifest).

The pair says whether program and runtime bundles are compatible. The separate
content ID selects exact descriptor and payload bytes. Two runtime bundles can
share the pair but have different content IDs, without requiring program rebuilds.
This draft replaces the earlier four-field record; old or mixed records reject
and must be regenerated. There are no legacy field aliases. Descriptor schema
is 2; pack framing stays v1, with no parallel descriptor reader.

Native package and resource hashing share `Vir.Hash`, without Node, subprocesses
or FFI. The SHA-256
implementation follows [FIPS 180-4](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf)
and is tested against an independent host implementation. This is integrity
checking, not publisher authentication or a claim of cryptographic certification.

## Identity and internal pack

`encodeDescriptor` emits canonical UTF-8 JSON. All schema fields are present;
object keys are sorted, files are sorted by path, and file entries by role.
Controls use lowercase `\u00xx`; other Unicode scalars are preserved. Identity is
SHA-256 of `"vir-resource-bundle-v2\n"` followed by those bytes.

The internal v1 pack is deliberately not a public client file format:

1. Eight bytes: `56 49 52 52 45 53 00 01` (hex).
2. A four-byte little-endian descriptor length.
3. Canonical descriptor bytes.
4. Payload bytes in descriptor path order, using lengths from that descriptor.

There is no second inventory, extraction utility, or link entry. Decode rejects
truncation, trailing bytes, duplicate/unknown JSON fields, noncanonical encodings,
unsafe paths and integrity mismatches before returning a bundle. Limits are 4096
files or roles, 4096 UTF-8 bytes per metadata string/path, 4 MiB descriptor bytes,
512 MiB total payload. Lean's ordinary JSON parser owns syntax; the native decoder
does not maintain a second nesting/numeric-exhaustion scanner. Deliberately
constructed parser-exhaustion input is outside the supported artifact model.
Canonical round-trip admission still rejects alternative number spellings in
persisted descriptors. Version fields are positive
JavaScript-safe integers. Runtime packages must still contain their full JS/data/
notice closure; these bounds do not permit missing dependencies.
The root envelope namespace `bundle.json` is reserved case-insensitively, both
as a payload filename and as a directory prefix. Nested payload names such as
`assets/bundle.json` do not conflict with the root envelope.

### Compiled-program checking is not execution admission

`Vir.Resources.Program.Checked` is an internal build-adapter result for one
canonical marked program, not a certificate about arbitrary executable code.
Its constructor is private. `Program.read` admits a persisted artifact through
regular-file reading and `Pack.decode`, then checks its program inventory and
metadata without hashing payloads twice. The adapter binds inner lengths/hashes
to the admitted outer inventory, and the loose adapter reuses those digests.

Trusted generation returns typed member metadata directly from emission. Its
adapter neither reparses its own package set nor reopens interface sections to
reconstruct that result. There is no arbitrary in-memory `Program.check` entry
point: persisted admission and trusted construction are distinct operations.
The shared package-set serializer preserves field order and member bytes.

| Boundary | What it establishes | What it does not establish |
| --- | --- | --- |
| `Bundle.validate` / `Pack.decode` | Portable schema/inventory, lengths, payload hashes and descriptor identity; decoding also checks canonical transport framing | Lean IR validity, callable ABI or behavior |
| `Program.read` | The above integrity plus canonical ordered member inventory, selected root, per-member hashes/ownership, checksummed interface JSON and pinned compiler/interface versions | Full interface type grammar, complete executable-section decoding or execution admission |
| Browser `readIrPackageInfo` / `validateIrPackageSetMembers` | Required unique non-overlapping sections, actual interface ABI grammar and package-set member/identity consistency | Decoding or proving the behavior of executable IR bodies |
| Resource `createProgram` and the Wasm package loader | Verified resource admission, requested root export/signature binding, actual IR decoding and runtime installation checks | Kernel checking of arbitrary generated IR or a proof of formatter semantics |

The native resource adapter intentionally extracts metadata using the existing
`Vir.GeneratePackage.PackageFormat` constants. The browser interface validator
and Wasm IR decoder remain authorities for their respective representations; do
not mistake the adapter's interface-section reader for another full IR parser or
import the compiler/interpreter into lightweight acquisition tools to make it one.
The persisted-read regression and native packing campaign exercise these
boundaries, including inventory/hash, ownership, inner framing and
compiler/interface rejection before replacing output. Historical forged-Bundle
tests described an earlier API; they did not establish a supported adversarial
input contract or a kernel-soundness defect.

## Embedding

The inclusion elaborator only reads an already-prepared, validated pack:

```lean
module
public import Vir.Resources.Embed

public def bundle : Vir.Resources.Bundle :=
  include_vir_bundle "prepared.virres"
```

The path is relative to this source file. This example describes the low-level
operation, **not** a manual preparation requirement for application
users. Library prerequisites own preparation, staging and dependency traces.
The elaborator does not download, spawn processes or run another Lake build.
Its input must resolve to a regular file; read-only aliases are permitted. The pack limit is
enforced during the read, not only by an earlier file-size observation.

Generated terms contain typed descriptor constructors and binary literals, not
paths to reopen. Binary bytes use a checked Z85 string transport so the generated
term does not contain one expression node per byte. The technique is adapted
from Apache-2.0 `VersoUtil.BinFiles`; VIR has no Verso dependency. One internal
`Vir.BinaryLiteral` primitive owns that checked transport; its separate meta-only
`ToExpr` helper constructs literals without reading files or knowing resource formats.
The inclusion wrapper owns bounded file reading and canonical pack validation.

User-authored locks and compatibility files instead use ordinary Lean
JSON parsing followed by typed field/schema checks. They do not need canonical
number or whitespace spelling. Duplicate-key behavior is the parser's behavior,
not a separate VIR admission promise for manually ambiguous configurations.
This is adapted infrastructure, not yet a cross-project shared utility package.

Carriers use the single ordinary `public import Vir.Resources.Embed` above. It
exports resource types and the pure decoder; parser, file admission and expression
construction dependencies remain meta-only. Lean's phase rules require that ordinary
import route for the generated decoder call. Replace the older `Types` plus
meta-only `Embed` import pair when updating a carrier; `Types` no longer imports
binary-literal transport. No syntax, descriptor, pack or browser API changes are
needed. Embedding the raw pack for runtime parsing is deliberately not an alternative:
validation happens before typed constructors are embedded.

The focused test uses a separate downstream package and custom build directory,
then removes its pack and runs the native executable from another working
directory. `lake env lean --run Main.lean` also works with the compiled carrier
and pack absent. Re-elaborating the carrier itself still requires preparation;
raw invocations that skip its library prerequisites are not promised. The test also
checks the data-only import boundary and the carrier's ordinary versus meta-only
dependencies, and rejects a corrupt payload before embedding it.

## Native acquisition and staging

`vir_resource_pack` is a build tool below the carrier libraries, not a command
application authors should run. Its internal operations are:

```text
vir_resource_pack acquire COMPAT CONTENT_ID SOURCE CACHE STAGE [--offline]
vir_resource_pack pack DESCRIPTOR ROOT OUT
```

`pack` materializes the descriptor: it checks member integrity and the native
tool's reported Lean revision, but does not qualify the described runtime or enforce
the full supported ABI profile. Runtime production uses `pack-runtime.mjs`;
`acquire` and staging enforce the selected supported compatibility profile.
A structurally valid pack is not, by itself, executable-runtime qualification.

The producer supplies a pinned bundle identity. `SOURCE` is a local complete pack,
an anonymous HTTPS URL, or `-` for already-available bytes only. Cache and staging
are checked against that identity and the complete compatibility profile before installation;
a transport override cannot change either. The content identity also binds all
compatibility fields. Source-distributed packs need no external host tool;
HTTPS uses the pinned `Lake.download` operation and its normal host `curl`
configuration; VIR does not implement separate redirect/timeout settings or
supply authentication headers. This is public acquisition, not credential
isolation from host configuration. Pack reads are bounded after download and
before installation; Lake does not impose VIR's pack-size limit on transport.
There is no source-build fallback. URL
userinfo is rejected by both runtime-lock admission and transport, even when
verified cache bytes are already available.

Valid cache or staging bytes suffice offline. Missing staging is repaired even
when compilation is otherwise warm. Corrupt candidates are replaced only from
verified bytes; a cold offline miss identifies the required bundle. There is no
fallback revision, filename-based trust or successful return after a failed
download. Reads are bounded independently of a prior filesystem size check.

For public distribution, a release owner must publish the exact verified
`CONTENT_ID.virres` as an immutable, anonymously downloadable asset. Prepare a
draft, upload without overwriting an existing asset, verify the uploaded bytes,
then publish. Only after that verification should the owning runtime lock replace
`source: "-"` with the actual durable HTTPS URL; keep its content ID unchanged.
Qualify acquisition into fresh cache/staging directories with no supplied pack,
then warm offline reuse and an actionable cold offline miss. The owning-library
workflow remains the application entry point. This is a separate release gate:
synthetic transport tests, authenticated CI artifacts and locally supplied packs
do not establish anonymous installation. Neither publication nor an acquisition
miss should build Wasm or select a different revision implicitly.

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
checked before installation. Inputs must resolve to regular files; read-only
directory/file aliases are permitted. Managed outputs still reject symlink aliases.
This operation uses the same atomic installation as acquisition, so
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
defines the Lean revision / VIR version pair shared by program production. The
version-2 baseline has a matching published runtime. This successor selects the
qualified [version-3 e415 bundle](https://github.com/ejgallego/lean-vir/releases/tag/resource-e415e41a43eccf298b710056efccf6c3d436d5fceb4e130fb06cb09d12d027dd)
from its content-named public release, without credentials or supplied bytes. A runtime
must match the selected profile; the published version-2 bundle is not a fallback.
Earlier releases and their frozen consumers remain unchanged.

This pack includes the landed managed-runtime split and the JavaScript response
MIME correction. Its Wasm bytes are unchanged; the earlier d72 pack does not
contain that correction.

After selecting a matching public, content-addressed runtime, missing local bytes
are acquired anonymously over HTTPS and verified before installation. A warm
verified cache or stage needs no runtime download. Missing offline bytes produce
an acquisition error naming the required identity, never an implicit Wasm build.
The native tool's `--offline` flag makes that acquisition boundary explicit.

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

The owning package declares a stock typed target, importing only Lake:

```lean
target virPrograms (_pkg) : Array (Lean.Name × Lean.Name) := do
  return Job.pure #[(`ClientResources, `Client.Program)]
```

One registered root per owning library; no handwritten recipe, alias, logical ID,
interface ID or export list. Logical identity is the selected module's name.
The canonical root `vir_export ∪ vir_startup` inventory supplies callable names;
imported markers do not become root entrypoints. Startup hooks are callable but
not automatically executed.

The facet stages `.vir-generated/ClientResources.virres` under the owning
library's `srcDir` (here `resources`). `resources/Client/Resources.lean` embeds it
with `include_vir_library ClientResources`, using the literal registered library
name. The include strips the complete canonical module suffix from the actual
source filename to derive that same source root; mismatches reject without an
ancestor search, working-directory guess or alternate-path fallback.
The library's ordinary prerequisite owns preparation and tracing. Explicit
source-relative `include_vir_bundle` remains a low-level prepared-input tool,
not another application setup workflow. An umbrella
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
The internal `virProgram` facet is shared with `:vir`: one cached result owns full
artifact acquisition, implementation/location traces, analysis and emission.
`Vir.Resources.Program` verifies its canonical package-set inventory and reads
the actual root interface manifest. The resource adapter retains that generated interface, strips the private report
and packages member bytes unchanged. Explicit registration-value traces preserve
invalidation even for pure Lake targets; both adapters reuse generation.
Carrier-cycle checks still run before requesting the shared program job.
Resource facets and direct program-tool calls reject `VIR_NATIVE_EXTERN_MANIFEST`
(including an empty value) before using cached outputs: custom providers are not
part of the locked resource-runtime contract. The lower-level `:vir` workflow
continues to support its explicitly traced native profile.
Before Lake touches the program output, setup, trace or hash file, the facet
rejects symlink ancestors and nonregular leaves. Native checks alone would be too
late: Lake can remove outputs or write trace/hash files before invoking the tool.
These checks assume trusted single-writer directories, not hostile concurrent
replacement. Setup replacement also preserves existing hardlink aliases.

Runtime planning and staging use the lightweight `vir_resource_pack` tool.
`Vir.NativePayload` provides bounded reads, digest checks and verified publication
for both this path and the SDK installer. Domain validators and source selection
remain separate: an SDK release/commit is not a resource content ID, and SDK
authentication does not enter locked resource acquisition. These tools do not
depend on the generator or acquire program inputs. Neither runtime selection
nor compatible JavaScript-only runtime changes are program compilation inputs.

Native rendering consumes compiled bytes only; moving the executable or removing
raw program packs does not turn rendering into acquisition. The complete test
uses a custom build directory with spaces and retains failure evidence.

Runtime production is a separate maintainer operation:

```sh
node scripts/resources/pack-runtime.mjs RELEASE_WASM BUILD_IDENTITY NEW_OUTPUT_DIR
```

`npm run package:runtime` uses the repository's release Wasm and build identity
to write `build/artifacts/runtime/`. CI packages and retains this output after
the runtime checks. The tagged release workflow publishes its content-named
pack without overwriting it; maintainers select a verified public asset in
`vir-resources/runtime.json` separately. Actions artifacts alone are not a
durable consumer source, and a new producer commit does not silently change
the runtime selected by applications.

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
  const result = program.call("My.Program.pretty", requestJson);
} finally {
  program.dispose();
}
```

All three URLs come from the host's published bundle plan, not from build paths.
For declared `text/javascript` files, responses may use `text/javascript` or
`application/javascript` (with optional parameters). Other declared media types,
including `application/wasm`, still require their matching response type. Payload
length and hash checks are unchanged.
The two manifest arguments must be explicit same-origin HTTP(S) `URL` objects,
without credentials, query strings or fragments. The page must provide WebCrypto
SHA-256 in a secure context: use HTTPS for deployment, or trusted localhost/loopback
HTTP for development. Remote plain HTTP is not supported. The loader checks this
capability before making any requests; a secure context also depends on the
embedding page, not only the manifest URL's scheme. The envelope is
`{contentId, descriptor}`. The loader bounds requests/JSON, rejects duplicate
keys and redirects, validates canonical identity and every declared payload,
checks exact compatibility, then delegates complete package-set validation and
loading to the existing interpreter. The set can only read members present in
the verified outer inventory. Full Lean names are resolved against actual package
root exports and bound to exact installed entries, not `id`/`jsName` aliases.
Dependency-only exports do not become call entrypoints. No PrettyM protocol or
Slides policy is built into this API.

Two optional creation fields are supported, with no compatibility aliases:

```ts
expectedExports?: Readonly<Record<string, {
  args: readonly InterfaceType[];
  result: InterfaceType;
  effect: InterfaceEffect;
}>>;
signal?: AbortSignal;
```

`InterfaceType` and `InterfaceEffect` mean the existing manifest representations,
not a new wire format. Complete expectations are validated and privately copied
before asynchronous work. Each key must name an actual root declaration. Additional root exports are
allowed. The ordered argument types,
result and effect must match the validated actual root callable before runtime
instantiation/Lean initialization. Constructor/field order, recursive references
and representation/layout facts matter; JSON key order, argument display names
and diagnostic extensions do not. Exact declaration binding never uses aliases.

Exact-name and ABI comparison requires verified package bytes. Every mismatch rejects in `program-validation`
with zero runtime creations. The consumer owns a separately reviewed reference,
not one inferred from the just-loaded program. This establishes interface/artifact
agreement, not proof of executable behavior. Omission preserves two-URL callers.

Each `createProgram` creates an independent runtime instance. No startup markers
are invoked. Calls return the runtime's
[documented JavaScript values](../guides/JS_API.md#calls-and-manifest) directly;
this facade does not introduce a second marshaller or semantic-ID layer.

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

### Browser lifecycle

`program.status` is read-only: `"active"`, `"failed"`, or `"disposed"`.
Ordinary Lean IO errors and unknown declaration names do not retire the program. An escaping
Wasm failure does: later calls reject. **Failed is not disposed**: dispose the
failed instance before explicitly creating a replacement, and never automatically
replay its last effectful call. Other program instances remain independent.

`dispose()` is idempotent, detaches the facade's runtime references even if cleanup
throws, and leaves status `"disposed"`. Later calls reject and repeated disposal
does not repeat cleanup. Report cleanup errors, but do not keep the old instance
as the current program or attempt to revive it. Collection may occur later.

An optional caller-owned `signal` owns **pending creation only**. Preabort starts
no I/O or allocation. Pending abort cancels this attempt's fetches and prevents
successful handoff; a non-preemptible creation must settle, then its late instance
is disposed at most once. The final abort check and listener removal have no
intervening await. Timers/listeners detach on every exit. Attempts remain
independent; abort after handoff neither disposes the program nor interrupts calls.

Creation errors have a bounded `phase`, safe `context` and original `cause`:
`runtime-manifest`, `program-manifest`, `resource-fetch`, `integrity`,
`compatibility`, `program-validation` or `runtime-creation`. Primary messages
do not stringify arbitrary causes, raw payloads or URLs. Caller cancellation is
named `AbortError`, with the original signal reason as cause (no `DOMException`
instance promise). Acquisition timeout is named `TimeoutError`; it is not caller
cancellation or a formatting budget. Primary classification is fixed before
cleanup and cannot be overwritten by a later abort.

If owned-instance cleanup also fails, an own read-only `cleanupError` retains
the untouched thrown value, even `undefined`/`null`. Inspect property presence,
and report this secondary failure even when suppressing stale cancellation.
Ownership detaches before cleanup; it is not retried. Explicit resolved disposal
continues to propagate ordinary cleanup errors. Creation error wrapping does not
change calls, recoverable IO, fatal state or quarantine.

The host still owns mount ordering: both a new mount and unmount invalidate
older pending results. Stale successful instances must be disposed; stale failures
must not replace the current view. See the
[tested single-component example](../guides/RESOURCE_LIFETIME.md#overlapping-loads).

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
hardlink preservation, managed-output symlink rejection, read-only input aliases,
bounded reads, mismatched content and
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
facade additionally tests exact-name calls, independent instances, disposal/remount,
root/nested hosting, corrupt payload/identity, MIME, duplicate JSON keys, depth,
missing exports, undeclared members, incompatibility and rejected redirects.
Negative cases assert that no Wasm instance was created.

Remaining gates are the final downstream product qualification and the partial
cases enumerated in the acceptance status. The historical PrettyM demo remains qualified on
its frozen Lean 4.35.0-rc3 pair; changing this PR's base does not repin it. The client
build regression covers cold
and warm ordinary builds, program edits without runtime replacement, missing and
corrupt staging repair, carrier-cycle rejection, and native execution with the
raw program pack removed. The producer tests cover deterministic complete packs,
generated exports, strict locks, profile mismatches, and atomic replacement
of larger hardlinked outputs without altering their other names.
The historical version1 distribution is a public GitHub release asset; the
version3 successor's new loader pack still needs publication. a
supplied local archive alone is still not anonymous acquisition evidence. The
complete product campaign and resource size/compile-memory/browser measurements
remain outstanding. The historical 4.35
column canary remains separate from the supplied-pack 4.34 strict creation and
Except-v2 consumer qualification recorded in the acceptance status. Slides owns
formatter policy, measurement and presentation. Its reviewed 4.34 successor
retires the production JavaScript formatter; final product qualification remains
downstream, with no supported formatter fallback.
