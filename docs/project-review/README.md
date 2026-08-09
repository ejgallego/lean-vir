# VIR Project Review Pack

This directory contains the evidence pack for the 2026 VIR internal all-hands.
It is written for a technically mixed audience and separates measured
repository facts from user hypotheses that still need validation.

The current conclusion is:

> VIR is a mature internal pilot platform with measured runtime boundaries and
> a real downstream workflow. The next product gate is coherent browser
> binding and lifecycle semantics, followed by the smallest supportable SDK
> release.

## Pack

- [Project Review](PROJECT_REVIEW.md): executive pre-read, technical verdict,
  scorecard, and immediate recommendations.
- [Technical Appendix](TECHNICAL_APPENDIX.md): architecture, validation
  results, artifact measurements, risks, public interfaces, and branch
  disposition.
- [User Needs](USER_NEEDS.md): evidence-based user segments, seeded use cases,
  maintainer workshop, key-user interview, and pilot intake.
- [Six-Month Roadmap](ROADMAP.md): pilot-first milestones, gates, and
  demand-triggered investments.
- [Slide Source](SLIDES.md): portable eight-slide Markdown deck.
- [All-Hands Runbook](ALL_HANDS.md): the eight-slide, 20-minute talk; speaker
  notes; demo; rehearsal; follow-up; and decision log.
- [All-Hands Notes](ALL_HANDS_NOTES.md): raw feedback, use cases, upstreaming
  reactions, decisions, and ownership commitments captured during the meeting.
- [Action Cards](cards/README.md): at most eight active `Deliver`, `Learn`, and
  `Coordinate` actions with explicit completion and archive rules.

Durable direction lives outside this dated evidence pack:

- [Product](../PRODUCT.md)
- [Alternatives](../ALTERNATIVES.md)
- [Upstreaming](../UPSTREAMING.md)
- [Maintenance](../MAINTENANCE.md)
- [Decisions](../DECISIONS.md)

## Review Configuration

- Current snapshot date: 2026-08-10.
- Repository baseline: `062fc8f4c24c1f35c43d92c38beb0782976c7e03`.
- Original comparison baseline: `b528eddb94a46e16f649b290958e4bd2bd1df08a`.
- Lean toolchain: `leanprover/lean4:v4.33.0-rc2`.
- Meeting length: 20 minutes.
- Meeting goals: explain what VIR does and how it is used, compare it with
  alternatives, make upstreaming risks explicit, and close with the sponsored
  productization path.
- Roadmap horizon: six months with evidence gates.
- User evidence: repository and downstream-client evidence, the maintainer's
  use cases, and one key-user interview.
- First pilot direction: Lake/browser integration after the all-hands, using
  exact-commit artifacts for early learning and a tag only after binding and
  lifecycle semantics converge.
- Organizational context: management supports productization; named capacity
  and backup ownership remain to be confirmed.

The snapshot deliberately excludes unmerged draft PRs from claims about
`main`. Draft PRs appear as evidence about unresolved binding, lifecycle, and
artifact-management decisions, not as shipped capability.

## How To Use The Pack

1. Complete the maintainer workshop and key-user interview in
   [User Needs](USER_NEEDS.md).
2. Recheck time-sensitive repository and CI facts immediately before the talk.
3. Complete
   [D-001](cards/active/D-001-recenter-all-hands.md) and send the resulting
   pre-read two business days before the meeting.
4. Rehearse the all-hands runbook twice and record the demo fallback.
5. Capture raw feedback in [All-Hands Notes](ALL_HANDS_NOTES.md).
6. Complete
   [C-001](cards/active/C-001-productization-ownership.md) by confirming the
   maintainer, backup, and Lake/browser pilot owners.
7. Assign and run
   [L-003](cards/active/L-003-binding-lifecycle-semantics.md) before freezing
   the first supported SDK surface.
8. Promote durable outcomes to the living documents and leave no more than
   eight owned active cards.

The review does not introduce a new harness, backport policy, or branch-policy
metadata. The small repo-local card board is the execution layer; if an
external tracker becomes authoritative, do not duplicate its live status.
