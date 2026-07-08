/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "call_signature_summary.h"

#include <stdint.h>

#include <string>

namespace lean {
namespace {

enum class interface_type_tag : uint8_t {
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

enum class field_layout_kind : uint8_t {
    Object = 0,
    USize = 1,
    Scalar = 2,
};

class signature_reader {
    uint8_t const * m_data;
    uint32_t m_size;
    uint32_t m_pos = 0;
    std::string m_error;

public:
    bool ok = true;

    signature_reader(uint8_t const * data, uint32_t size):
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

static bool is_known_interface_type_tag(interface_type_tag tag) {
    switch (tag) {
    case interface_type_tag::Unit:
    case interface_type_tag::Nat:
    case interface_type_tag::Int:
    case interface_type_tag::Bool:
    case interface_type_tag::String:
    case interface_type_tag::UInt8:
    case interface_type_tag::UInt16:
    case interface_type_tag::UInt32:
    case interface_type_tag::UInt64:
    case interface_type_tag::USize:
    case interface_type_tag::ByteArray:
    case interface_type_tag::Float:
    case interface_type_tag::Float32:
    case interface_type_tag::Array:
    case interface_type_tag::List:
    case interface_type_tag::Option:
    case interface_type_tag::Prod:
    case interface_type_tag::Structure:
    case interface_type_tag::TaggedUnion:
    case interface_type_tag::CustomInductive:
    case interface_type_tag::RecursiveSelf:
    case interface_type_tag::SimpleEnum:
    case interface_type_tag::Resource:
    case interface_type_tag::Function:
    case interface_type_tag::Expr:
        return true;
    default:
        return false;
    }
}

static bool is_known_field_layout(field_layout_kind kind) {
    switch (kind) {
    case field_layout_kind::Object:
    case field_layout_kind::USize:
    case field_layout_kind::Scalar:
        return true;
    default:
        return false;
    }
}

static void decode_field_layout(signature_reader & r) {
    field_layout_kind kind = static_cast<field_layout_kind>(r.u8());
    r.u32();
    r.u32();
    r.u32();
    if (!is_known_field_layout(kind)) {
        r.fail("unsupported structure field layout tag " + std::to_string(static_cast<uint8_t>(kind)));
    }
}

static void decode_runtime_counts(signature_reader & r) {
    r.u32();
    r.u32();
    r.u32();
}

static bool decode_type_needs_boxed_wasm32_boundary(signature_reader & r);

static bool decode_field_descriptor_needs_boxed_wasm32_boundary(signature_reader & r) {
    decode_field_layout(r);
    return decode_type_needs_boxed_wasm32_boundary(r);
}

static bool decode_type_needs_boxed_wasm32_boundary(signature_reader & r) {
    interface_type_tag tag = static_cast<interface_type_tag>(r.u8());
    if (!is_known_interface_type_tag(tag)) {
        r.fail("unsupported interface type tag " + std::to_string(static_cast<uint8_t>(tag)));
        return false;
    }
    switch (tag) {
    case interface_type_tag::Float:
    case interface_type_tag::Float32:
    case interface_type_tag::UInt64:
        return true;
    case interface_type_tag::Array:
    case interface_type_tag::List:
    case interface_type_tag::Option:
        decode_type_needs_boxed_wasm32_boundary(r);
        return false;
    case interface_type_tag::Prod:
        decode_type_needs_boxed_wasm32_boundary(r);
        decode_type_needs_boxed_wasm32_boundary(r);
        return false;
    case interface_type_tag::Structure: {
        decode_runtime_counts(r);
        uint32_t trivial_field = r.u32();
        uint32_t field_count = r.u32();
        bool needs_boxed = false;
        for (uint32_t i = 0; i < field_count; i++) {
            bool field_needs_boxed = decode_field_descriptor_needs_boxed_wasm32_boundary(r);
            if (i == trivial_field) {
                needs_boxed = field_needs_boxed;
            }
        }
        if (trivial_field != UINT32_MAX && trivial_field >= field_count) {
            r.fail("structure trivial field index is out of range");
        }
        return trivial_field == UINT32_MAX ? false : needs_boxed;
    }
    case interface_type_tag::TaggedUnion: {
        uint32_t variant_count = r.u32();
        for (uint32_t i = 0; i < variant_count; i++) {
            decode_runtime_counts(r);
            decode_field_descriptor_needs_boxed_wasm32_boundary(r);
        }
        if (variant_count == 0) {
            r.fail("tagged union has no constructors");
        }
        return false;
    }
    case interface_type_tag::CustomInductive: {
        uint32_t variant_count = r.u32();
        for (uint32_t i = 0; i < variant_count; i++) {
            decode_runtime_counts(r);
            uint32_t field_count = r.u32();
            for (uint32_t j = 0; j < field_count; j++) {
                decode_field_descriptor_needs_boxed_wasm32_boundary(r);
            }
        }
        if (variant_count == 0) {
            r.fail("custom inductive has no constructors");
        }
        return false;
    }
    case interface_type_tag::Function: {
        r.u8();
        uint32_t arg_count = r.u32();
        for (uint32_t i = 0; i < arg_count; i++) {
            decode_type_needs_boxed_wasm32_boundary(r);
        }
        decode_type_needs_boxed_wasm32_boundary(r);
        return false;
    }
    default:
        return false;
    }
}

} // namespace

vir_call_signature_payload decode_call_signature_payload(
    char const * data,
    uint32_t size,
    char const * missing_message,
    char const * trailing_message) {
    if (data == nullptr) {
        return { false, missing_message, 0, false };
    }
    signature_reader reader(reinterpret_cast<uint8_t const *>(data), size);
    uint32_t argc = reader.u32();
    bool needs_boxed_boundary = false;
    for (uint32_t i = 0; i < argc; i++) {
        needs_boxed_boundary =
            decode_type_needs_boxed_wasm32_boundary(reader) || needs_boxed_boundary;
    }
    needs_boxed_boundary =
        decode_type_needs_boxed_wasm32_boundary(reader) || needs_boxed_boundary;
    if (!reader.ok) {
        return { false, reader.error(), 0, false };
    }
    if (!reader.at_end()) {
        return { false, trailing_message, 0, false };
    }
    return { true, "", argc, needs_boxed_boundary };
}

} // namespace lean
