# Client-Native Externs

VIR can compile project-owned C or C++ providers into a browser runtime without
adding those declarations to VIR's built-in native catalog. The client keeps a
normal Lean reference body and an explicit fallback:

```lean
@[extern "my_project_increment"]
def MyProject.increment (value : UInt32) : UInt32 := value + 1

vir_extern_fallback MyProject.increment
```

Without the manifest, package generation uses that Lean body. With the manifest,
the same declaration is packaged as a native extern and the runtime contains a
compiler-generated boxed adapter plus the client provider.

The provider implements the raw C ABI named by `@[extern]`; VIR generates only
the boxed adapter used by the interpreter. For this scalar example, the provider
can be an ordinary C file:

```c
#include <stdint.h>

uint32_t my_project_increment(uint32_t value) {
  return value + 1;
}
```

C++ providers must declare selected functions with `extern "C"`; the manifest
records unmangled C symbols, and the provider audit rejects a mangled export.

## Manifest

Put `lean-vir-native-externs.json` at the root of the client's Lake project:

```json
{
  "format": "lean-vir-client-native-externs",
  "version": 1,
  "modules": ["MyProject.Native"],
  "externs": ["MyProject.increment"],
  "providerSources": ["c/native.c"]
}
```

- `modules` names the built Lean modules containing the `@[extern]`
  declarations. The wrapper generator imports them and obtains parameter
  types, borrow bits, result types, and C symbols from Lean's IR metadata.
- `externs` is the closed native selection. Every entry gets Lean's ordinary
  compiler-generated boxed wrapper; clients do not write adapters by hand.
- `providerSources` contains C or C++ paths relative to the manifest. `.c`
  files compile as C11; `.cc`, `.cpp`, and `.cxx` files compile as C++20.

All three arrays must be nonempty and duplicate-free. Provider paths must be
normalized relative paths and may use source-local quoted headers.

## Build and package

Build the client modules first, then set the same manifest while building the
Wasm runtime and the `.irpkg`:

```bash
lake -d /path/to/client build

VIR_NATIVE_EXTERN_MANIFEST=/path/to/client/lean-vir-native-externs.json \
  npm run build:demo
```

When invoking the repository's package tool from the client Lake environment:

```bash
VIR_NATIVE_EXTERN_MANIFEST=/path/to/client/lean-vir-native-externs.json \
LEAN_PATH=/path/to/lean-vir/.lake/build/lib/lean \
  lake -d /path/to/client env \
  /path/to/lean-vir/.lake/build/bin/vir_irpkg \
  output.irpkg output.report.md --target-marked ClientExports.lean
```

The manifest must be visible to both commands. This is intentional: it makes
native-over-fallback package selection and runtime provider selection one
profile rather than two independent allowlists.

The resulting Wasm runtime is specific to that manifest and must be deployed
with packages generated under the same selection. Rebuilding without
`VIR_NATIVE_EXTERN_MANIFEST` restores the generic VIR runtime. The manifest is
mutually exclusive with the experimental `VIR_NATIVE_EXTERN_EXTRAS_FILE`.

The generated boundary report records the manifest and provider sources.
`build/upstream-probe/generated/native-provider-symbols.tsv` records the raw
symbols derived from Lean metadata. The generated provider source and symbol
plans are empty after a generic build, so they never describe a previously
selected client profile.

To inspect the same profile in the boundary explorer, pass the manifest through
`VIR_NATIVE_EXTERN_MANIFEST` (or `--native-extern-manifest`) to
`npm run analyze:target-surface -- ...`. The explorer records its hash and
selection but leaves provider compilation and strict linking to the build.

## Validation and boundary

The tooling rejects:

- malformed or unknown fields and empty or duplicate array entries;
- unknown Lean declarations and collisions with VIR's built-in catalog;
- client/built-in declarations that share a raw lookup stem with incompatible
  boxed ABIs;
- missing provider files and provider objects that do not define every selected
  raw symbol; and
- duplicate symbols or unresolved symbols at the existing strict Wasm link.

This does not add general dynamic lookup. Only names selected by the built-in
catalog or this manifest enter the generated static registry. A provider may
contain additional functions, but section garbage collection drops unreferenced
code and those functions are not lookup capabilities.

Run the focused contract check with:

```bash
npm run check:client-native-externs
```

The checked-in example is under `fixtures/client-native-extern/`.
