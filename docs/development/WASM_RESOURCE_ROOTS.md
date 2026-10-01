# Wasm-owned resource roots

The resource allocator keeps the Lean external wrapper and exact JavaScript
identity, but replaces JavaScript slot allocation with an unexported Wasm
externref table and an
intrusive free list in linear memory. There is one allocator. Reference values
never become linear-memory bytes; liveness metadata distinguishes live `null`
and `undefined` from free slots.

`vir_resource_root/get/release` become local C++ operations, removing their
three JS function imports. `vir_js_call_objects` and required WASI imports stay.
Host-call transactions, active host bindings, callback/JSL ownership, private
32-bit IDs and one instance per generation retain their existing roles.

## Allocation and retirement

Metadata grows ahead of the table in chunks of 64 slots. Metadata failure
returns root zero. Table-growth failure leaves old live roots/free links intact;
spare metadata can be reused on retry. Releasing a live root nulls the table
entry and links its slot into the free list without allocation. Numeric IDs are
private: a reused ID is not a public generation-tagged handle.

Four new low-level exports provide terminal clearing and active/capacity/reusable
counts. Clearing sets the manager closed, fills the table with null, and resets
fixed counters. It does not traverse/free metadata, release Lean objects, call
host functions or enter the interpreter. The current wasm32 optimized object
contains no calls or stack-pointer access in this function. Metadata and table
capacity remain with the abandoned instance until its collection.

The runtime failure guard permits these four narrow operations after a trap.
Other failed-generation entry remains blocked and Lean heap cleanup remains a
no-op. Repeated disposal is harmless; closed instances cannot root new values.
Normal host teardown still precedes terminal clearing. Whole unreachable
generations remain collectable with the same weak global finalizer metadata.

## Qualification and limits

`npm run test:resource-roots` uses the actual allocator source with test-only
failure injection. `npm run test:runtime:pure` includes integrated identity,
ownership/churn, Promise and two-instance checks, real trap retirement, payload
collection while the runtime remains owned, and whole-generation GC. Existing
fatal/host-error and Node/Chromium lifetime suites remain integration gates.

This changes the low-level Wasm import/export surface and requires a matching
runtime/artifact pair. It does not change the package wire format or enable
wasm64. The compiled clear-path claim applies to the inspected optimized build;
other compiler/profile configurations need the same inspection and tests.

The allocator failure/reuse suite runs in both `npm test` and CI. The integrated
runtime suite also verifies that the production module imports none of the
three former root-management functions and exports no mutable table. These
checks establish the transport and lifetime behavior; size and latency must be
measured separately before making performance claims.

Host service ownership remains separate from the resource table. Preconstructed
user/default binding maps belong to the application; a default-provider builder
transfers its fresh result to the runtime. Disposal attempts fresh-provider
cleanup before clearing table roots, and still clears the table if that cleanup
throws, including after a fatal trap. It drops the host state's map references
without invoking application-owned disposers.
