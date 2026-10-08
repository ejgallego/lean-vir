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

The classifier returns a pure `Vir.Interface.ClassifiedSignature` value.
`signature.toExpectedSignatureJson` encodes the type-only `args`, `result` and
`effect` expected by JavaScript's `createProgram({ expectedExports: ... })`.
Construct this expectation from the author's declaration type independently of
the produced manifest. Parameter display names belong to manifest metadata and
do not participate in the caller's expected ABI.

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

Update these imports when adopting the reorganized source. Declaration names,
attribute names and wire-format values remain unchanged. Existing clients pinned
to an earlier VIR revision can continue using that revision's imports.

## Regression example

`fixtures/native-client` is a minimal native-precompiled consumer. Run:

```sh
npm run test:native-client
```

The test copies an independent producer and cold client, checks native-loaded
markers, signatures and independent interface encoding, links/executes Unicode
String and exact large Nat calls and current descriptor encoding, then checks a
separate generator meta client and runs the native package generator. Lake checks
that every VIR module has exactly one library owner. The test uses
Lean and Node, acquires no runtime pack and builds no Wasm. Logs and outputs are
retained in the printed evidence directory. CI runs the same test.
