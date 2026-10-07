# Native-precompiled clients

Native document elaborators and compiler tools can use VIR's markers, interface
classifier, package generator and resource APIs with `precompileModules := true`.
Use their existing narrow module imports:

```lean
module
public import Vir.Resources.Embed
public meta import Vir.Attributes
public meta import Vir.Interface.Classify.Signature
```

The owning library's resource prerequisite prepares inputs before embedding;
the include operation itself only reads prepared bytes. Compiler tools can also
meta-import `Vir.GeneratePackage`. Ordinary applications use the
[library-owned resource workflow](EMBEDDED_RESOURCES.md), not a custom generator.

## Native library boundary

Lake loads whole owning shared libraries for native-precompiled imports. A
narrow import must therefore have an owner without JavaScript-only externs.
`VirCompiler` owns marker/classifier/host metadata and package-format/cache leaf
modules. `VirPackage` owns the remaining generator modules, which also use
resource-core hashing. Their dependency graph is:

```text
VirPackage       -> VirCompiler
VirPackage       -> VirResourceCore
VirResourceCore  -> VirCompiler
VirResourceEmbed -> VirResourceCore
```

Arrows point from importer to dependency. Separating generator metadata from
generation keeps this graph acyclic. The narrower owners are registered after
the default `Vir` umbrella; compiler leaves follow the broad package-generator
glob. Existing resource/core/embedding owners, module names and facets remain.

This is not a native guarantee for the `Vir` umbrella, browser or React modules:
those still contain JavaScript-only externs. Program generation stays independent
of runtime acquisition and Wasm production.

## Regression example

`fixtures/native-client` is a minimal native-precompiled consumer. Run:

```sh
npm run test:native-client
```

The test copies an independent producer and cold client, checks native-loaded
markers and signatures, links/executes Unicode String and exact large Nat calls
and current descriptor encoding, then runs the native package generator. It uses
Lean and Node, acquires no runtime pack and builds no Wasm. Logs and outputs are
retained in the printed evidence directory. CI runs the same test.
