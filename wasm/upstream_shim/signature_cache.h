/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include "interface_codec.h"

#include <stdint.h>

#include <string>
#include <vector>

namespace lean {

struct host_signature {
    bool ok = false;
    std::string error;
    std::vector<vir_type> args;
    vir_type result { vir_wire_type::Unit, {} };
    bool is_io = false;
};

host_signature decode_signature_bytes(
    char const * data,
    uint32_t size,
    bool is_io,
    char const * missing_message,
    char const * trailing_message);

host_signature const * cached_host_signature(uint32_t slot);
host_signature const * cached_package_call_signature(uint32_t slot);

}
