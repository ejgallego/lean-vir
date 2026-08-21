# VIR All-Hands Notes

Status: Post-meeting synthesis
Meeting date: Completed; exact date not recorded
Facilitator: Not recorded
Note taker: Not recorded

Use this file to preserve raw feedback from the internal all-hands. Do not
rewrite disagreement into consensus during the meeting. Afterward, promote
accepted conclusions into the living documents, record durable choices in
`docs/DECISIONS.md`, and create or update bounded action cards.

## Participants

- Not yet recorded.

## Questions And Reactions

| Topic | Observation or question | Speaker, if useful | Follow-up |
| --- | --- | --- | --- |
| What VIR does | The presentation is complete; no correction to the core selected-IR/package model was recorded. | Audience synthesis | Preserve the delivered deck as historical context. |
| How it is used | No new named pilot was captured in this record. | Audience synthesis | Continue the Lake/browser pilot intake after the semantics gate. |
| Alternatives | We need a good, fair way to compare JavaScript, VIR, and FIR implementations, especially load latency, speed, and size. | Audience feedback | L-004 defines and produces the comparison contract and scorecard. |
| Upstreaming | | | |
| Trust and security | | | |
| Maintenance | Productization remains supported by management; named backup, review, benchmark, and pilot capacity are still unrecorded. | Prior discussion plus presentation follow-up | C-001 converts sponsorship into named roles. |

## Use Cases Offered

| User | Current workflow | Desired outcome | Alternative today | Commitment | Candidate card |
| --- | --- | --- | --- | --- | --- |
| Not yet named | Lake/browser integration | Reuse Lean-authored logic in a static browser application | JavaScript rewrite or FIR-native build | Not yet recorded | L-002 |

## Upstreaming Feedback

Record feedback separately for:

- WASI build and platform portability;
- static native-symbol registration;
- the declaration-provider seam; and
- VIR-specific package and browser APIs.

## Decisions

| Decision | Rationale | Owner | Durable record |
| --- | --- | --- | --- |
| Make the JS/VIR/FIR comparison multidimensional and reproducible. | Load, speed, size, memory, integration, and update behavior answer different questions; VIR runtime sharing needs explicit amortization. | Unassigned | DEC-008, L-004, `docs/ALTERNATIVES.md` |
| Ship the first SDK and its support contract as one deliverable. | Artifact and maintenance promises must not drift. | Unassigned | DEC-009, D-002 |

## Ownership And Commitments

| Role or commitment | Person | Time window | Confirmed |
| --- | --- | --- | --- |
| Accountable VIR maintainer | | | No |
| Backup maintainer | | | No |
| Lake/browser user owner | | | No |
| Lake/browser VIR owner | | | No |
| Binding/lifecycle reviewer | | | No |
| Comparison evidence owner | | | No |
| Management sponsor | Person not recorded | Existing support confirmed | Yes |

## Card Changes

| Card | Action | Reason |
| --- | --- | --- |
| D-001 | Archive as done | The presentation was delivered. |
| L-004 | Create | Own the authoritative JS/VIR/FIR comparison contract and campaigns. |
| D-004 | Archive as superseded | Consolidate the support contract into D-002. |
| D-002 | Expand | Ship release artifact and support contract together. |
| L-001 | Narrow | Keep only the fresh-setup resource question; move runtime comparison to L-004 and lifecycle evidence to L-003. |
| L-003 | Update | PR #103 is merged implementation evidence; contract review remains open. |

## Unresolved Questions

- Which exact browser/device class and network/cache profiles should define an
  accepted campaign?
- Which `prettyM` inputs and Illuminate traces best represent real use rather
  than benchmark convenience?
- What user-visible thresholds for time to first result, warm latency, size,
  and memory would change a product choice?
- Who independently owns or reviews the comparison protocol and campaigns?
- Can Illuminate be promoted from local rehearsal to a canonical frozen
  artifact set?

## Post-Meeting Promotion Checklist

- [x] Update `docs/PRODUCT.md` with accepted user and product-boundary changes
      if any; no boundary change was recorded from the presentation.
- [x] Update `docs/ALTERNATIVES.md` with the accepted comparison contract.
- [ ] Update `docs/UPSTREAMING.md` with upstream feedback.
- [ ] Update `docs/MAINTENANCE.md` with named roles and operating agreements.
- [x] Add durable choices to `docs/DECISIONS.md`.
- [x] Update no more than eight active action cards.
- [ ] Record required binding ownership and lifecycle behavior for each named
      pilot before creating feature work.
- [ ] Preserve disagreements and rejected proposals in this meeting record.
