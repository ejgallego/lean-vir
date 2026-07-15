/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include <stddef.h>

#include <string>
#include <vector>

#include "library/ir_types.h"
#include "runtime/object.h"

namespace lean::vir::package_ir {

using ir::type;

// Every builder consumes each `object *` argument and returns one owned result.
// `mk_array` likewise consumes every object stored in `fields`.
object * mk_name_str(object * prefix, std::string const & part);
object * mk_name_num(object * prefix, size_t value);
object * mk_array(std::vector<object *> const & fields);
object * mk_arg_var(size_t var);
object * mk_arg_erased();
object * mk_lit_num(object * value);
object * mk_lit_num(size_t value);
object * mk_lit_str(std::string const & value);
object * mk_ctor_info(object * n, size_t tag, size_t size = 0, size_t usize = 0, size_t ssize = 0);
object * mk_ctor_expr(object * ctor_info, object * args);
object * mk_reset(size_t n, size_t var);
object * mk_reuse(size_t var, object * ctor_info, bool update_header, object * args);
object * mk_proj(size_t idx, size_t var);
object * mk_uproj(size_t idx, size_t var);
object * mk_sproj(size_t idx, size_t offset, size_t var);
object * mk_fap(object * fn, object * args);
object * mk_pap(object * fn, object * args);
object * mk_ap(size_t var, object * args);
object * mk_box(type t, size_t var);
object * mk_unbox(size_t var);
object * mk_is_shared(size_t var);
object * mk_param(size_t var, type t, bool borrow);
object * mk_ctor_alt(object * ctor_info, object * body);
object * mk_default_alt(object * body);
object * mk_vdecl(size_t var, type var_type, object * expr, object * cont);
object * mk_jdecl(size_t jp, object * params, object * body, object * cont);
object * mk_set(size_t target, size_t idx, object * arg, object * cont);
object * mk_set_tag(size_t target, size_t tag, object * cont);
object * mk_uset(size_t target, size_t idx, size_t source, object * cont);
object * mk_sset(size_t target, size_t idx, size_t offset, size_t source, type t, object * cont);
object * mk_inc(size_t var, size_t amount, bool maybe_scalar, bool persistent, object * cont);
object * mk_dec(size_t var, size_t amount, bool maybe_scalar, bool persistent, object * cont);
object * mk_del(size_t var, object * cont);
object * mk_case(object * type_name, size_t var, type var_type, object * alts);
object * mk_ret(object * arg);
object * mk_jmp(size_t jp, object * args);
object * mk_unreachable();
object * mk_fun_decl(object * fn, object * params, type result_type, object * body);
object * mk_extern_decl(object * fn, object * params, type result_type);

}
