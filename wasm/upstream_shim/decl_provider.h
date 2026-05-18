#pragma once

#include <stddef.h>
#include <stdint.h>

#include "runtime/object.h"

namespace lean::vir {

object * find_static_decl(object * name);
object * find_static_boxed_decl(object * name);
object * mk_static_nat(size_t value);
size_t static_nat_to_usize(object * value);
uint32_t static_decl_count();

}

extern "C" void * vir_alloc_bytes(uint32_t size);
extern "C" void vir_free_bytes(void * ptr);
extern "C" uint32_t vir_load_ir_package(uint8_t const * data, uint32_t size);
extern "C" char const * vir_last_package_error(void);
extern "C" uint32_t vir_last_package_error_size(void);
