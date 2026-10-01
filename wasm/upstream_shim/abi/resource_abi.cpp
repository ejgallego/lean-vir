/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "resource_abi.h"

#include <stdint.h>

#include "runtime/object.h"

#if !defined(__wasm32__)
#error "VIR resource payload encoding requires wasm32"
#endif

static_assert(sizeof(uintptr_t) >= sizeof(uint32_t), "resource root ID must fit in the opaque payload");

extern "C" uint32_t vir_resource_root(__externref_t value);
extern "C" __externref_t vir_resource_get(uint32_t root_id);
extern "C" void vir_resource_release(uint32_t root_id);

namespace lean {
namespace {

// The opaque external payload carries the root ID directly, widened through
// uintptr_t. It is never a pointer to dereference; zero remains invalid.
static void * encode_root_id(uint32_t root_id) {
    return reinterpret_cast<void *>(static_cast<uintptr_t>(root_id));
}

static uint32_t decode_root_id(void * payload) {
    return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(payload));
}

static lean_external_class * g_vir_resource_external_class = nullptr;

static void vir_resource_finalize(void * data) {
    uint32_t root_id = decode_root_id(data);
    if (root_id != 0) {
        vir_resource_release(root_id);
    }
}

static lean_external_class * vir_resource_external_class() {
    if (g_vir_resource_external_class == nullptr) {
        g_vir_resource_external_class = lean_register_external_class(vir_resource_finalize, nullptr);
    }
    return g_vir_resource_external_class;
}

} // namespace

object * vir_resource_object_from_externref(__externref_t value) {
    lean_external_class * cls = vir_resource_external_class();
    uint32_t root_id = vir_resource_root(value);
    if (root_id == 0) {
        return nullptr;
    }
    // lean_alloc_external follows Lean's fatal OOM policy, not a recoverable
    // allocation failure. No separate payload allocation follows root acquisition.
    return lean_alloc_external(cls, encode_root_id(root_id));
}

uint32_t vir_resource_root_id(object * value) {
    if (g_vir_resource_external_class == nullptr || !lean_is_external(value) ||
        lean_get_external_class(value) != g_vir_resource_external_class) {
        return 0;
    }
    return decode_root_id(lean_get_external_data(value));
}

__externref_t vir_resource_externref(object * value) {
    uint32_t root_id = vir_resource_root_id(value);
    return root_id == 0 ? __builtin_wasm_ref_null_extern() : vir_resource_get(root_id);
}

bool vir_resource_is_valid(object * value) {
    return vir_resource_root_id(value) != 0;
}

}
