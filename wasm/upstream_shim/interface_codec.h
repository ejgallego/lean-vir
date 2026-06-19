/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include <stddef.h>
#include <stdint.h>

#include <string>
#include <vector>

#include "runtime/object.h"
#include "util/name.h"

namespace lean {

enum class vir_wire_type : uint8_t {
    Unit = 22,
    Nat = 0,
    Int = 1,
    Bool = 2,
    String = 3,
    UInt8 = 4,
    UInt16 = 5,
    UInt32 = 6,
    UInt64 = 7,
    USize = 8,
    ByteArray = 9,
    Float = 10,
    Float32 = 11,
    Array = 16,
    List = 17,
    Option = 18,
    Prod = 19,
    Structure = 20,
    TaggedUnion = 21,
    Resource = 23,
    Function = 24,
    CustomInductive = 25,
    RecursiveSelf = 26,
    SimpleEnum = 14,
    Expr = 15,
};

enum class vir_field_layout_kind : uint8_t {
    Object = 0,
    USize = 1,
    Scalar = 2,
};

struct vir_field_layout {
    vir_field_layout_kind kind;
    uint32_t index;
    uint32_t size;
    uint32_t offset;
};

struct vir_type;

struct vir_variant {
    std::vector<vir_type> fields;
    std::vector<vir_field_layout> field_layouts;
    uint32_t object_fields = 0;
    uint32_t usize_fields = 0;
    uint32_t scalar_bytes = 0;
};

struct vir_type {
    vir_wire_type tag;
    std::vector<vir_type> args;
    std::vector<vir_field_layout> field_layouts;
    std::vector<vir_variant> variants;
    uint32_t object_fields = 0;
    uint32_t usize_fields = 0;
    uint32_t scalar_bytes = 0;
    uint32_t trivial_field = UINT32_MAX;
    bool is_io = false;
};

class vir_reader {
    uint8_t const * m_data;
    uint32_t m_size;
    uint32_t m_pos = 0;
    std::string m_error;

public:
    bool ok = true;

    vir_reader(uint8_t const * data, uint32_t size):
        m_data(data),
        m_size(size) {
    }

    std::string const & error() const {
        return m_error;
    }

    uint8_t u8() {
        if (!ok) return 0;
        if (m_pos >= m_size) {
            fail("unexpected end of signature payload");
            return 0;
        }
        return m_data[m_pos++];
    }

    uint32_t u32() {
        uint32_t b0 = u8();
        uint32_t b1 = u8();
        uint32_t b2 = u8();
        uint32_t b3 = u8();
        return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    }

    bool at_end() const {
        return m_pos == m_size;
    }

    void fail(std::string const & message) {
        if (ok) {
            ok = false;
            m_error = message;
        }
    }
};

name name_from_dotted(char const * text, size_t len);
vir_type decode_type(vir_reader & r);
bool needs_boxed_wasm32_call_boundary_type(vir_type const & type);

}
