/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include <cstdlib>

#include "runtime/object.h"

extern "C" double lean_float_of_nat(lean_obj_arg a) {
    double result = lean_is_scalar(a) ?
        static_cast<double>(lean_unbox(a)) :
        std::strtod(lean::mpz_value(a).to_string().c_str(), nullptr);
    lean_dec(a);
    return result;
}

extern "C" float lean_float32_of_nat(lean_obj_arg a) {
    float result = lean_is_scalar(a) ?
        static_cast<float>(lean_unbox(a)) :
        std::strtof(lean::mpz_value(a).to_string().c_str(), nullptr);
    lean_dec(a);
    return result;
}

