/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

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

struct vir_arg {
    object * value = nullptr;
    bool owned = true;
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
            fail("unexpected end of call payload");
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

    uint64_t u64() {
        uint64_t lo = u32();
        uint64_t hi = u32();
        return lo | (hi << 32);
    }

    double f64() {
        uint64_t bits = u64();
        double value = 0.0;
        memcpy(&value, &bits, sizeof(value));
        return value;
    }

    float f32() {
        uint32_t bits = u32();
        float value = 0.0f;
        memcpy(&value, &bits, sizeof(value));
        return value;
    }

    std::string string() {
        uint32_t len = u32();
        if (!ok) return std::string();
        if (len > m_size - m_pos) {
            fail("string length exceeds remaining call payload");
            return std::string();
        }
        std::string out(reinterpret_cast<char const *>(m_data + m_pos), len);
        m_pos += len;
        return out;
    }

    std::vector<uint8_t> bytes() {
        uint32_t len = u32();
        if (!ok) return {};
        if (len > m_size - m_pos) {
            fail("byte array length exceeds remaining call payload");
            return {};
        }
        std::vector<uint8_t> out(m_data + m_pos, m_data + m_pos + len);
        m_pos += len;
        return out;
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

class vir_writer {
    std::string m_bytes;
    std::string m_error;

public:
    bool ok = true;

    std::string const & error() const {
        return m_error;
    }

    void fail(std::string const & message) {
        if (ok) {
            ok = false;
            m_error = message;
        }
    }

    void u8(uint8_t value) {
        if (!ok) return;
        m_bytes.push_back(static_cast<char>(value));
    }

    void u32(uint32_t value) {
        if (!ok) return;
        m_bytes.push_back(static_cast<char>(value & 0xff));
        m_bytes.push_back(static_cast<char>((value >> 8) & 0xff));
        m_bytes.push_back(static_cast<char>((value >> 16) & 0xff));
        m_bytes.push_back(static_cast<char>((value >> 24) & 0xff));
    }

    void u64(uint64_t value) {
        u32(static_cast<uint32_t>(value & 0xffffffff));
        u32(static_cast<uint32_t>(value >> 32));
    }

    void f64(double value) {
        uint64_t bits = 0;
        memcpy(&bits, &value, sizeof(bits));
        u64(bits);
    }

    void f32(float value) {
        uint32_t bits = 0;
        memcpy(&bits, &value, sizeof(bits));
        u32(bits);
    }

    void string(std::string const & value) {
        if (!ok) return;
        u32(static_cast<uint32_t>(value.size()));
        m_bytes.append(value);
    }

    void bytes(uint8_t const * ptr, uint32_t len) {
        if (!ok) return;
        u32(len);
        if (len != 0) {
            m_bytes.append(reinterpret_cast<char const *>(ptr), len);
        }
    }

    std::string take() {
        return std::move(m_bytes);
    }
};

name name_from_dotted(char const * text, size_t len);
vir_type decode_type(vir_reader & r);
void encode_type(vir_writer & w, vir_type const & type);
object * decode_value(vir_reader & r, vir_type const & type, vir_type const * self_type = nullptr);
void encode_value_payload(vir_writer & w, vir_type const & type, object * value, vir_type const * self_type = nullptr);
vir_arg decode_argument(vir_reader & r, bool has_boxed_decl);
bool needs_boxed_wasm32_call_boundary_type(vir_type const & type);
void encode_result(vir_writer & w, vir_type const & type, object * value, bool has_boxed_decl);
bool call_result_is_owned(vir_type const & type, bool has_boxed_decl);
bool same_wire_type(vir_type const & lhs, vir_type const & rhs);

}
