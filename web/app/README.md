# `web/app` Map

This directory contains repository applications and page-only helpers. Nothing
here is part of the JavaScript SDK payload; application code consumes the
runtime through `web/src` entry points.

- `demo.js`: runtime-demo fixture runner and Tamagotchi wiring.
- `dev.js`: local `.irpkg` package runner.
- `format-demo.js`: pretty-printer workbench.
- `landing.js`: repository landing-page behavior.
- `react-tamagotchi.js`: standalone React Tamagotchi page.
- `runtime-example.js`: minimal runtime example page.
- `browser-react-runtime.js`: browser application composition of the generic,
  DOM, and official React hosts.
- `vir-infoview-widget.js`: live infoview application that loads WASM, requests
  fresh `.irpkg` packages, and owns the official nested React root.
- `pages/`: import-safe page configuration, parsing, rendering, and fixture
  metadata helpers.

Keep imperative browser shells at this level. Keep reusable parsing and state
transformations under `pages/`, preferably pure so Node tests can exercise them
without a DOM. The generated infoview bundle lives at
`build/generated/infoview/vir-infoview-widget.js` and is refreshed by Lake or
`npm run build:infoview`; it is not committed.
