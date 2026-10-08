# Native-precompiled clients

Native document elaborators and compiler tools can use VIR's markers, interface
classifier, package generator and resource APIs with `precompileModules := true`.
Use narrow module imports:

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

## Native library boundary

Lake loads whole owning shared libraries for native-precompiled imports. A
narrow import must therefore have an owner without JavaScript-only externs.
`VirCompiler` owns marker/classifier/host metadata, interface encoding and import
caching. `VirPackageFormat` owns pure format, JSON and Name utilities.
`VirPackage` owns package generation, which also uses resource-core hashing.
Their dependency graph is:

```text
VirPackage       -> VirCompiler
VirPackage       -> VirResourceCore
VirCompiler      -> VirPackageFormat
VirResourceCore  -> VirPackageFormat
VirResourceEmbed -> VirResourceCore
```

Arrows point from importer to dependency. Compiler, shared-format and generator
implementations have separate module prefixes. The browser umbrella explicitly
owns its entrypoint and binding prefixes, so library ownership does not depend
on registration order. Interface encoding imports its model and JSON utilities
directly, without loading package generation. Resource acquisition, embedding
and optional runtime ownership retain their separate boundaries.

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
String and exact large Nat calls
and current descriptor encoding, then runs the native package generator. It uses
Lean and Node, acquires no runtime pack and builds no Wasm. Logs and outputs are
retained in the printed evidence directory. CI runs the same test.
