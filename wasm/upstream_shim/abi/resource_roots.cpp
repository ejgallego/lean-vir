/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "resource_roots.h"
#include <stddef.h>
#include <stdlib.h>

// Clang's table extension requires the declaration at translation-unit scope.
static __externref_t roots[0];

namespace {
struct slot { uint32_t next; bool live; };
static slot * slots = nullptr;
static uint32_t metadata_capacity = 0;
static uint32_t table_capacity = 0;
static uint32_t free_head = 0;
static uint32_t active = 0;
static bool closed = false;

// Grow metadata before publishing new table slots. A failed table grow leaves
// the old free list and roots intact; any spare metadata can serve a retry.
static bool grow() {
    constexpr uint32_t chunk = 64;
    size_t limit = SIZE_MAX / sizeof(slot);
    if (limit > UINT32_MAX) limit = UINT32_MAX;
    if (table_capacity >= limit) return false;
    uint32_t extra = limit - table_capacity < chunk ? limit - table_capacity : chunk;
    uint32_t capacity = table_capacity + extra;
    if (metadata_capacity < capacity) {
        void * allocation = realloc(slots, static_cast<size_t>(capacity) * sizeof(slot));
        if (allocation == nullptr) return false;
        slots = static_cast<slot *>(allocation);
        metadata_capacity = capacity;
    }
    auto previous = __builtin_wasm_table_grow(roots, __builtin_wasm_ref_null_extern(), extra);
    if (previous == static_cast<decltype(previous)>(-1)) return false;
    // Only this module mutates the unexported table. Reserve table index zero.
    uint32_t first = table_capacity == 0 ? 1 : table_capacity;
    for (uint32_t id = capacity; id-- > first;) {
        slots[id] = {free_head, false};
        free_head = id;
    }
    table_capacity = capacity;
    return true;
}
}

extern "C" uint32_t vir_resource_root(__externref_t value) {
    if (closed || (free_head == 0 && !grow())) return 0;
    uint32_t id = free_head;
    free_head = slots[id].next;
    slots[id].live = true;
    __builtin_wasm_table_set(roots, id, value);
    ++active;
    return id;
}

extern "C" __externref_t vir_resource_get(uint32_t id) {
    if (closed || id == 0 || id >= table_capacity || !slots[id].live)
        return __builtin_wasm_ref_null_extern();
    return __builtin_wasm_table_get(roots, id);
}

extern "C" void vir_resource_release(uint32_t id) {
    if (closed || id == 0 || id >= table_capacity || !slots[id].live) return;
    __builtin_wasm_table_set(roots, id, __builtin_wasm_ref_null_extern());
    slots[id].live = false;
    slots[id].next = free_head;
    free_head = id;
    --active;
}

extern "C" void vir_resource_roots_clear() {
    // Works even after an interpreter trap: table operations and fixed
    // linear-memory addresses, with no heap access, allocation or callbacks.
    closed = true;
    __builtin_wasm_table_fill(roots, 0, __builtin_wasm_ref_null_extern(),
                             __builtin_wasm_table_size(roots));
    active = 0;
    free_head = 0;
}

extern "C" uint32_t vir_resource_roots_active() { return active; }
extern "C" uint32_t vir_resource_roots_capacity() { return table_capacity == 0 ? 0 : table_capacity - 1; }
extern "C" uint32_t vir_resource_roots_reusable() {
    return closed ? 0 : vir_resource_roots_capacity() - active;
}
