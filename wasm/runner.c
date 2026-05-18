typedef unsigned int vir_u32;
typedef unsigned char vir_u8;
typedef __SIZE_TYPE__ vir_size_t;

#include "fib_ir_fixture.h"

void _start(void) {}

static vir_u32 nat_sub(vir_u32 a, vir_u32 b) {
  return a >= b ? a - b : 0;
}

static vir_u32 run_fib_ir(vir_u32 input) {
  vir_u32 vars[12];
  vir_u32 pc = 0;

  for (vir_u32 i = 0; i <= VIR_FIB_MAX_VAR; i += 1) {
    vars[i] = 0;
  }
  vars[1] = input;

  for (;;) {
    const struct vir_instr instr = VIR_FIB_PROGRAM[pc];
    switch (instr.op) {
    case VIR_OP_CONST:
      vars[instr.dst] = instr.imm;
      pc += 1;
      break;
    case VIR_OP_NAT_DEC_EQ:
      vars[instr.dst] = vars[instr.a] == vars[instr.b] ? 1 : 0;
      pc += 1;
      break;
    case VIR_OP_BRANCH:
      pc = vars[instr.a] ? instr.t : instr.f;
      break;
    case VIR_OP_NAT_SUB:
      vars[instr.dst] = nat_sub(vars[instr.a], vars[instr.b]);
      pc += 1;
      break;
    case VIR_OP_CALL:
      vars[instr.dst] = run_fib_ir(vars[instr.a]);
      pc += 1;
      break;
    case VIR_OP_NAT_ADD:
      vars[instr.dst] = vars[instr.a] + vars[instr.b];
      pc += 1;
      break;
    case VIR_OP_RETURN:
      return vars[instr.a];
    default:
      return 0xffffffffu;
    }
  }
}

__attribute__((visibility("default"))) vir_u32 vir_fib(vir_u32 input) {
  return run_fib_ir(input);
}

__attribute__((visibility("default"))) vir_u32 vir_target_pointer_bytes(void) {
  return (vir_u32)sizeof(void *);
}

__attribute__((visibility("default"))) vir_u32 vir_target_size_t_bytes(void) {
  return (vir_u32)sizeof(vir_size_t);
}

__attribute__((visibility("default"))) vir_u32 vir_target_layout_ok(void) {
  return sizeof(void *) == 4 && sizeof(vir_size_t) == 4;
}

