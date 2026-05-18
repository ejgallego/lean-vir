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
