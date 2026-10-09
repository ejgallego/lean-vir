/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once
#include <stdint.h>

// IDs stay private to the resource bridge. Externrefs live in the Wasm table,
// never in linear-memory objects. Root zero means allocation failed.
extern "C" uint32_t vir_resource_root(__externref_t value);
extern "C" __externref_t vir_resource_get(uint32_t root_id);
extern "C" void vir_resource_release(uint32_t root_id);

// Terminal instance retirement, not an allocator reset. Metadata remains in
// the abandoned arena; this path never enters Lean or walks allocation records.
extern "C" void vir_resource_roots_clear();
extern "C" uint32_t vir_resource_roots_active();
extern "C" uint32_t vir_resource_roots_capacity();
extern "C" uint32_t vir_resource_roots_reusable();
