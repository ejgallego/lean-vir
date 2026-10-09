# Call Lean from JavaScript

This application calls a Lean greeting from a plain browser page. Its integration
has three parts:

1. [Program.lean](QuickstartApp/Program.lean) marks the greeting with `@[vir_export]`.
2. [Resources.lean](QuickstartApp/Resources.lean) includes that program's assets
   in a resource library with `include_vir_assets`.
3. [lakefile.lean](lakefile.lean) registers those libraries and adds `needs` so
   Lake prepares the program before compiling the resource module.

The [application guide](../../../docs/guides/EMBEDDED_RESOURCES.md) shows these
three changes in detail. This directory supplies all the files to run them.

## Run it

With Lean/Elan, Git and `curl` installed, run from this directory:

```bash
lake exe publish _site
python3 -m http.server --directory _site 8000
```

Open <http://localhost:8000/>. The result is **Hello, world** from
`QuickstartApp.Program.greet`, not a JavaScript implementation of that function.
Python is just an example HTTP server; any server with JavaScript, JSON and Wasm
content types can serve `_site`.

No npm installation, WASI SDK, supplied runtime pack or VIR website build is
needed. The ordinary Lake build acquires the runtime selected by the pinned VIR
dependency. Missing acquisition is an error, not an implicit Wasm source build.
You can copy this whole directory out of the repository and use the same command.

## Publish and call

[Main.lean](Main.lean) calls `forSite`, writes its files and derives every browser
URL from the returned paths. It also writes the page and JavaScript embedded
through Lean's standard `include_str`; Lake's web-source dependency tracks edits.
[main.js](web/main.js) initializes once, calls `QuickstartApp.Program.greet`,
displays the result or original failure, and disposes the finite program.
There is no retry, recreation or alternate backend.

Edit the Lean greeting or the page/JavaScript, rerun `lake exe publish _site`,
and reload the page. The whole output can move or be hosted under a nested URL;
it does not need the Lean checkout or build directory. The simple writer retains
stale files and is not a transactional website publisher.

The other five declarations in Program.lean are secondary examples reused by
VIR's loose-package developer tests; only the greeting is marked for this application.
The repository smoke test copies this same authored project and substitutes the
candidate checkout for its immutable dependency pin. That tests current changes;
the copy-out configuration above does not silently follow a development branch.
