/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include "interface_codec.h"

#include <stdint.h>

#include <string>
#include <utility>

namespace lean {

static bool is_known_wire_type(vir_wire_type tag) {
    switch (tag) {
    case vir_wire_type::Unit:
    case vir_wire_type::Nat:
    case vir_wire_type::Int:
    case vir_wire_type::Bool:
    case vir_wire_type::String:
    case vir_wire_type::UInt8:
    case vir_wire_type::UInt16:
    case vir_wire_type::UInt32:
    case vir_wire_type::UInt64:
    case vir_wire_type::USize:
    case vir_wire_type::ByteArray:
    case vir_wire_type::Float:
    case vir_wire_type::Float32:
    case vir_wire_type::Array:
    case vir_wire_type::List:
    case vir_wire_type::Option:
    case vir_wire_type::Prod:
    case vir_wire_type::Structure:
    case vir_wire_type::TaggedUnion:
    case vir_wire_type::CustomInductive:
    case vir_wire_type::RecursiveSelf:
    case vir_wire_type::SimpleEnum:
    case vir_wire_type::Resource:
    case vir_wire_type::Function:
    case vir_wire_type::Expr:
        return true;
    default:
        return false;
    }
}

static bool is_known_field_layout(vir_field_layout_kind kind) {
    switch (kind) {
    case vir_field_layout_kind::Object:
    case vir_field_layout_kind::USize:
    case vir_field_layout_kind::Scalar:
        return true;
    default:
        return false;
    }
}

static vir_field_layout decode_field_layout(vir_reader & r) {
    vir_field_layout layout {
        static_cast<vir_field_layout_kind>(r.u8()),
        r.u32(),
        r.u32(),
        r.u32(),
    };
    if (!is_known_field_layout(layout.kind)) {
        r.fail("unsupported structure field layout tag " + std::to_string(static_cast<uint8_t>(layout.kind)));
    }
    return layout;
}

static void encode_field_layout(vir_writer & w, vir_field_layout const & layout) {
    w.u8(static_cast<uint8_t>(layout.kind));
    w.u32(layout.index);
    w.u32(layout.size);
    w.u32(layout.offset);
}

static vir_variant decode_variant_runtime_counts(vir_reader & r) {
    vir_variant variant;
    variant.object_fields = r.u32();
    variant.usize_fields = r.u32();
    variant.scalar_bytes = r.u32();
    return variant;
}

static void encode_variant_runtime_counts(vir_writer & w, vir_variant const & variant) {
    w.u32(variant.object_fields);
    w.u32(variant.usize_fields);
    w.u32(variant.scalar_bytes);
}

static void decode_field_descriptors(
    vir_reader & r,
    uint32_t field_count,
    std::vector<vir_type> & fields,
    std::vector<vir_field_layout> & layouts) {
    fields.reserve(field_count);
    layouts.reserve(field_count);
    for (uint32_t i = 0; i < field_count; i++) {
        layouts.push_back(decode_field_layout(r));
        fields.push_back(decode_type(r));
    }
}

static void encode_field_descriptors(
    vir_writer & w,
    std::vector<vir_type> const & fields,
    std::vector<vir_field_layout> const & layouts) {
    for (size_t i = 0; i < fields.size(); i++) {
        encode_field_layout(w, layouts[i]);
        encode_type(w, fields[i]);
    }
}

vir_type decode_type(vir_reader & r) {
    vir_type type { static_cast<vir_wire_type>(r.u8()), {} };
    if (!is_known_wire_type(type.tag)) {
        r.fail("unsupported wire type tag " + std::to_string(static_cast<uint8_t>(type.tag)));
        return { vir_wire_type::Nat, {} };
    }
    switch (type.tag) {
    case vir_wire_type::Array:
    case vir_wire_type::List:
    case vir_wire_type::Option:
        type.args.push_back(decode_type(r));
        break;
    case vir_wire_type::Prod:
        type.args.push_back(decode_type(r));
        type.args.push_back(decode_type(r));
        break;
    case vir_wire_type::Structure: {
        type.object_fields = r.u32();
        type.usize_fields = r.u32();
        type.scalar_bytes = r.u32();
        type.trivial_field = r.u32();
        uint32_t field_count = r.u32();
        decode_field_descriptors(r, field_count, type.args, type.field_layouts);
        if (type.trivial_field != UINT32_MAX && type.trivial_field >= field_count) {
            r.fail("structure trivial field index is out of range");
        }
        break;
    }
    case vir_wire_type::TaggedUnion: {
        uint32_t variant_count = r.u32();
        type.variants.reserve(variant_count);
        for (uint32_t i = 0; i < variant_count; i++) {
            vir_variant variant = decode_variant_runtime_counts(r);
            decode_field_descriptors(r, 1, variant.fields, variant.field_layouts);
            type.variants.push_back(std::move(variant));
        }
        if (variant_count == 0) {
            r.fail("tagged union has no constructors");
        }
        break;
    }
    case vir_wire_type::CustomInductive: {
        uint32_t variant_count = r.u32();
        type.variants.reserve(variant_count);
        for (uint32_t i = 0; i < variant_count; i++) {
            vir_variant variant = decode_variant_runtime_counts(r);
            uint32_t field_count = r.u32();
            decode_field_descriptors(r, field_count, variant.fields, variant.field_layouts);
            type.variants.push_back(std::move(variant));
        }
        if (variant_count == 0) {
            r.fail("custom inductive has no constructors");
        }
        break;
    }
    case vir_wire_type::Function: {
        type.is_io = r.u8() != 0;
        uint32_t arg_count = r.u32();
        type.args.reserve(arg_count + 1);
        for (uint32_t i = 0; i < arg_count; i++) {
            type.args.push_back(decode_type(r));
        }
        type.args.push_back(decode_type(r));
        break;
    }
    default:
        break;
    }
    return type;
}

void encode_type(vir_writer & w, vir_type const & type) {
    w.u8(static_cast<uint8_t>(type.tag));
    switch (type.tag) {
    case vir_wire_type::Array:
    case vir_wire_type::List:
    case vir_wire_type::Option:
        encode_type(w, type.args[0]);
        break;
    case vir_wire_type::Prod:
        encode_type(w, type.args[0]);
        encode_type(w, type.args[1]);
        break;
    case vir_wire_type::Structure:
        w.u32(type.object_fields);
        w.u32(type.usize_fields);
        w.u32(type.scalar_bytes);
        w.u32(type.trivial_field);
        w.u32(static_cast<uint32_t>(type.args.size()));
        encode_field_descriptors(w, type.args, type.field_layouts);
        break;
    case vir_wire_type::TaggedUnion:
        w.u32(static_cast<uint32_t>(type.variants.size()));
        for (vir_variant const & variant : type.variants) {
            encode_variant_runtime_counts(w, variant);
            encode_field_descriptors(w, variant.fields, variant.field_layouts);
        }
        break;
    case vir_wire_type::CustomInductive:
        w.u32(static_cast<uint32_t>(type.variants.size()));
        for (vir_variant const & variant : type.variants) {
            encode_variant_runtime_counts(w, variant);
            w.u32(static_cast<uint32_t>(variant.fields.size()));
            encode_field_descriptors(w, variant.fields, variant.field_layouts);
        }
        break;
    case vir_wire_type::Function:
        w.u8(type.is_io ? 1 : 0);
        w.u32(type.args.empty() ? 0 : static_cast<uint32_t>(type.args.size() - 1));
        for (size_t i = 0; i + 1 < type.args.size(); i++) {
            encode_type(w, type.args[i]);
        }
        if (!type.args.empty()) {
            encode_type(w, type.args.back());
        }
        break;
    default:
        break;
    }
}

bool needs_boxed_wasm32_call_boundary_type(vir_type const & type) {
    if (
        type.tag == vir_wire_type::Float ||
        type.tag == vir_wire_type::Float32 ||
        type.tag == vir_wire_type::UInt64) {
        return true;
    }
    if (type.tag == vir_wire_type::Structure && type.trivial_field != UINT32_MAX) {
        return needs_boxed_wasm32_call_boundary_type(type.args[type.trivial_field]);
    }
    return false;
}

name name_from_dotted(char const * text, size_t len) {
    name current;
    size_t start = 0;
    while (start <= len) {
        size_t end = start;
        while (end < len && text[end] != '.') {
            end++;
        }
        if (end > start) {
            std::string part(text + start, end - start);
            current = name(current, part.c_str());
        }
        if (end == len) {
            break;
        }
        start = end + 1;
    }
    return current;
}

} // namespace lean
