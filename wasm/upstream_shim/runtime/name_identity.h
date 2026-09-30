/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include <string>
#include <vector>
#include "util/name.h"

namespace lean::vir {

// Keep the canonical key aligned with Vir.nameKey (Vir/LeanName.lean).
// No display escaping, dot splitting or numeric narrowing participates.
inline std::string name_key(name const & value) {
    std::vector<name> parts;
    for (name n = value; n; n = n.get_prefix()) parts.push_back(n);
    static constexpr char hex[] = "0123456789abcdef";
    std::string result;
    for (auto it = parts.rbegin(); it != parts.rend(); ++it) {
        if (it->is_string()) {
            result += 's';
            for (unsigned char byte : it->get_string().to_std_string()) {
                result += hex[byte >> 4];
                result += hex[byte & 15];
            }
        } else {
            result += 'n';
            result += it->get_numeral().to_std_string();
        }
        result += '/';
    }
    return result;
}

} // namespace lean::vir
