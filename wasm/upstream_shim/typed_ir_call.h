/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include <stddef.h>
#include <stdint.h>

#include "library/elab_environment.h"
#include "runtime/object.h"
#include "util/name.h"
#include "util/options.h"

namespace lean::ir {

enum class typed_call_tag : uint8_t {
    Object = 0,
    UInt8 = 1,
    UInt16 = 2,
    UInt32 = 3,
    UInt64 = 4,
    USize = 5,
    Float = 6,
    Float32 = 7,
};

struct typed_call_value {
    typed_call_tag tag = typed_call_tag::Object;
    object * object_value = nullptr;
    uint64_t uint64_value = 0;
    size_t usize_value = 0;
    double float_value = 0;
    float float32_value = 0;
};

bool run_typed(
    elab_environment const & env,
    options const & opts,
    name const & fn,
    unsigned argc,
    typed_call_value const * args,
    typed_call_value * result);

}
