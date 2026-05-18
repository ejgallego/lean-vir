#pragma once

#include <stdint.h>

#include "runtime/object.h"

namespace lean::vir {

object * find_static_decl(object * name);
object * find_static_boxed_decl(object * name);
uint32_t static_decl_count();

}
