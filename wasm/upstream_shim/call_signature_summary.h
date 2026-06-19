/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include <stdint.h>

#include <string>

namespace lean {

struct vir_call_signature_payload {
    bool ok = false;
    std::string error;
    uint32_t arg_count = 0;
    bool needs_boxed_wasm32_boundary = false;
};

vir_call_signature_payload decode_call_signature_payload(
    char const * data,
    uint32_t size,
    char const * missing_message,
    char const * trailing_message);

}
