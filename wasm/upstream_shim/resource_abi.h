/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include <stdint.h>

#include "runtime/object.h"

namespace lean {

object * vir_resource_object_from_externref(__externref_t value);
uint32_t vir_resource_root_id(object * value);
__externref_t vir_resource_externref(object * value);

}
