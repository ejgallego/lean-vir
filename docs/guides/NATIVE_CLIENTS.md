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

## Classifier and descriptor API

Use `Vir.Compiler.Interface.Classify.Core.interfaceType` to classify a complete
Lean type, `analyzeExportInterface` for an export declaration, and
`classifyHostImportSignature` for a host import. Results use typed errors with
argument, field and container context. Classification and pure JSON encoding
are separate operations; ordinary clients need no recursion context or reduction
helper.

`InterfaceType` keeps compiler-derived aggregate metadata in named records:

| Interface case | Metadata |
| --- | --- |
| `customInductive` | `InductiveConstructor` with `ConstructorStorage` and `InductiveField` values |
| `structure` | `StructureDescriptor` with storage, `trivialField?` and `StructureField` values |

Inspect constructor fields with `constructor.fields.map (·.type)`. Match a
structure as `.structure name label descriptor`; use `descriptor.fields`,
`descriptor.trivialField?` and `descriptor.storage`. Counts describe compiled
object/usize slots and scalar bytes; `FieldLayout` describes each field's physical
location. The compiler owns constructor Names and storage. JavaScript spellings
and public shapes appear in the emitted value interface.

Callbacks and classified signatures use `InterfaceArg` values (`arg.name` and
`arg.type`). `InterfaceType.toJson` encodes a complete native/value pair;
`ClassifiedSignature.toExpectedSignatureJson` encodes ordered pairs and effect for
an independent consumer contract. Package manifests store complete closed pairs
in a local table and callable entries contain indices. Expected signatures
contain complete pairs, independently of package numbering. The
[manifest format reference](../reference/IRPKG_FORMAT.md#interface-descriptors)
is authoritative for the wire contract.

Recursion keys are fully applied Lean expressions compared with `ExprStructEq`.
Outer metadata is stripped; binder names/annotations, nested metadata and
universe levels participate. Constructor and projection fields substitute the
applied universe instance. Exact enclosing matches become lexical references;
finite descent into a concrete parameter is supported, including permitted
abbreviations and closed-record projections (`List Nats` for `Nats := List Nat`).
Growing or changed recursive applications and actual mutual inductive families
remain unsupported. Permitted head reduction recognizes finite descent without
adding definitional equality to recursion keys.

Callbacks cannot carry a reference to their enclosing aggregate owner. A complete
recursive callback argument/result descriptor establishes its own owner and
remains supported. Error handling should account for
`InterfaceClassifierError.recursiveCallback owner`.

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
