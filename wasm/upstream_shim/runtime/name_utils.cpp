/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "name_utils.h"

#include <stdint.h>

#include <string>

#include "runtime/utf8.h"

extern "C" uint8_t l_Lean_isIdFirst(uint32_t c);
extern "C" uint8_t l_Lean_isIdRest(uint32_t c);

namespace lean {

namespace {

constexpr char anonymous_name[] = "[anonymous]";

bool equal_bytes(char const * lhs, size_t lhs_len, char const * rhs, size_t rhs_len) {
    if (lhs_len != rhs_len) {
        return false;
    }
    for (size_t i = 0; i < lhs_len; i++) {
        if (lhs[i] != rhs[i]) {
            return false;
        }
    }
    return true;
}

bool valid_utf8(char const * text, size_t len) {
    size_t pos = 0;
    auto bytes = reinterpret_cast<uint8_t const *>(text);
    while (pos < len) {
        if (!validate_utf8_one(bytes, len, pos)) {
            return false;
        }
    }
    return true;
}

bool all_ascii_digits(char const * text, size_t len) {
    if (len == 0) {
        return false;
    }
    for (size_t i = 0; i < len; i++) {
        if (text[i] < '0' || text[i] > '9') {
            return false;
        }
    }
    return true;
}

bool valid_identifier_component(char const * text, size_t len) {
    if (len == 0 || all_ascii_digits(text, len)) {
        return false;
    }
    size_t pos = 0;
    if (!l_Lean_isIdFirst(next_utf8(text, len, pos))) {
        return false;
    }
    while (pos < len) {
        if (!l_Lean_isIdRest(next_utf8(text, len, pos))) {
            return false;
        }
    }
    return true;
}

} // namespace

bool is_supported_dotted_name(char const * text, size_t len) {
    if (text == nullptr) {
        return len == 0;
    }
    // Keep the historical empty spelling as an explicit anonymous Name and
    // accept the spelling emitted by Name.toString for lifted anonymous names.
    if (len == 0 || equal_bytes(text, len, anonymous_name, sizeof(anonymous_name) - 1)) {
        return true;
    }
    if (!valid_utf8(text, len)) {
        return false;
    }
    size_t start = 0;
    while (start < len) {
        size_t end = start;
        while (end < len && text[end] != '.') {
            end++;
        }
        if (!valid_identifier_component(text + start, end - start)) {
            return false;
        }
        if (end == len) {
            return true;
        }
        start = end + 1;
    }
    return false;
}

bool is_supported_name(name const & value) {
    for (name current = value; !current.is_anonymous(); current = current.get_prefix()) {
        if (!current.is_string()) {
            return false;
        }
        std::string component = current.get_string().to_std_string();
        if (!valid_utf8(component.data(), component.size()) ||
            !valid_identifier_component(component.data(), component.size())) {
            return false;
        }
    }
    return true;
}

name name_from_dotted(char const * text, size_t len) {
    name current;
    if (len == 0 || equal_bytes(text, len, anonymous_name, sizeof(anonymous_name) - 1)) {
        return current;
    }
    size_t start = 0;
    while (start < len) {
        size_t end = start;
        while (end < len && text[end] != '.') {
            end++;
        }
        std::string part(text + start, end - start);
        current = name(current, part.c_str());
        if (end == len) {
            break;
        }
        start = end + 1;
    }
    return current;
}

} // namespace lean
