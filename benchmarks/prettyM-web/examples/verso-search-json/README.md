# Verso search JSON lanes

This catalog example runs the same ten Verso xref-domain mappings through two
independently catalogued VIR packages:

- `default`: explicit `Handle.toJson` / `Handle.ofJson` complete-tree
  transitions around the pure `Lean.Vir.Json` mapper;
- `borrowed`: one-level handle inspection with opaque `ref` passthrough.

The `manual` and `literate` fixture pairs preserve generated `xref.json`
and `domain-mappers.js` content captured from the Verso search experiment;
only a terminal newline was added for the tracked files. Their committed
SHA-256 identities are in `tests.json`. The pre-normalization upstream hashes
were `ff2612f…` / `074719e…` for Manual and `711b45e…` / `3c81376…` for
the literate project. The capture came from a local checkout of
[`ejgallego/verso`](https://github.com/ejgallego/verso) at unpublished search
experiment checkpoint `1e50e60652508c8afea85a7a0399eb5309194337`
(`feat: add experimental VIR search backend`). The commit identifies the source
state but is not a fetchable catalog input.

To refresh the fixtures, reproduce the Manual and literate sites from that
checkout, copy each generated `xref.json` and
`-verso-search/domain-mappers.js`, add only a terminal newline, then update the
hashes, domain lists, and searchable counts in `tests.json`. Together the
fixtures cover all ten domain mappers and 323 output searchables. The borrowed
variant additionally checks strict JavaScript identity for passthrough `ref`
values.

Run the catalog checks and inspect either build plan from the application
directory:

```sh
npm run examples:check
npm run example -- verso-search-json default --plan
npm run example -- verso-search-json borrowed --plan
```

The benchmark protocol retains five warm-ups and thirty samples per fixture,
reports boundary phases and Wasm-page growth, and does not treat timings from
an uncontrolled machine as accepted performance evidence. Both variants expose
`Lean.Vir.Json.Handle` and use the same JavaScript retain/call/read/release path.
For `default`, the explicit full-tree `toJson` and `ofJson` host calls occur
inside the Lean entrypoint, so their time is intentionally attributed to
`executeMs` and its overlapping `hostMs`, not hidden in automatic marshal/lift
phases.
