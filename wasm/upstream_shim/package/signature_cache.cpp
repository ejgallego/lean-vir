/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "signature_cache.h"

#include "decl_provider.h"
#include "call_signature_summary.h"

#include <stddef.h>
#include <stdint.h>

#include <vector>

namespace lean {
namespace {

struct cached_signature {
    uint32_t package_generation = 0;
    uint32_t slot = UINT32_MAX;
    char const * data = nullptr;
    uint32_t size = 0;
    bool is_io = false;
    package_call_signature signature;
};

static std::vector<cached_signature> g_package_call_signature_cache;

package_call_signature decode_package_call_signature(
    char const * data,
    uint32_t size,
    bool is_io) {
    vir_call_signature_payload payload = decode_call_signature_payload(
        data,
        size,
        "missing package call signature",
        "trailing bytes after package call signature");
    if (!payload.ok) {
        return { false, payload.error, 0, is_io, false };
    }
    return { true, "", payload.arg_count, is_io, payload.needs_boxed_wasm32_boundary };
}

} // namespace

package_call_signature const * cached_package_call_signature(uint32_t slot) {
    char const * data = vir::package_call_signature(slot);
    if (data == nullptr) {
        return nullptr;
    }
    uint32_t size = vir::package_call_signature_size(slot);
    bool is_io = vir::package_call_is_io(slot);
    uint32_t generation = vir::package_generation();
    size_t index = slot - 1;
    if (index >= g_package_call_signature_cache.size()) {
        g_package_call_signature_cache.resize(index + 1);
    }
    cached_signature & cached = g_package_call_signature_cache[index];
    if (
        cached.package_generation == generation &&
        cached.slot == slot &&
        cached.data == data &&
        cached.size == size &&
        cached.is_io == is_io) {
        return &cached.signature;
    }
    cached.package_generation = generation;
    cached.slot = slot;
    cached.data = data;
    cached.size = size;
    cached.is_io = is_io;
    cached.signature = decode_package_call_signature(data, size, is_io);
    return &cached.signature;
}

}
