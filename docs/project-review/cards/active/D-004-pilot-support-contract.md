# D-004 — Define the pilot support contract

Type: Deliver
Status: Proposed
Owner: Unassigned
Contributors: None
Milestone: Pilot readiness
Created: 2026-08-04
Related: [product boundary](../../../PRODUCT.md),
[maintenance](../../../MAINTENANCE.md), [roadmap](../../ROADMAP.md)

## Outcome Sought

A pilot user can tell what VIR supports, what is experimental, who controls
the input packages, and what information is required when reporting a failure.

## Why Now

The trusted-package and synchronous-runtime limits are documented deeply but
can be missed in the quick consumption path. Management support for
productization makes an explicit support contract more important, not less.

## Scope

- State the trusted, project-generated package boundary prominently.
- State the one-active-package-set, synchronous host-import, supported-type, and
  compatibility limits.
- Label binding and lifecycle behavior as validated development use, under
  design, supported, or out of scope; do not use “experimental” as a blanket.
- Define release ownership, response expectations, and escalation contacts.
- Define the minimum useful bug report.
- Do not imply isolation for arbitrary uploaded packages.

## Done When

- The quickstart and pilot guide carry the concise trust warning.
- The support matrix distinguishes supported, experimental, and out of scope.
- A bug template requests Lean commit, SDK version, package report, browser,
  reproduction, and minimal source.
- `PRODUCT.md` and `MAINTENANCE.md` are the canonical contract sources.
- A pilot owner reviews the contract before integration begins.

## Dependencies

- [C-001](C-001-productization-ownership.md)
- [L-003](L-003-binding-lifecycle-semantics.md) supplies the binding and
  lifecycle boundary before a release contract is finalized.

## Evidence

The review's malformed-package checks validate the manifest boundary but do
not establish safe execution of untrusted IR packages.

## Closure

Completed: Not yet
Result: Not yet recorded
Unexpected findings: None recorded
Follow-up cards: None
Durable documents updated: None
