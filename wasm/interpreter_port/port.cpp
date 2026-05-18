#include "ir_port.h"
#include "fib_ir_tree_fixture.h"

extern "C" void _start(void) {}

struct VirValue {
  vir_u32 num;
};

struct VirFrame {
  VirValue vars[12];
};

static const vir_u8 kPreferNative = 0;

static void *lookup_native_symbol(VirFunId) {
  return 0;
}

static VirValue mk_value(vir_u32 value) {
  VirValue out = { value };
  return out;
}

static VirValue eval_decl(const VirDecl *decl, const VirValue *args, vir_u8 arg_count);

static VirValue eval_arg(const VirArg *arg, VirFrame *frame) {
  if (arg->kind == VIR_ARG_VAR && arg->var < 12) {
    return frame->vars[arg->var];
  }
  return mk_value(0);
}

static vir_u32 nat_sub(vir_u32 a, vir_u32 b) {
  return a >= b ? a - b : 0;
}

static VirValue call_builtin(VirFunId fn, const VirExpr *expr, VirFrame *frame) {
  VirValue a = expr->arg_count > 0 ? eval_arg(&expr->args[0], frame) : mk_value(0);
  VirValue b = expr->arg_count > 1 ? eval_arg(&expr->args[1], frame) : mk_value(0);

  switch (fn) {
  case VIR_FN_FIB:
    return eval_decl(&VIR_FIB_DECL, &a, 1);
  case VIR_FN_NAT_DEC_EQ:
    return mk_value(a.num == b.num ? 1 : 0);
  case VIR_FN_NAT_SUB:
    return mk_value(nat_sub(a.num, b.num));
  case VIR_FN_NAT_ADD:
    return mk_value(a.num + b.num);
  case VIR_FN_NONE:
  default:
    return mk_value(0xffffffffu);
  }
}

static VirValue eval_expr(const VirExpr *expr, VirFrame *frame) {
  switch (expr->kind) {
  case VIR_EXPR_LIT_NAT:
    return mk_value(expr->nat_value);
  case VIR_EXPR_FAP:
    if (kPreferNative && lookup_native_symbol(expr->fn)) {
      return mk_value(0xffffffffu);
    }
    return call_builtin(expr->fn, expr, frame);
  default:
    return mk_value(0xffffffffu);
  }
}

static const VirFnBody *select_alt(const VirFnBody *body, vir_u32 ctor_index) {
  for (vir_u8 i = 0; i < body->alt_count; i += 1) {
    if (body->alts[i].ctor_index == ctor_index) {
      return body->alts[i].body;
    }
  }
  return 0;
}

static VirValue eval_body(const VirFnBody *body, VirFrame *frame) {
  const VirFnBody *cursor = body;
  for (;;) {
    switch (cursor->kind) {
    case VIR_BODY_VDECL:
      frame->vars[cursor->var] = eval_expr(cursor->expr, frame);
      cursor = cursor->next;
      break;
    case VIR_BODY_DEC:
      cursor = cursor->next;
      break;
    case VIR_BODY_CASE: {
      vir_u32 ctor_index = frame->vars[cursor->case_var].num ? 1 : 0;
      const VirFnBody *selected = select_alt(cursor, ctor_index);
      if (!selected) {
        return mk_value(0xffffffffu);
      }
      cursor = selected;
      break;
    }
    case VIR_BODY_RET:
      return eval_arg(&cursor->ret, frame);
    case VIR_BODY_UNREACHABLE:
    default:
      return mk_value(0xffffffffu);
    }
  }
}

static VirValue eval_decl(const VirDecl *decl, const VirValue *args, vir_u8 arg_count) {
  VirFrame frame = {};
  vir_u8 count = arg_count < decl->param_count ? arg_count : decl->param_count;

  for (vir_u8 i = 0; i < count; i += 1) {
    frame.vars[decl->params[i].var] = args[i];
  }

  return eval_body(decl->body, &frame);
}

extern "C" __attribute__((visibility("default"))) vir_u32 vir_fib(vir_u32 input) {
  VirValue arg = mk_value(input);
  return eval_decl(&VIR_FIB_DECL, &arg, 1).num;
}

extern "C" __attribute__((visibility("default"))) vir_u32 vir_target_pointer_bytes(void) {
  return (vir_u32)sizeof(void *);
}

extern "C" __attribute__((visibility("default"))) vir_u32 vir_target_size_t_bytes(void) {
  return (vir_u32)sizeof(vir_size_t);
}

extern "C" __attribute__((visibility("default"))) vir_u32 vir_target_layout_ok(void) {
  return sizeof(void *) == 4 && sizeof(vir_size_t) == 4;
}

extern "C" __attribute__((visibility("default"))) vir_u32 vir_interpreter_port_enabled(void) {
  return 1;
}

