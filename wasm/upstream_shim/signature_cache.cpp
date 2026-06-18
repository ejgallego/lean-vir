/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "signature_cache.h"

#include "decl_provider.h"

#include <stddef.h>
#include <stdint.h>

#include <string>
#include <vector>

namespace lean {
namespace {

struct cached_signature {
    uint32_t package_generation = 0;
    uint32_t slot = UINT32_MAX;
    char const * data = nullptr;
    uint32_t size = 0;
    bool is_io = false;
    host_signature signature;
};

static std::vector<cached_signature> g_host_signature_cache;
static std::vector<cached_signature> g_package_call_signature_cache;

static host_signature decode_host_signature(uint32_t slot) {
    return decode_signature_bytes(
        vir::host_import_signature(slot),
        vir::host_import_signature_size(slot),
        vir::host_import_is_io(slot),
        "missing JavaScript import signature",
        "trailing bytes after JavaScript import signature");
}

static host_signature decode_package_call_signature(
    char const * data,
    uint32_t size,
    bool is_io) {
    return decode_signature_bytes(
        data,
        size,
        is_io,
        "missing package call signature",
        "trailing bytes after package call signature");
}

} // namespace

host_signature decode_signature_bytes(
    char const * data,
    uint32_t size,
    bool is_io,
    char const * missing_message,
    char const * trailing_message) {
    if (data == nullptr) {
        return { false, missing_message, {}, { vir_wire_type::Unit, {} }, is_io };
    }
    vir_reader reader(reinterpret_cast<uint8_t const *>(data), size);
    uint32_t argc = reader.u32();
    std::vector<vir_type> args;
    args.reserve(argc);
    for (uint32_t i = 0; i < argc; i++) {
        args.push_back(decode_type(reader));
    }
    vir_type result = decode_type(reader);
    if (!reader.ok) {
        return { false, reader.error(), {}, { vir_wire_type::Unit, {} }, is_io };
    }
    if (!reader.at_end()) {
        return { false, trailing_message, {}, { vir_wire_type::Unit, {} }, is_io };
    }
    return { true, "", args, result, is_io };
}

host_signature const * cached_host_signature(uint32_t slot) {
    char const * data = vir::host_import_signature(slot);
    uint32_t size = vir::host_import_signature_size(slot);
    bool is_io = vir::host_import_is_io(slot);
    uint32_t generation = vir::package_generation();
    if (slot >= g_host_signature_cache.size()) {
        g_host_signature_cache.resize(slot + 1);
    }
    cached_signature & cached = g_host_signature_cache[slot];
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
    cached.signature = decode_host_signature(slot);
    return &cached.signature;
}

host_signature const * cached_package_call_signature(uint32_t slot) {
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
