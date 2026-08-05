# Lean prettyM benchmark webapp

This directory is a standalone browser application for comparing five
`Std.Format.prettyM` implementations. It intentionally has no dependency on
Verso, Reveal, Lake, or the parent VIR repository's source tree.

The complete application can be moved to the root of another repository. The
four root-level VIR npm commands are convenience pointers only and are not used
by this package.

## Responsibilities

- load the JavaScript, VIR JSON, VIR typed-Format, native FIR Wasm, and
  LLVM/Emscripten candidates;
- verify exact rendered-text and styling parity;
- collect marshal, execute, decode, and total timings;
- run corpus, scaling, interaction, retained-memory, and repeated-call studies;
- display reports and campaigns, and import/export their JSON representation.

The slide deck is not part of this application. It may link here or present a
recorded report, but benchmark execution does not initialize Reveal or use
slide DOM state.

## Artifact contract

Binary artifacts are local inputs and remain ignored by Git. Place a validated
bundle under `_artifacts/seed/`, using this layout:

```text
lean-vir/js/vir-runtime.js
lean-vir/wasm/vir-upstream.wasm
prettyM-vir.irpkg
lean-native/{BUILD.json,prettyM-browser-adapter.mjs,prettyM.wasm,prettyM.wasm.json}
lean-llvm/{README.md,SHA256SUMS,emscripten-loader.mjs,
           prettyM-emscripten-adapter.mjs,prettyM.manifest.json,
           prettyM.mjs,prettyM.wasm}
```

The staging script accepts only seed directories contained by this application
directory. This prevents builds from silently depending on a developer's other
checkouts.

The current Lean 4.32 VIR package retains the historical
`VersoSlides.Pretty.*ForVir` export names. They are declared in `src/config.js`
as artifact compatibility data; the application itself does not load Verso or
depend on slide sources. Renaming those two exports can accompany a later
artifact refresh without changing the benchmark or dashboard APIs.

## Develop and test

```sh
npm install
npm run stage
npm run build
npm run dev
```

Open <http://127.0.0.1:18334>. The included server supplies the cross-origin
isolation headers required by threaded LLVM Wasm. `_headers` and `.htaccess`
files are included at the root of `dist/` for static hosts; configure equivalent
headers when the hosting platform does not consume either format.

Run the browser regression with:

```sh
npm test
```

Set `CHROMIUM` to an alternate Chrome/Chromium executable when necessary.

## Spin-off boundary

The future repository root is exactly this directory. Source, styles, build and
serve scripts, browser tests, package metadata, licensing files, documentation,
and the artifact input contract are all contained here. The app uses only
browser APIs and its own npm development dependency.

The benchmark engine is still deliberately `prettyM`-specific. Generalizing
the sampler for unrelated Lean functions should happen only after a second
function supplies concrete requirements.
