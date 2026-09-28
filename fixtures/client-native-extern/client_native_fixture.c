#include <lean/lean.h>

LEAN_EXPORT uint32_t vir_client_native_increment(uint32_t value) {
    return value + 1;
}

LEAN_EXPORT uint32_t vir_client_native_quoted_dot(uint32_t value) {
    return value + 110;
}

LEAN_EXPORT uint32_t vir_client_native_quoted_numeral(uint32_t value) {
    return value + 120;
}

LEAN_EXPORT uint32_t vir_client_native_cafe(uint32_t value) {
    return value + 130;
}
