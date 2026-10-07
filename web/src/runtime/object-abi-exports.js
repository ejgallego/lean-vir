/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const OBJECT_ABI_CALL_EXPORTS = [
  "vir_resolve_call_export",
  "vir_call_resolved_objects",
  "vir_call_error",
  "vir_call_error_size",
  "vir_closure_call_objects",
  "vir_closure_call_error",
  "vir_closure_call_error_size",
  "vir_closure_release",
];

export const OBJECT_VALUE_EXPORTS = [
  "vir_obj_array",
  "vir_obj_array_get",
  "vir_obj_array_size",
  "vir_obj_byte_array",
  "vir_obj_byte_array_data",
  "vir_obj_byte_array_size",
  "vir_obj_ctor",
  "vir_obj_ctor_layout",
  "vir_obj_ctor_scalar_data",
  "vir_obj_closure_root",
  "vir_obj_dec",
  "vir_obj_decimal_size",
  "vir_obj_expr_app",
  "vir_obj_expr_bvar",
  "vir_obj_expr_const",
  "vir_obj_expr_forall",
  "vir_obj_expr_fvar",
  "vir_obj_expr_lambda",
  "vir_obj_expr_let",
  "vir_obj_expr_lit",
  "vir_obj_expr_mvar",
  "vir_obj_expr_proj",
  "vir_obj_expr_scalar_u8",
  "vir_obj_expr_sort",
  "vir_obj_field",
  "vir_obj_float",
  "vir_obj_float_value",
  "vir_obj_float32",
  "vir_obj_float32_value",
  "vir_obj_inc",
  "vir_obj_int",
  "vir_obj_int_decimal",
  "vir_obj_level_imax",
  "vir_obj_level_max",
  "vir_obj_level_mvar",
  "vir_obj_level_param",
  "vir_obj_level_succ",
  "vir_obj_level_zero",
  "vir_obj_literal_nat",
  "vir_obj_literal_string",
  "vir_obj_name_string",
  "vir_obj_name_string_size",
  "vir_obj_resource",
  "vir_obj_resource_externref",
  "vir_obj_resource_is_valid",
  "vir_obj_nat",
  "vir_obj_nat_decimal",
  "vir_obj_is_scalar",
  "vir_obj_scalar",
  "vir_obj_scalar_value",
  "vir_obj_string",
  "vir_obj_string_data",
  "vir_obj_string_size",
  "vir_obj_tag",
  "vir_obj_uint32",
  "vir_obj_uint32_value",
  "vir_obj_uint64_scalar",
  "vir_obj_uint64_value",
  "vir_obj_usize_scalar",
  "vir_obj_usize_value",
];

// These operations do not enter the Lean heap and remain callable on retirement.
export const RESOURCE_ROOT_EXPORTS = [
  "vir_resource_roots_clear",
  "vir_resource_roots_active",
  "vir_resource_roots_capacity",
  "vir_resource_roots_reusable",
];

export const OBJECT_ABI_EXPORTS = [
  ...OBJECT_ABI_CALL_EXPORTS,
  ...OBJECT_VALUE_EXPORTS,
  ...RESOURCE_ROOT_EXPORTS,
];
