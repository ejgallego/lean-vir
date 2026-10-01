# Supported inputs and review assumptions

VIR assumes cooperative users and developers following its documented workflows.
Packages are trusted executable artifacts produced by the supported compiler and
tools. Editing artifacts through unsupported interfaces has undefined behavior.
VIR is not a hostile-program admission service or a proof checker for generated IR.

This is the shared review baseline for VIR and its integrations. Consumer-specific
policies belong to the consumer; changing a shared contract requires an explicit
handoff and agreement before either project implements against it.

## What must work

Following the instructions must produce a compatible, usable program. Review
against ordinary failures as well as the happy path:

- Configuration typos, missing prerequisites and independently compiled
  producer/consumer disagreement should fail with useful diagnostics.
- Lake-returned artifacts are authoritative, including cached/relocated private
  implementation artifacts. An unchanged path is not an unchanged implementation.
- Acquisition selects the requested identity, never a fallback revision or an
  implicit Wasm source build. Interrupted transfers/installs must not advertise a
  complete artifact. Accidental byte corruption must not become a successful load.
- Published inventories must materialize without collisions and remain portable.
  Derive inventory, ownership, lengths and digests from the producer's result.
- Normal asynchronous races, cancellation, disposal and failure recovery must
  preserve ownership. Error reporting must not replace the original failure.
- Live editor snapshots retain their authoritative unsaved environment; compiled
  acquisition must not silently replace it with saved files.

Atomic installation and avoiding writes through Lake cache hard links address
ordinary build correctness, not an adversarial filesystem. Preserve these rules
when simplifying acquisition or publication.

## What checks mean

Validate at a boundary where an actual fact can differ: configuration admission,
acquired/persisted bytes, independently compiled contracts, or runtime ownership.
Inside a trusted pipeline, prefer deriving metadata once and reusing a typed
result to repeatedly parsing, hashing and checking the same result.

A digest identifies bytes and detects accidental corruption; it does not prove
publisher authenticity, compiler provenance, callable types or program behavior.
An internally consistent bundle can still be the wrong selected program or have
a different callable contract. Consumer expectations must therefore be independent
of the artifact being loaded. Semantic/native/browser oracle tests establish
behavior for their tested cases, not a general proof.

Reserve **Lean soundness** for logical/kernel guarantees. State artifact
consistency, ABI agreement, memory/ownership correctness and execution admission
separately. Accepting a manually forged container is not, by itself, a Lean
soundness defect. A private constructor only guarantees the facts its constructor
actually establishes, not whatever the name “checked” or “verified” suggests.

Do not add production checks solely for malicious JSON, hostile path replacement,
forged manifests or arbitrary executable IR. Existing rejection tests can describe
current behavior without expanding the supported threat model. Retain numeric
representation/format bounds and operational limits with a concrete justification;
application work budgets belong at the application boundary.

## How to review and change behavior

1. Identify the supported workflow and authoritative input for the finding. If it
   requires unsupported artifact manipulation, label it as such rather than
   treating it as a product blocker.
2. Reproduce an inferred defect before changing behavior. Prefer a small real
   producer/consumer case over a new harness or broad validation framework.
3. Keep entry points thin over canonical acquisition, analysis and encoding.
   Preserve distinct capabilities such as explicit selection, library-owned
   resources, live snapshots and runtime production; do not duplicate their core.
4. Preserve interfaces and byte identities during internal refactoring. A digest,
   format, callable contract or lifetime change needs explicit migration review;
   no aliases or fallback versions simply to make an integration pass.
5. Record exact source/runtime identities and distinguish inspected code, locally
   executed tests, CI and consumer-reported acceptance. Do not reuse old-head
   evidence as qualification of changed behavior.

Use Lean/Lake's existing non-cryptographic hashes for internal build traces. The
current published formats specify SHA-256, shared across native and browser
consumers; this is an interoperability choice, not an adversarial-security claim.
Do not silently put a weaker hash in a field specified as `sha256`. Prefer a
supported upstream digest implementation when available over maintaining local
algorithm code or adding a configurable hashing framework.
