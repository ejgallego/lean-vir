# Illuminate plotting rehearsal

The Illuminate page is the first real second client of the standalone plotting
application. It compares the production JavaScript state machine with typed VIR
and FIR-native implementations of the same player trace. This remains a local,
non-publishable rehearsal until every source is available as a clean immutable
revision.

## Refreshed builds

Last checked: 2026-08-08.

| Role                | Source/build                          | Staged identity                                                                                                                                                                                                                        | Status                                            |
| ------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Illuminate workload | `leanprover/illuminate`               | commit `006dc1d1db18c5dc73d637c926cf132e88df05b5`; `Player.lean` SHA-256 `3ed87ac8d6a21c0afb2b00efcde6f5390c47be336c09214c24ead847bdb4f306`; `FirLive.lean` SHA-256 `941daf939d9faa966aa8fb848b4a8f7ce0525ba6420d3843067e2c97908e2121` | Dirty local source; not canonical                 |
| VIR runtime         | `lean-vir`                            | commit `552cfa5b860908d2f0b3696f3fb22236521b8f0f`; Wasm SHA-256 `488a4a5e4f52bec15e1458964e34c5cf9182ad308a53d83c7e95a299eee60563`; runtime JS SHA-256 `e0b7d7c5a4d038c1b3958e5079fb7cb078fbcde1e23f092b45bf15ccce8a3056`              | SDK manifest records a dirty build; not canonical |
| VIR workload set    | Illuminate `Vir` module set           | descriptor SHA-256 `391ae1ed5acc33de608af60e160a6c8f05441bf8fb7a47ca89cca0931b20a34c`; root package SHA-256 `4d34a20e98a14425c7fc629e5ca80fe64e04670931e5811464808bdf9c7a8dfe`                                                         | Validated local package set                       |
| FIR producer        | `lean-fir`                            | clean commit `b72f2bfa9e7d1c20251f75a91f4dcbe88fc657dd`                                                                                                                                                                                | Local checkpoint                                  |
| FIR package         | persistent live player/browser API v3 | 50,203-byte Wasm, SHA-256 `b36cfaf21175a40bfb5156e527057700eed56609bd8f2b8f91e68914c254158e`; zero imports; six public functions                                                                                                       | Refreshed and staged                              |

The previous staged FIR package used producer commit `658d36e`, browser API
v2, a 50,194-byte Wasm module, and the single whole-trace entry. The refreshed
v3 package keeps `replayTrace` as a compatibility method while implementing it
through the persistent `createPlayer`/`dispatch` boundary. The plotting adapter
aggregates v3 creation and dispatch timing intervals into the shared prepare,
execute, decode, and total phases; all original v3 intervals remain in the raw
report.

## Correctness status

The refreshed FIR package passed:

- its checksum and packaged smoke checks;
- a 10,000-tick persistent-frontier plateau (`1872` checkpoint, `2576` peak);
- the 106-case legacy JavaScript/VIR JSON/VIR typed/FIR-native trace suite; and
- the plotting application's Chromium smoke test.

The real "Pause-driven slide show" example still exposes one intentional stop
condition for integration: JavaScript initializes `currentStep` to `0`, while
Lean uses `findCurrentStep steps 0` and selects step `1` when two step markers
share frame zero. The plotting report displays those mismatches. No adapter
normalization is permitted; Illuminate must resolve the source semantics and
add the example to its differential corpus.

No timing captured on this machine is accepted as performance evidence.

## Local staging

From this application directory:

```bash
npm run stage:illuminate -- \
  --source /path/to/illuminate \
  --native-package /path/to/illuminate-player-package
npm run test:illuminate
```

The stager verifies the native package checksums, copies every input under the
ignored `artifacts/illuminate/` directory, and writes `REHEARSAL.json` with the
exact dirty/source/build identities. It does not update the canonical artifact
lock or publish anything.

Once Illuminate and VIR supply clean revisions, move this workload into
`artifact-builds.json`, build it through controlled `_sources/` checkouts, and
replace the local rehearsal receipt with an immutable artifact-set manifest.
