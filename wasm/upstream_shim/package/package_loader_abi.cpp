/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "decl_provider.h"

#include <stdint.h>
#include <stdlib.h>

extern "C" void * vir_alloc_bytes(uint32_t size) {
    return malloc(size == 0 ? 1 : size);
}

extern "C" void vir_free_bytes(void * ptr) {
    free(ptr);
}

extern "C" uint32_t vir_begin_ir_package_set(void) {
    return lean::vir::begin_package_set() ? 1 : 0;
}

extern "C" uint32_t vir_append_ir_package(uint8_t const * data, uint32_t size) {
    if (!lean::vir::append_package(data, size)) {
        return 0;
    }
    return lean::vir::package_decl_count();
}

extern "C" uint32_t vir_prepare_ir_package_set(void) {
    if (!lean::vir::prepare_package_set()) {
        return 0;
    }
    return 1;
}

extern "C" uint32_t vir_finish_ir_package_set(void) {
    if (!lean::vir::finish_package_set()) {
        lean::vir::clear_loaded_package();
        return 0;
    }
    return lean::vir::package_decl_count();
}

extern "C" void vir_abort_ir_package_set(void) {
    lean::vir::clear_loaded_package();
}

extern "C" char const * vir_last_package_error(void) {
    return lean::vir::last_package_error();
}

extern "C" uint32_t vir_last_package_error_size(void) {
    return lean::vir::last_package_error_size();
}

extern "C" char const * vir_package_interface_manifest(void) {
    return lean::vir::package_interface_manifest();
}

extern "C" uint32_t vir_package_interface_manifest_size(void) {
    return lean::vir::package_interface_manifest_size();
}

extern "C" uint32_t vir_package_decl_count(void) {
    return lean::vir::package_decl_count();
}

extern "C" uint32_t vir_package_format_version(void) {
    return lean::vir::package_format_version();
}
