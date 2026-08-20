# lean-zip catalog integration

lean-zip is a client-owned compression example, not a VIR fixture. Its
catalog entry assembles five browser backends over one semantic operation:

```text
ByteArray × compression level → raw-DEFLATE ByteArray
```

The backend IDs are intentionally explicit:

- `vir`: the production lean-zip closure interpreted by VIR;
- `fir-native`: FIR's resident, zero-import Wasm compiler route;
- `fir-emscripten`: final LCNF through Lean C, LLVM, Emscripten, and the full
  Lean runtime;
- `compression-stream`: the browser's raw-DEFLATE implementation; and
- `fflate`: the pinned JavaScript codec.

Native Lean runs only while producing the workload package. Its compressed
bytes are the exact oracle for the three Lean browser routes. All five browser
outputs must inflate independently to the original input; the two JavaScript
routes need not choose the same compressed bytes.

## Package and data flow

```text
lean-zip source checkout
  ├─ deterministic inputs + native-Lean outputs
  ├─ workload plan
  └─ client controller + worker + protocol + pinned fflate
                     │
VIR checkout ────────┼─ VIR runtime + lean-zip .irpkg
FIR checkout ────────┼─ FIR-native package
lean-zip + FIR ──────┼─ FIR C/Emscripten package
                     ▼
          verified lean-zip artifact set
                     ▼
             shared catalog shell
```

lean-zip owns inputs, oracle generation, workload selection, browser worker,
codec semantics, and its C/Emscripten bridge. VIR and FIR own their compiler
artifacts. This repository owns source pinning, assembly, admission, Pages,
and the shared presentation shell.

Every producer uses `browser-benchmarks/source-package/v1` and receives a
fresh output plus explicit checkout and dependency-package assignments. The
catalog must not call the lean-zip loopback server or copy its source into VIR.

## Activation record

The descriptor is active because all four producer entry points are available
at the immutable revisions selected by `artifact-builds.json`:

1. lean-zip source/oracle package;
2. VIR client-native runtime and `.irpkg` package;
3. FIR-native levels 1–10 package;
4. lean-zip-owned FIR C/Emscripten package.

Each candidate still has to pass package-local smokes, exact checksums, all
declared browser backends ready, independent inflation for every output, and
exact native-oracle bytes for all three Lean routes. Timing values are not a
candidate gate and are not publication evidence on an uncontrolled host.
