/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "resource_abi.h"

#include <stdint.h>

#include "runtime/object.h"

extern "C" uint32_t vir_resource_root(__externref_t value);
extern "C" __externref_t vir_resource_get(uint32_t root_id);
extern "C" void vir_resource_release(uint32_t root_id);

namespace lean {
namespace {

struct vir_resource_data {
    uint32_t root_id = 0;
};

static lean_external_class * g_vir_resource_external_class = nullptr;

static void vir_resource_finalize(void * data) {
    vir_resource_data * resource = static_cast<vir_resource_data *>(data);
    if (resource != nullptr) {
        if (resource->root_id != 0) {
            vir_resource_release(resource->root_id);
        }
        delete resource;
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
    uint32_t root_id = vir_resource_root(value);
    if (root_id == 0) {
        return nullptr;
    }
    return lean_alloc_external(vir_resource_external_class(), new vir_resource_data{root_id});
}

uint32_t vir_resource_root_id(object * value) {
    if (!lean_is_external(value) || lean_get_external_class(value) != vir_resource_external_class()) {
        return 0;
    }
    vir_resource_data * resource = static_cast<vir_resource_data *>(lean_get_external_data(value));
    if (resource == nullptr || resource->root_id == 0) {
        return 0;
    }
    return resource->root_id;
}

__externref_t vir_resource_externref(object * value) {
    uint32_t root_id = vir_resource_root_id(value);
    return root_id == 0 ? __builtin_wasm_ref_null_extern() : vir_resource_get(root_id);
}

}
