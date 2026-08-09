# D-003 — Put real-browser smoke in CI

Type: Deliver
Status: Archived
Owner: VIR maintainer
Contributors: None recorded
Milestone: Pilot readiness
Created: 2026-08-04
Completed: 2026-08-09
Related: [roadmap](../../../ROADMAP.md),
[maintenance](../../../../MAINTENANCE.md),
[technical evidence](../../../TECHNICAL_APPENDIX.md)

## Outcome Sought

Real browser regressions are detected on release candidates without depending
on a maintainer's local Chrome installation.

## Scope Delivered

- Normal CI runs `npm run test:pages:browser` after the release site build.
- Chromium chooses and publishes its DevTools port, avoiding the prior
  free-port race.
- Startup waits for `DevToolsActivePort` and reports bounded stderr-backed
  diagnostics.
- Cleanup escalates from normal termination when Chromium does not exit.

## Acceptance Result

- Exact-head main CI at
  `062fc8f4c24c1f35c43d92c38beb0782976c7e03` passed the real browser suite.
- Landing, package runner, direct calls, callbacks, cleanup, structured values,
  and browser-host behavior run in the normal build job.
- Browser startup failures are distinct from runtime failures.
- Pages built and deployed successfully at the same commit.

## Evidence

- [Main CI run](https://github.com/ejgallego/lean-vir/actions/runs/31336353034)
- [Pages deployment](https://github.com/ejgallego/lean-vir/actions/runs/31336353178)
- Merged PR #109, `fix: harden Chromium DevTools startup`

## Closure

Completed: 2026-08-09
Result: Real Chromium smoke is a normal exact-head CI gate and Pages is green.
Unexpected findings: A later draft stateful-browser change was correctly
rejected by this suite for leaving an animation frame uncancelled; that
semantic issue belongs to L-003, not to browser startup reliability.
Follow-up cards:
[L-003](../../active/L-003-binding-lifecycle-semantics.md)
Durable documents updated: `docs/HARNESS.md`, `docs/MAINTENANCE.md`, current
project review and roadmap.
