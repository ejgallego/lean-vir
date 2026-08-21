# VIR Action Cards

Status: Living board
Last reviewed: 2026-08-13

These cards are the execution layer for the
[VIR project review](../README.md). A card is a bounded action that can be
owned, completed, and archived. Architectural facts and durable conclusions
belong in the living documents under `docs/`, not on this board.

## Card Types

| Type | Purpose | Completion test |
| --- | --- | --- |
| `Deliver` | Produce a concrete artifact or behavior | The stated acceptance criteria pass |
| `Learn` | Resolve an important uncertainty with evidence | The question is answered well enough to decide what follows |
| `Coordinate` | Obtain a named commitment, review, or external decision | The commitment or response is recorded |

## Lifecycle

1. `Proposed`: useful outcome, but owner or scope is not confirmed.
2. `Ready`: owner, outcome, dependencies, and acceptance criteria are clear.
3. `In progress`: the owner has started the bounded work.
4. `Blocked`: a named external condition prevents useful progress.
5. `Done`: acceptance criteria pass and closure evidence is recorded.
6. `Superseded`: the card is no longer the right unit of work; its closure
   names the card or durable record that absorbed the outcome.
7. `Archived`: a done or superseded card has moved to `archive/<year>/`.

A card does not move to `Ready` without an owner. It does not move to the
archive until its closure section states the result, links the evidence,
records follow-up cards, and names the durable documents updated by the work.
Superseding a card is a scope decision, not a claim that its acceptance
criteria passed.

Keep at most eight active cards. A pilot or roadmap phase is a milestone that
groups cards, not one indefinitely large card.

## Active Board

| Card | Type | Status | Milestone | Owner |
| --- | --- | --- | --- | --- |
| [C-001 Confirm productization ownership](active/C-001-productization-ownership.md) | Coordinate | Proposed | Pilot readiness | Unassigned |
| [L-003 Converge binding and lifecycle semantics](active/L-003-binding-lifecycle-semantics.md) | Learn | Proposed | Pre-release semantics | Unassigned |
| [L-004 Establish the JS/VIR/FIR comparison contract](active/L-004-js-vir-fir-comparison.md) | Learn | Proposed | Product evidence | Unassigned |
| [L-001 Measure fresh setup resource cost](active/L-001-setup-release-baselines.md) | Learn | Proposed | Maintenance readiness | Unassigned |
| [L-002 Run the Lake/browser pilot](active/L-002-lake-browser-pilot.md) | Learn | Proposed | Primary pilot | Unassigned |
| [D-002 Publish and consume the first supported SDK](active/D-002-first-sdk-release.md) | Deliver | Proposed | After semantics gate | Unassigned |
| [C-002 Obtain upstream feasibility feedback](active/C-002-upstream-feasibility.md) | Coordinate | Proposed | Upstreaming | Unassigned |

## Recently Archived

| Card | Completed | Result |
| --- | --- | --- |
| [D-001 Recenter the all-hands message](archive/2026/D-001-recenter-all-hands.md) | 2026-08-11 | Presentation delivered; comparison quality became the main follow-up |
| [D-004 Define the pilot support contract](archive/2026/D-004-pilot-support-contract.md) | Superseded 2026-08-11 | Absorbed into D-002 so release and support claims cannot drift |
| [D-003 Put real-browser smoke in CI](archive/2026/D-003-browser-ci.md) | 2026-08-09 | Exact-head CI runs the real Chromium suite with bounded startup diagnostics |

## Operating Rules

- Write titles as outcomes or imperative actions.
- Keep one accountable owner per card; contributors can be listed separately.
- Put dates on evidence, not on unsupported forecasts.
- Create a follow-up card instead of silently enlarging an active card.
- Do not duplicate live status in a GitHub issue. If a card is moved to an
  external tracker, link that record and make one location authoritative.
- Use [the template](TEMPLATE.md) for new cards.
- Put completed cards in [the archive](archive/README.md).
