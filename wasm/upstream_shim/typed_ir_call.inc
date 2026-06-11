/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

namespace lean::ir {

static char const * typed_call_type_name(type t) {
    switch (t) {
    case type::Float: return "Float";
    case type::Float32: return "Float32";
    case type::UInt8: return "UInt8";
    case type::UInt16: return "UInt16";
    case type::UInt32: return "UInt32";
    case type::UInt64: return "UInt64";
    case type::USize: return "USize";
    case type::Object: return "Object";
    case type::TObject: return "TObject";
    case type::Tagged: return "Tagged";
    case type::Irrelevant: return "Irrelevant";
    case type::Void: return "Void";
    case type::Struct: return "Struct";
    case type::Union: return "Union";
    }
    lean_unreachable();
}

static bool typed_call_tag_for_type(type t, typed_call_tag & tag) {
    switch (t) {
    case type::Float:
        tag = typed_call_tag::Float;
        return true;
    case type::Float32:
        tag = typed_call_tag::Float32;
        return true;
    case type::UInt8:
        tag = typed_call_tag::UInt8;
        return true;
    case type::UInt16:
        tag = typed_call_tag::UInt16;
        return true;
    case type::UInt32:
        tag = typed_call_tag::UInt32;
        return true;
    case type::UInt64:
        tag = typed_call_tag::UInt64;
        return true;
    case type::USize:
        tag = typed_call_tag::USize;
        return true;
    case type::Object:
    case type::Tagged:
    case type::TObject:
        tag = typed_call_tag::Object;
        return true;
    case type::Irrelevant:
    case type::Void:
    case type::Struct:
    case type::Union:
        return false;
    }
    lean_unreachable();
}

static value typed_call_value_to_ir_value(typed_call_value const & v) {
    switch (v.tag) {
    case typed_call_tag::Object: return v.object_value;
    case typed_call_tag::UInt8:
    case typed_call_tag::UInt16:
    case typed_call_tag::UInt32:
    case typed_call_tag::UInt64:
        return v.uint64_value;
    case typed_call_tag::USize:
        return static_cast<uint64>(v.usize_value);
    case typed_call_tag::Float:
        return value::from_float(v.float_value);
    case typed_call_tag::Float32:
        return value::from_float32(v.float32_value);
    }
    lean_unreachable();
}

static void typed_call_value_from_ir_value(value v, type t, typed_call_value & out) {
    typed_call_tag tag;
    if (!typed_call_tag_for_type(t, tag)) {
        throw exception(sstream() << "typed IR call result type " << typed_call_type_name(t) << " is not supported");
    }
    out.tag = tag;
    switch (tag) {
    case typed_call_tag::Object:
        out.object_value = v.m_obj;
        return;
    case typed_call_tag::UInt8:
    case typed_call_tag::UInt16:
    case typed_call_tag::UInt32:
    case typed_call_tag::UInt64:
        out.uint64_value = v.m_num;
        return;
    case typed_call_tag::USize:
        out.usize_value = static_cast<size_t>(v.m_num);
        return;
    case typed_call_tag::Float:
        out.float_value = v.m_float;
        return;
    case typed_call_tag::Float32:
        out.float32_value = v.m_float32;
        return;
    }
    lean_unreachable();
}

static bool typed_call_arguments_supported(decl const & d) {
    for (param const & p : decl_params(d)) {
        typed_call_tag tag;
        if (!typed_call_tag_for_type(param_type(p), tag)) {
            return false;
        }
    }
    typed_call_tag result_tag;
    return typed_call_tag_for_type(decl_type(d), result_tag);
}

bool run_typed(
    elab_environment const & env,
    options const & opts,
    name const & fn,
    unsigned argc,
    typed_call_value const * args,
    typed_call_value * result) {
    return interpreter::with_interpreter<bool>(env, opts, fn, [&](interpreter & interp) {
        interpreter::symbol_cache_entry e = interp.lookup_symbol(fn);
        if (e.m_native.m_addr || decl_tag(e.m_decl) == decl_kind::Extern) {
            return false;
        }
        if (!typed_call_arguments_supported(e.m_decl)) {
            return false;
        }

        array_ref<param> const & params = decl_params(e.m_decl);
        if (params.size() != argc) {
            return false;
        }
        for (size_t i = 0; i < params.size(); i++) {
            typed_call_tag expected;
            lean_always_assert(typed_call_tag_for_type(param_type(params[i]), expected));
            if (args[i].tag != expected) {
                return false;
            }
        }

        size_t old_size = interp.m_arg_stack.size();
        for (size_t i = 0; i < params.size(); i++) {
            interp.m_arg_stack.push_back(typed_call_value_to_ir_value(args[i]));
        }
        interp.push_frame(e.m_decl, old_size);
        value r = interp.eval_body(decl_fun_body(e.m_decl));
        type result_type = decl_type(e.m_decl);
        interp.pop_frame(r, result_type);

        for (size_t i = 0; i < params.size(); i++) {
            if (args[i].tag == typed_call_tag::Object && param_borrow(params[i])) {
                dec(args[i].object_value);
            }
        }
        typed_call_value_from_ir_value(r, result_type, *result);
        return true;
    });
}

}
