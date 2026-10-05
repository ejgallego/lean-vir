# Carrier source-root feasibility fixture

Run from the repository: `node tests/resources/carrier-source-root.mjs`.
The script retains every generated workspace and log and explicitly selects the
repository's pinned toolchain before invoking Lake from another directory.
Elan selects the toolchain before Lake processes `--dir`.

This is a test-local diagnostic, not `include_vir_library` or a shipped locator.
It compares the actual elaborator source filename/main module with Lake's module
collection, `Module.leanFile` and `LeanLib.srcDir`. The diagnostic strips only the
complete `Lean.modToFilePath` suffix; it does not discover a root by searching
ancestors, scanning caches or guessing from the caller's directory.

Cases cover the actual `VersoSlidesVirPrettyMResources` library versus
`VersoSlides.VirPrettyMResources` module under `resources`; deep modules;
composed package/library source paths; custom build paths and spaces; dotted and
quoted library/module names; and a default source root with a single-component
module. Two separate dependency packages use the same `ClientResources` key;
the application's Lake oracle must keep their roots distinct. Each library's
compile observation is obtained in its own package context. The mismatch control
reuses Lake's actual setup and changes only the module name, preserving the
basename while making its full suffix wrong.

The reported `.vir-generated/<key>.virres` path is the source-root stage,
not a pack this fixture builds. This diagnostic established the correspondence
before production staging changed; the actual carrier behavior is qualified
separately by the embedding, owning-library and resource-cache tests.
No resource acquisition, runtime/program packing,
embedding, artifact-cache restoration, filesystem relocation or downstream
browser behavior is qualified here. Executed filesystem cases are Linux only.
