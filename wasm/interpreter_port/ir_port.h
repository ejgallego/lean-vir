#ifndef VIR_INTERPRETER_PORT_IR_PORT_H
#define VIR_INTERPRETER_PORT_IR_PORT_H

typedef unsigned char vir_u8;
typedef unsigned int vir_u32;
typedef __SIZE_TYPE__ vir_size_t;

enum VirIrType : vir_u8 {
  VIR_TYPE_UINT8 = 1,
  VIR_TYPE_TAGGED = 2,
  VIR_TYPE_TOBJECT = 3
};

enum VirArgKind : vir_u8 {
  VIR_ARG_VAR = 1,
  VIR_ARG_ERASED = 2
};

struct VirArg {
  VirArgKind kind;
  vir_u8 var;
};

enum VirFunId : vir_u8 {
  VIR_FN_NONE = 0,
  VIR_FN_FIB = 1,
  VIR_FN_NAT_DEC_EQ = 2,
  VIR_FN_NAT_SUB = 3,
  VIR_FN_NAT_ADD = 4
};

enum VirExprKind : vir_u8 {
  VIR_EXPR_LIT_NAT = 1,
  VIR_EXPR_FAP = 2
};

struct VirExpr {
  VirExprKind kind;
  VirFunId fn;
  VirArg args[2];
  vir_u8 arg_count;
  vir_u32 nat_value;
};

enum VirBodyKind : vir_u8 {
  VIR_BODY_VDECL = 1,
  VIR_BODY_DEC = 2,
  VIR_BODY_CASE = 3,
  VIR_BODY_RET = 4,
  VIR_BODY_UNREACHABLE = 5
};

struct VirFnBody;

struct VirAlt {
  vir_u32 ctor_index;
  const VirFnBody *body;
};

struct VirFnBody {
  VirBodyKind kind;
  vir_u8 var;
  VirIrType type;
  const VirExpr *expr;
  const VirFnBody *next;
  vir_u8 case_var;
  const VirAlt *alts;
  vir_u8 alt_count;
  VirArg ret;
};

struct VirParam {
  vir_u8 var;
  VirIrType type;
  vir_u8 borrow;
};

struct VirDecl {
  VirFunId fn;
  const VirParam *params;
  vir_u8 param_count;
  VirIrType result_type;
  const VirFnBody *body;
};

#endif

