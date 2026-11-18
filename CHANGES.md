# unreleased
------------------------------

 - [lean] Support Lean 4.37.0-rc1 with a matching browser runtime and SDK.

 - [runtime] Prepare a verified runtime before opening owned programs from in-memory
   package bytes, sharing callable-contract validation, cancellation and disposal
   with URL loading. Preparation and byte creation use explicit cancellation;
   URL acquisition keeps its deadline (#278).
 - [lean] Support Lean 4.36.0 with a matching browser runtime and SDK.

# VIR v4.36.0-rc2
------------------------------

 - [lean] Support Lean 4.36.0-rc2, with matching browser runtime and SDK.
 - [runtime] Support byte-array size, mutation and equality, Float conversion
   and minimum/maximum, and proof-bearing character construction (#270).

# VIR v4.36.0-rc1
------------------------------

 - [lean] Support Lean 4.36.0-rc1 (#266).
 - [packages] Adapt package extraction to Lean's updated compiler metadata and
   reject unsupported spill-based interpreter instructions (#266).
 - [tests] Retain complete resource-test output and check expected diagnostics
   and timeout behavior (#266).
