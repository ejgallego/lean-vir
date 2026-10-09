# Call Lean from JavaScript

This is the getting-started application. It builds a Lean greeting, publishes
the matching precompiled interpreter and program files, and calls Lean once
from a plain browser page.

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

## The files

- [lakefile.lean](lakefile.lean) pins an immutable compatible VIR revision,
  registers disjoint program/resource owners, and requests the module resource
  facet. The executable's ordinary web-source dependency tracks `include_str` inputs.
- [Program.lean](QuickstartApp/Program.lean) contains the public marked greeting.
  Its other five declarations are secondary examples reused by VIR's loose-package
  developer tests; only the greeting is marked for this application.
- [Resources.lean](QuickstartApp/Resources.lean) includes that prepared program
  and the library-owned interpreter as an ordinary `ResourceSet` value.
- [Main.lean](Main.lean) calls `forSite`, writes its inventory and derives every
  browser URL from the returned paths. It also writes the page and browser entry
  embedded through Lean's standard `include_str`.
- [main.js](web/main.js) initializes once, calls the fully qualified Lean
  declaration, displays its result or the original failure, and disposes the
  finite program. There is no retry, recreation or alternate backend.

Edit the Lean greeting or the page/JavaScript, rerun `lake exe publish _site`,
and reload the page. The whole output can move or be hosted under a nested URL;
it does not need the Lean checkout or build directory. The simple writer retains
stale files and is not a transactional website publisher.

The program module `QuickstartApp.Program` selects what Lake prepares; the
declaration `QuickstartApp.Program.greet` selects what JavaScript calls. The
project's namespace is distinct from the pinned dependency's older examples.
Larger applications can use existing disjoint program and asset libraries.

The repository smoke test copies this same authored project and substitutes the
candidate checkout for its immutable dependency pin. That tests current changes;
the copy-out configuration above does not silently follow a development branch.
