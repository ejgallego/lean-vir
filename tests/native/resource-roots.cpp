/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

/* Test the actual allocator with deterministic failures, without production hooks. */
#include <stdlib.h>
#include <stdint.h>
static bool fail_metadata = false;
static bool fail_growth = false;
static void * checked_realloc(void * ptr, size_t size) {
    return fail_metadata ? nullptr : realloc(ptr, size);
}
#define realloc checked_realloc
#define __builtin_wasm_table_grow(table, value, delta) \
    (fail_growth ? -1 : __builtin_wasm_table_grow(table, value, delta))
#include "../../wasm/upstream_shim/abi/resource_roots.cpp"
#undef realloc
#undef __builtin_wasm_table_grow
extern "C" void test_fail_metadata(uint32_t value) { fail_metadata = value != 0; }
extern "C" void test_fail_growth(uint32_t value) { fail_growth = value != 0; }
extern "C" void test_trap() { __builtin_trap(); }
