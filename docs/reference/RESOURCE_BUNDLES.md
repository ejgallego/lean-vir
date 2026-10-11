# Resource bundles

This reference explains the values and build boundaries behind the
[application workflow](../guides/EMBEDDED_RESOURCES.md). An asset library includes
compiled program data and a precompiled runtime; the application publishes their
files through its own writer. It does not discover producer paths or invoke a
resource preparation command manually.

## Portable values

The [review assumptions](../development/REVIEW_ASSUMPTIONS.md) define the supported
cooperative input model. Validation diagnoses ordinary build/compatibility and byte-integrity
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
`leanRevision` and `virVersion`. Their selected values are recorded in
[`vir-resources/compatibility.json`](../../vir-resources/compatibility.json).

`leanRevision` is `Lean.githash` (also `lean --githash`): the compiler's reported
Lean source commit. It is not a hash of the compiler executable, build flags or
installed libraries. It does not identify the runtime payload bytes.

`virVersion` is one combined contract for the client-facing JavaScript API,
runtime ABI and accepted program formats. It is independent of the runtime ABI
number. It covers the accepted descriptor/program formats and the
`createProgram` / `call` / `status` / `dispose` resource API. Program format
versions are defined in [`Vir.Package.Format`](../../Vir/Package/Format.lean)
and remain in their headers and validators; applications do not
select them independently. Advance `virVersion` when any constituent contract
breaks; compatible fixes/repackaging retain it. Both native and JS constants are
checked together by `check:package-abi`.

Nat, Int and UInt64 results use bigint; wasm32 USize results use Number.
See the [numeric value mapping](../guides/JS_API.md#calls-and-manifest).

The pair says whether program and runtime bundles are compatible. The separate
content ID selects exact descriptor and payload bytes. Two runtime bundles can
share the pair but have different content IDs, without requiring program rebuilds.
There are no compatibility-field aliases. Descriptor schema is 2; pack framing
is v1, with one descriptor reader.

Native package and resource hashing share `Vir.Hash`, without Node, subprocesses
or FFI. Its SHA-256 implementation follows
[FIPS 180-4](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf) and supplies
the format's digest. This is integrity checking, not publisher authentication
or a claim of cryptographic certification.

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
`Vir.Package.Format` constants. The browser interface validator
and Wasm IR decoder remain authorities for their respective representations; do
not mistake the adapter's interface-section reader for another full IR parser or
import the compiler/interpreter into lightweight acquisition tools to make it one.

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

Carriers use the single ordinary `public import Vir.Resources.Embed` above. It
exports resource types and the pure decoder; parser, file admission and expression
construction dependencies remain meta-only. Lean's phase rules require that ordinary
import route for the generated decoder call. Embedding the raw pack for runtime
parsing is not an alternative:
validation happens before typed constructors are embedded.

Compiled carriers contain their bytes and do not reopen the pack. Re-elaborating
a carrier still requires preparation; raw invocations that skip its library
prerequisites are outside the documented workflow.

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
Verify public acquisition before advertising the asset for ordinary application
builds. Authenticated CI downloads and supplied packs do not establish anonymous
installation. The owning-library workflow remains the application entry point;
neither publication nor an acquisition miss builds Wasm or selects a different
revision implicitly.

Installation writes to a fresh sibling directory, then renames the complete
file. It never truncates a cached/hardlinked destination and leaves valid warm
files untouched. Link ancestors and nonregular destination leaves are rejected.
Concurrent same-identity producers can safely install equivalent complete files.
An interrupted process can leave an unreferenced `.vir-resource-*` temporary
directory; retries never treat it as a cache candidate. These temporary directories
are producer-private generated state, not resources to publish. This is atomic
visibility, not crash-durable storage or protection against a hostile process
replacing ancestor directories during an operation.

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

The [runtime lock](../../vir-resources/runtime.json) selects one content ID and
acquisition source. The [compatibility record](../../vir-resources/compatibility.json)
independently defines the Lean revision / VIR version pair shared by program
production. A runtime must match that profile; another release is not a fallback.

After selecting a matching public, content-addressed runtime, missing local bytes
are acquired anonymously over HTTPS and verified before installation. A warm
verified cache or stage needs no runtime download. Missing offline bytes produce
an acquisition error naming the required identity, never an implicit Wasm build.
The native tool's `--offline` flag makes that acquisition boundary explicit.

A client library registers an independent program module and an asset library:

```lean
lean_lib ClientProgram where
  srcDir := "program"
  roots := #[]
  globs := #[.one `Client.Program]

lean_lib ClientResources where
  srcDir := "resources"
  roots := #[]
  globs := #[.one `Client.Resources]
  needs := #[`+Client.Program:virResourcePack]
```

The ordinary module facet in `needs` is the preparation prerequisite. It checks
the source import graph before fetching the canonical compiled program.
The selected module name supplies the logical identity; the build generates
the callable inventory rather than asking the client to maintain a recipe or
export table.
The canonical root `vir_export ∪ vir_startup` inventory supplies callable names;
imported markers do not become root entrypoints. Startup hooks are callable but
not automatically executed.

The facet materializes its actual Lake-returned artifact as a private input under
the producer's configured `leanLibDir`. `resources/Client/Resources.lean` imports
`Vir.Resources.Assets` and uses `include_vir_assets (modules := #[Client.Program])`.
The include finds complete semantic module paths on Lean's ordinary search path;
no carrier key, source-root inference, printed-name splitting or caller-cwd lookup.
The library's ordinary prerequisite owns preparation and tracing. Explicit
source-relative `include_vir_bundle` remains a low-level prepared-input tool,
not another application setup workflow. The high-level include returns the existing
`ResourceSet` with `Runtime.bundle` and programs in literal-list order; an umbrella
client module exposes it to the application.
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
the actual root interface manifest. The resource adapter retains that generated
interface, strips the private report and packages member bytes unchanged. The
facet retains the input and prepared-file traces on cache hits and misses;
both adapters reuse generation.
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
raw program packs does not turn rendering into acquisition.

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

It minimizes the JS import closure while preserving legal comments and public
properties, bundles Wasm and notices, verifies the compiler/profile
metadata and emits a native-validated pack plus provenance. Qualification of the
supplied Wasm remains the maintainer's responsibility. This command is never
called by an application's build or renderer.

## Publication

`resources.forSite outputPrefix` returns `Except ResourceError SiteFiles`:

- `files` is the complete output-relative inventory, including manifests and
  unchanged payload bytes. Identical bundles are emitted once.
- `runtimeModule` and `runtimeManifest` are the loader paths for the runtime.
- `programManifests` follows the original program list, including repeated
  references to the same program.

The prefix is a portable relative directory spelling; empty selects the output
root. It is not a bundle-member path: `bundle.json` is permitted as an output
directory. Names are preserved rather than normalized. Payload bytes, bundle
identities and bundle-relative paths are preserved; file enumeration order and
outer-envelope JSON spelling are not part of the contract.

The helper validates/deduplicates the resource set and performs no I/O or
acquisition. Write the returned inventory through the application's normal
asset writer. The host owns conflicts with other assets, stale files and failure
handling; this helper does not provide transactional whole-site publication.
See the [Quickstart publisher](../../examples/tutorials/quickstart/Main.lean).

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

All three URLs come from the returned `SiteFiles` loader paths, not build paths.
For declared `text/javascript` files, responses may use `text/javascript` or
`application/javascript` (with optional parameters). Other declared media types,
including `application/wasm`, still require their matching response type.
Fetched payloads are checked against their declared lengths and hashes.
The two manifest arguments must be explicit same-origin HTTP(S) `URL` objects,
without credentials, query strings or fragments. The page must provide WebCrypto
SHA-256 in a secure context: use HTTPS for deployment, or trusted localhost/loopback
HTTP for development. Remote plain HTTP is not supported. The loader checks this
capability before making any requests; a secure context also depends on the
embedding page, not only the manifest URL's scheme. The envelope is
`{contentId, descriptor}`. The loader bounds requests/JSON, rejects duplicate
keys and redirects, validates canonical identity, the runtime's declared module
and Wasm bytes, and every program payload,
checks exact compatibility, then delegates complete package-set validation and
loading to the existing interpreter. The set can only read members present in
the verified outer inventory. Full Lean names are resolved against actual package
root exports and bound to exact installed Lean entries.
Dependency-only exports do not become call entrypoints. No PrettyM protocol or
Slides policy is built into this API.

Runtime notices remain in the complete pack and published inventory, but creating
a program does not download them. Publishers must retain the notice files;
this retrieval policy does not remove distribution content or exclude notices
from content identity.

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
with zero runtime creations. If expectations are supplied, the consumer owns a
separately reviewed reference, not one inferred from the just-loaded program.
This establishes interface/artifact agreement, not proof of executable behavior.
Ordinary two-URL creation does not require an independent reference.

Each `createProgram` creates an independent runtime instance. No startup markers
are invoked. Calls return the runtime's
[documented JavaScript values](../guides/JS_API.md#calls-and-manifest) directly;
this facade does not introduce a second marshaller or semantic-ID layer.

The publisher's ESM bootstrap is trusted: importing JavaScript executes it before
its loader can verify a manifest. These checks prevent unverified Lean execution,
not malicious replacement of the whole website. The selected runtime module
must identify the executing module URL. Wasm bytes are handed to existing runtime
APIs; Infoview RPC asset revisions/path caches are not involved.

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
[single-component example](../guides/RESOURCE_LIFETIME.md#overlapping-loads).
