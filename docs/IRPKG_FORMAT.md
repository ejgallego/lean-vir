# IR Package Format

`.irpkg` files are the local binary packages loaded by the WASM shim. The
format is internal to this repository and is versioned by
`packageFormatVersion` in the embedded manifest metadata.

Package format 10 has a fixed header followed by a section directory. All
multi-byte integers are unsigned little-endian 32-bit values.

## Header

| Field | Encoding | Meaning |
| --- | --- | --- |
| magic | string | Must be `lean-vir-ir-package`. |
| package format | u32 | Currently `10`. |
| declaration count | u32 | Number of declaration entries in the declarations section. |
| section count | u32 | Number of section directory entries. |

Strings are encoded as `u32 byteLength` followed by UTF-8 bytes.

## Section Directory

Each section directory entry is:

| Field | Encoding | Meaning |
| --- | --- | --- |
| kind | u32 | Stable section kind. |
| offset | u32 | Absolute byte offset from the start of the package. |
| byte length | u32 | Payload byte length. |

The loader requires exactly one of each current section kind:

| Kind | Name | Payload |
| ---: | --- | --- |
| 1 | `declarations` | Encoded Lean IR declaration entries. The count lives in the header. |
| 2 | `initGlobals` | Encoded array of initializer global mappings. |
| 3 | `hostImports` | Encoded array of package-owned host import metadata. |
| 4 | `exportSummaries` | Encoded array of direct export call summaries. |
| 5 | `interfaceManifest` | Embedded JSON interface manifest as an encoded string. |

The section payload encodings are the same payloads that the pre-v10 linear
stream used. Format 10 makes the envelope self-describing; it does not add
deeper semantic validation beyond required sections, bounds, duplicate-section
checks, and section-local trailing-byte checks.

## Inspecting

Use:

```bash
npm run inspect:irpkg -- build/generated/pretty-printer.irpkg
```

The text output prints the package byte length, format, declaration count, and
section directory before the manifest summary. The JSON output exposes the same
data under `package.sections`, including each section's `kind`, `name`,
`offset`, and `byteLength`.
