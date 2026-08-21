# D-001 — Recenter the all-hands message

Type: Deliver
Status: Archived
Owner: Unassigned
Contributors: None
Milestone: All-hands (completed)
Created: 2026-08-04
Related: [project review](../../../PROJECT_REVIEW.md),
[alternatives](../../../../ALTERNATIVES.md),
[upstreaming](../../../../UPSTREAMING.md)

## Outcome Sought

The 20-minute all-hands explains what VIR does, how a developer uses it, the
risks and opportunities of upstreaming, and how VIR compares with alternative
ways to solve the same problem.

## Why Now

The previous review deck led with pilot readiness and recruitment. The agreed
meeting purpose is technical and product orientation; productization,
maintenance, and the pilot should support that story rather than dominate it.

## Scope

- Rework the slide source and speaker runbook around problem, mechanism,
  usage, supported boundary, alternatives, upstreaming, and conclusion.
- Retain one short working demo and measured evidence.
- Keep roadmap and ownership asks to the closing slide or discussion.
- Do not expand the deck into a comprehensive market survey.

## Done When

- The deck fits eight slides and 20 minutes.
- It includes the Lean-to-browser usage path and a short demonstration.
- It compares VIR with TypeScript, server-side Lean, direct Wasm compilation,
  and a new web evaluator.
- It distinguishes plausible Lean-upstream seams from VIR-specific product
  code.
- The runbook includes speaker notes, timing, demo fallback, and Q&A prompts.
- The revised deck and runbook pass link and placeholder checks.

## Dependencies

- None remaining.

## Evidence

The slide source and runbook were redrafted on 2026-08-04 around the agreed
problem, usage, alternatives, upstreaming, and productization narrative. On
2026-08-10 they were refreshed to the current 98-fixture/18-runtime baseline,
real-browser CI, measured native frontier, five-backend comparison app,
Illuminate workload, and real-environment provider experiment.

The presentation was delivered before the 2026-08-11 reassessment. The main
recorded audience feedback was the need for a clear, fair comparison of the
JavaScript, VIR, and FIR implementations across load latency, execution speed,
deployable size, and related operating costs.

## Closure

Completed: 2026-08-11 (recorded; exact meeting date not captured)
Result: The presentation established the shared architecture and alternatives
model. Its strongest actionable feedback was to turn the existing benchmark
machinery into an authoritative JS/VIR/FIR comparison contract.
Unexpected findings: The audience's next question was not whether the three
paths can run the same workload, but whether their cold-load, steady-state,
size, and amortization trade-offs can be compared fairly.
Follow-up cards:
[L-004](../../active/L-004-js-vir-fir-comparison.md)
Durable documents updated: `docs/ALTERNATIVES.md`, `docs/DECISIONS.md`,
`docs/project-review/ALL_HANDS_NOTES.md`
