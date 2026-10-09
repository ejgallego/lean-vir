# Native-precompiled clients

This guide covers experimental build-time APIs on VIR's pinned Lean toolchain.
For application setup, use the [resource workflow](EMBEDDED_RESOURCES.md).

Native document elaborators and compiler tools can use VIR's markers, interface
classifier, package generator and resource APIs with `precompileModules := true`.
Enable native precompilation in the consumer's Lake package:

```lean
package my_document where
  precompileModules := true
```

Then import the compiler APIs at meta time in the document module:

```lean
module
public import Vir.Resources.Embed
public meta import Vir.Attributes
public meta import Vir.Compiler.Interface.Classify.Signature
public meta import Vir.Compiler.Interface.Encode
```

The owning library's resource prerequisite prepares inputs before embedding;
the include operation itself only reads prepared bytes. Compiler tools can also
meta-import `Vir.GeneratePackage`. Ordinary applications use the
[library-owned resource workflow](EMBEDDED_RESOURCES.md), not a custom generator.

The classifier's successful result is a plain `Vir.Interface.ClassifiedSignature` value.
`signature.toExpectedSignatureJson` encodes the type-only `args`, `result` and
`effect` expected by JavaScript's `createProgram({ expectedExports: ... })`.
Construct this expectation from the author's declaration type independently of
the produced manifest. Parameter display names belong to manifest metadata and
do not participate in the caller's expected ABI.

For example, an elaborator can embed an independent expectation as a Lean String:

```lean
elab "expected_signature% " entry:ident : term => do
  let info ← Lean.getConstInfo entry.getId
  let .ok signature ← Vir.Interface.analyzeExportInterface info.type
    | Lean.throwError "cannot classify expected interface for {entry}"
  return Lean.mkStrLit signature.toExpectedSignatureJson
```

`expected_signature% MyProgram.greet` classifies that declaration before any
manifest is read. The document renderer can transport the resulting JSON value
to its generated JavaScript:

```js
const program = await createProgram({
  runtimeManifestUrl, programManifestUrl,
  expectedExports: {
    "MyProgram.greet": JSON.parse(greetSignature),
  },
});
```

The two manifest URLs come from the application publication workflow;
`greetSignature` is the emitted Lean String, not a manifest field.
The runtime compares validated type shapes, argument order and effect, rather
than JSON property order or arbitrary metadata. Nested canonical descriptors
retain constructor names and layouts; function parameter display names do not
change signature identity. Import `Vir.Package.Json` directly when writing a
custom package encoder; the compiler expectation codec exposes its interface
methods without re-exporting the package JSON helpers.

## Native library boundary

Lake loads whole owning shared libraries for native-precompiled imports. A
narrow import must therefore have an owner without JavaScript-only externs.
`VirCompiler` owns marker/classifier/host metadata, interface encoding and import
caching. `VirPackageFormat` owns pure format, JSON, Name and hashing utilities.
`VirPackage` owns package generation without loading resource preparation.
Their dependency graph is:

```text
VirPackage       -> VirCompiler
VirPackage       -> VirPackageFormat
VirCompiler      -> VirPackageFormat
VirResourceCore  -> VirPackageFormat
VirResourceEmbed -> VirResourceCore
```

Arrows point from importer to dependency. Compiler, shared-format and generator
implementations have separate module prefixes. The browser umbrella explicitly
owns its entrypoint and binding prefixes, so library ownership does not depend
on registration order. Interface encoding imports its model and JSON utilities
directly, including named arguments and effects, without loading package generation.
Resource acquisition, embedding and optional runtime ownership retain their
separate boundaries.

This is not a native guarantee for the `Vir` umbrella, browser or React modules:
those still contain JavaScript-only externs. Program generation stays independent
of runtime acquisition and Wasm production.

## Aggregate descriptors

`InterfaceType` uses named records for aggregate metadata. Constructor storage
counts live in `ConstructorStorage`; per-field locations remain separate
`FieldLayout` values. Counts describe compiled object/usize slots and
scalar bytes, not the number of source binders.

| Interface case | Named metadata |
| --- | --- |
| `taggedUnion` | `TaggedUnionVariant` with constructor name, payload type/layout and constructor storage |
| `customInductive` | `InductiveConstructor` with constructor storage and named `InductiveField` values |
| `structure` | `StructureDescriptor` with constructor storage, optional trivial field and `StructureField` values |

Clients inspecting custom constructors use `constructor.fields.map (·.type)`
instead of tuple projections. A structure matches as
`.structure name label descriptor`; its fields, trivial-field index and storage
counts are `descriptor.fields`, `descriptor.trivialField?` and
`descriptor.storage`. Construct metadata with named record literals.
These records replace positional aggregate tuples and storage-count arguments;
`StructureFieldLayout` is now `FieldLayout`.
Constructor JSON names are derived from the constructor's Lean Name relative to
its owning type, using the same rule for enums, tagged unions and custom inductives.
The records store the canonical constructor Name rather than a second label.
Callbacks and export signatures share `InterfaceArg` values: inspect arguments
with `arg.name` and `arg.type`. The same named-argument encoder handles both;
independent expected signatures still encode only the ordered argument types.
These are deliberate changes to the experimental Lean constructor API; there
are no tuple compatibility aliases. `ClassifiedSignature` and its expectation
encoder are unchanged. JSON fields, order, layout values and wire versions are
also unchanged.

## Import migration

Authoring imports `Vir.Attributes`, `Vir.Host` and `Vir.ExternFallback` remain.
Resource imports `Vir.Resources`, `Vir.Resources.Embed` and the explicitly optional
`Vir.Resources.Runtime` remain. Compiler implementation paths have moved:

| Previous import | Current import |
| --- | --- |
| `Vir.Interface.*` | `Vir.Compiler.Interface.*` |
| `Vir.GeneratePackage.Interface.Encode` | `Vir.Compiler.Interface.Encode` |
| `Vir.GeneratePackage.NativeExterns` | `Vir.Compiler.NativeExterns` |
| `Vir.GeneratePackage.CachedImports` | `Vir.Compiler.CachedImports` |
| `Vir.IRDependencies` | `Vir.Compiler.IRDependencies` |
| `Vir.ExportValidation` | `Vir.Compiler.ExportValidation` |
| `Vir.HostMetadata` | `Vir.Compiler.HostMetadata` |
| `Vir.HostValidation` | `Vir.Compiler.HostValidation` |
| `Vir.InterfaceValidation` | `Vir.Compiler.InterfaceValidation` |
| `Vir.GeneratePackage.PackageFormat` | `Vir.Package.Format` |
| `Vir.GeneratePackage.PackageIRTags` | `Vir.Package.IRTags` |
| `Vir.GeneratePackage.PackageSet` | `Vir.Package.Set` |
| `Vir.GeneratePackage.Json` | `Vir.Package.Json` |
| `Vir.LeanName` | `Vir.Package.Name` |

Update these imports when adopting the reorganized source. The moves preserve
declaration names, attribute names and wire-format values. Generator diagnostics
now use the single `PackageDiagnostic` record; `DeclIndexDiagnostic` and its
conversion helper have been removed. Existing clients pinned
to an earlier VIR revision can continue using that revision's imports.

`Vir.Compiler.InterfaceValidation.stripMData` is removed; use Lean's
`Expr.consumeMData` directly. Likewise, classifier callers can use
`e.consumeMData.constName?` instead of the removed `Vir.Interface.constName?`.

Use `interfaceType` to classify a complete type, `analyzeExportInterface` for a
complete export declaration, or `classifyHostImportSignature` for a host import.
`classifyExportSignature` accepts a signature already checked by marker preflight.
Classification returns typed errors with argument, field and container context;
JSON encoding remains a separate pure operation.

Recursion stacks and intermediate classifiers are private. `interfaceType` always
starts a fresh context; internal recursive calls must pass their branch-local
context explicitly. The retired `RecursiveSeen`, `recursiveVisit`, `functionType`,
`inductiveType`, `structureType` and `taggedUnionType` helpers are not public APIs.

Classifier recursion keys are fully applied Lean expressions compared with
`ExprStructEq`. Outer metadata is stripped; binder names and annotations, nested
metadata and universe levels participate in structural equality. No alpha or
definitional equality is added. Constructors and projections substitute the
applied type's declaration universe parameters before classifying their fields.
Different applications of an already visited recursive type remain nonuniform,
and earlier stack matches remain mutual-recursion errors.

Callbacks referring back to their enclosing aggregate owner remain unsupported:
closure invocation cannot carry that owner. A complete recursive result descriptor
establishes its own owner and remains supported. Exhaustive error matches should
handle `InterfaceClassifierError.recursiveCallback owner`.

The classifier's bounded head-reduction policy lives in `Classify.Reduce` and is
a low-level implementation module. Its helpers are not re-exported by `Core` or
`Signature`, but are callable through an explicit `Classify.Reduce` import; this
is separate from the private traversal declarations. It preserves recognized
interface heads and does not perform general definitional reduction. Ordinary
callers do not need reduction helpers or recursion contexts; encoded descriptors
are unchanged.

## Regression example

`fixtures/native-client` is a minimal native-precompiled consumer. Run:

```sh
npm run test:native-client
```

The test copies an independent producer and cold client, checks native-loaded
markers, signatures and independent interface encoding, links/executes Unicode
String and exact large Nat calls and current descriptor encoding, then checks a
separate generator meta client and runs the native package generator. Independent
expectations for nullary, multiple-argument, effectful and nested signatures are
checked against the generated root; changed argument order, effect and result
types fail admission. Lake checks
that every VIR module has exactly one library owner. The test uses
Lean and Node, acquires no runtime pack and builds no Wasm. Logs and outputs are
retained in the printed evidence directory. CI runs the same test.
