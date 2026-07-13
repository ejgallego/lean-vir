/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include <stdint.h>
#include <stdio.h>
#include <time.h>

typedef struct lean_object lean_object;

extern "C" uint32_t vir_load_ir_package(uint8_t const * data, uint32_t size);
extern "C" uint32_t vir_last_package_error_size(void);
extern "C" char const * vir_last_package_error(void);
extern "C" uint32_t vir_resolve_call_export(uint32_t export_index);
extern "C" lean_object * vir_call_resolved_objects(uint32_t call_slot, lean_object ** argv, uint32_t argc);
extern "C" char const * vir_call_error(void);
extern "C" uint32_t vir_call_error_size(void);
extern "C" lean_object * vir_obj_nat(char const * text, uint32_t len);
extern "C" char const * vir_obj_nat_decimal(lean_object * value);
extern "C" uint32_t vir_obj_decimal_size(void);
extern "C" lean_object * vir_obj_array(lean_object ** values, uint32_t len);
extern "C" void vir_obj_dec(lean_object * value);

extern "C" lean_object * vir_js_call_objects(uint32_t slot, lean_object ** argv, uint32_t argc) {
    (void) argv;
    (void) argc;
    fprintf(stderr, "unexpected JavaScript host import call in engine benchmark: slot %u\n", slot);
    return nullptr;
}

extern "C" uint32_t vir_resource_root(__externref_t value) {
    (void) value;
    return 0;
}

extern "C" __externref_t vir_resource_get(uint32_t root_id) {
    (void) root_id;
    return __builtin_wasm_ref_null_extern();
}

extern "C" void vir_resource_release(uint32_t root_id) {
    (void) root_id;
}

#include "vir_fixtures_basic_package.inc"

static bool g_benchmark_failed = false;
static uint32_t g_fib_slot = 0;
static uint32_t g_sort_slot = 0;
// These indices follow the export order of the embedded fixtures-basic package.
static constexpr uint32_t fib_export_index = 0;
static constexpr uint32_t sort_export_index = 2;

static uint64_t monotonic_nanos() {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ULL + static_cast<uint64_t>(ts.tv_nsec);
}

static void print_sample(char const * label, uint32_t iterations, uint32_t checksum, uint64_t elapsed_ns) {
    printf("engine-bench %s %u %u %llu\n",
        label,
        iterations,
        checksum,
        static_cast<unsigned long long>(elapsed_ns));
}

static void expect_checksum(char const * label, uint32_t checksum, uint32_t expected) {
    if (checksum != expected) {
        fprintf(stderr, "%s checksum mismatch: expected %u, got %u\n", label, expected, checksum);
        g_benchmark_failed = true;
    }
}

static lean_object * make_nat(uint32_t value) {
    char text[16];
    int len = snprintf(text, sizeof(text), "%u", value);
    return vir_obj_nat(text, static_cast<uint32_t>(len));
}

static uint32_t parse_nat_result(lean_object * result) {
    char const * data = vir_obj_nat_decimal(result);
    uint32_t len = vir_obj_decimal_size();
    if (data == nullptr || len == 0) {
        fprintf(stderr, "invalid Nat result object\n");
        return 0;
    }
    uint32_t value = 0;
    for (uint32_t i = 0; i < len; i++) {
        char c = data[i];
        if (c < '0' || c > '9') {
            fprintf(stderr, "invalid Nat result digit\n");
            return 0;
        }
        value = value * 10 + static_cast<uint32_t>(c - '0');
    }
    return value;
}

static uint32_t resolve_call_slot(uint32_t export_index, char const * name) {
    uint32_t slot = vir_resolve_call_export(export_index);
    if (slot == 0) {
        uint32_t error_len = vir_call_error_size();
        fprintf(stderr, "vir_resolve_call_export(%u, %s) failed", export_index, name);
        if (error_len != 0) {
            fprintf(stderr, ": %.*s", static_cast<int>(error_len), vir_call_error());
        }
        fprintf(stderr, "\n");
        g_benchmark_failed = true;
    }
    return slot;
}

static uint32_t call_nat_resolved(uint32_t slot, char const * name, lean_object ** args, uint32_t argc) {
    lean_object * result = vir_call_resolved_objects(slot, args, argc);
    if (result == nullptr) {
        uint32_t error_len = vir_call_error_size();
        fprintf(stderr, "vir_call_resolved_objects(%s) failed", name);
        if (error_len != 0) {
            fprintf(stderr, ": %.*s", static_cast<int>(error_len), vir_call_error());
        }
        fprintf(stderr, "\n");
        g_benchmark_failed = true;
        return 0;
    }
    uint32_t value = parse_nat_result(result);
    vir_obj_dec(result);
    return value;
}

static uint32_t call_fib(uint32_t input) {
    lean_object * args[] = { make_nat(input) };
    return call_nat_resolved(g_fib_slot, "fib", args, 1);
}

static uint32_t call_sort(uint32_t const * input, uint32_t len) {
    lean_object * values[64];
    if (len > 64) {
        fprintf(stderr, "sort benchmark input is too large\n");
        g_benchmark_failed = true;
        return 0;
    }
    for (uint32_t i = 0; i < len; i++) {
        values[i] = make_nat(input[i]);
    }
    lean_object * array = vir_obj_array(values, len);
    if (array == nullptr) {
        for (uint32_t i = 0; i < len; i++) {
            vir_obj_dec(values[i]);
        }
        fprintf(stderr, "failed to construct sort benchmark array\n");
        g_benchmark_failed = true;
        return 0;
    }
    lean_object * args[] = { array };
    return call_nat_resolved(g_sort_slot, "SortDemo.demoFromArray", args, 1);
}

static void bench_fib() {
    constexpr uint32_t iterations = 80;
    constexpr uint32_t input = 17;
    for (unsigned sample = 0; sample < 7; sample++) {
        uint64_t start = monotonic_nanos();
        uint32_t checksum = 0;
        for (uint32_t i = 0; i < iterations; i++) {
            checksum += call_fib(input);
        }
        uint64_t stop = monotonic_nanos();
        expect_checksum("fib", checksum, 127760);
        print_sample("fib", iterations, checksum, stop - start);
    }
}

static void bench_sort() {
    constexpr uint32_t iterations = 2000;
    uint32_t input[] = { 7, 3, 9, 1, 4, 1, 5, 2, 8, 6, 0, 10, 12, 11, 13, 14 };
    for (unsigned sample = 0; sample < 7; sample++) {
        uint64_t start = monotonic_nanos();
        uint32_t checksum = 0;
        for (uint32_t i = 0; i < iterations; i++) {
            checksum += call_sort(input, 16);
        }
        uint64_t stop = monotonic_nanos();
        expect_checksum("sort", checksum, 2454000);
        print_sample("sort", iterations, checksum, stop - start);
    }
}

int main() {
    uint32_t loaded = vir_load_ir_package(
        reinterpret_cast<uint8_t const *>(vir_demo_ir_package),
        static_cast<uint32_t>(vir_demo_ir_package_len));
    if (loaded == 0) {
        uint32_t len = vir_last_package_error_size();
        fprintf(stderr, "IR package load failed");
        if (len != 0) {
            fprintf(stderr, ": %.*s", static_cast<int>(len), vir_last_package_error());
        }
        fprintf(stderr, "\n");
        return 1;
    }
    g_fib_slot = resolve_call_slot(fib_export_index, "fib");
    g_sort_slot = resolve_call_slot(sort_export_index, "SortDemo.demoFromArray");
    if (g_fib_slot == 0 || g_sort_slot == 0) {
        return 1;
    }

    bench_fib();
    bench_sort();
    return g_benchmark_failed ? 1 : 0;
}
