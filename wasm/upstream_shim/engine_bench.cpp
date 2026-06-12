/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

extern "C" uint32_t vir_load_ir_package(uint8_t const * data, uint32_t size);
extern "C" uint32_t vir_last_package_error_size(void);
extern "C" char const * vir_last_package_error(void);
extern "C" char const * vir_call(
    char const * name_text,
    uint32_t name_len,
    uint8_t const * request,
    uint32_t request_len,
    uint8_t result_tag);
extern "C" uint32_t vir_call_result_size(void);
extern "C" char const * vir_call_error(void);
extern "C" uint32_t vir_call_error_size(void);

extern "C" char const * vir_js_call(uint32_t slot, uint8_t const * request, uint32_t request_len) {
    (void) request;
    (void) request_len;
    fprintf(stderr, "unexpected JavaScript host import call in engine benchmark: slot %u\n", slot);
    return nullptr;
}

extern "C" uint32_t vir_js_call_result_size(void) {
    return 0;
}

#include "vir_fixtures_basic_package.inc"

static bool g_benchmark_failed = false;

constexpr uint8_t WIRE_NAT = 0;
constexpr uint8_t WIRE_ARRAY = 16;

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

static void write_u32(uint8_t *& cursor, uint32_t value) {
    *cursor++ = static_cast<uint8_t>(value & 0xff);
    *cursor++ = static_cast<uint8_t>((value >> 8) & 0xff);
    *cursor++ = static_cast<uint8_t>((value >> 16) & 0xff);
    *cursor++ = static_cast<uint8_t>((value >> 24) & 0xff);
}

static uint32_t read_u32(uint8_t const * cursor) {
    return static_cast<uint32_t>(cursor[0]) |
        (static_cast<uint32_t>(cursor[1]) << 8) |
        (static_cast<uint32_t>(cursor[2]) << 16) |
        (static_cast<uint32_t>(cursor[3]) << 24);
}

static void write_decimal(uint8_t *& cursor, uint32_t value) {
    char text[16];
    int len = snprintf(text, sizeof(text), "%u", value);
    write_u32(cursor, static_cast<uint32_t>(len));
    memcpy(cursor, text, static_cast<size_t>(len));
    cursor += len;
}

static void write_nat_type(uint8_t *& cursor) {
    *cursor++ = WIRE_NAT;
}

static void write_array_nat_type(uint8_t *& cursor) {
    *cursor++ = WIRE_ARRAY;
    write_nat_type(cursor);
}

static void write_call_tail_nat(uint8_t *& cursor) {
    write_nat_type(cursor);
    *cursor++ = 0;
}

static uint32_t parse_nat_result(char const * data, uint32_t len) {
    if (data == nullptr || len < 5 || static_cast<uint8_t>(data[0]) != WIRE_NAT) {
        fprintf(stderr, "invalid Nat result payload\n");
        return 0;
    }
    uint8_t const * bytes = reinterpret_cast<uint8_t const *>(data);
    uint32_t text_len = read_u32(bytes + 1);
    if (text_len > len - 5) {
        fprintf(stderr, "invalid Nat result length\n");
        return 0;
    }
    uint32_t value = 0;
    for (uint32_t i = 0; i < text_len; i++) {
        char c = data[5 + i];
        if (c < '0' || c > '9') {
            fprintf(stderr, "invalid Nat result digit\n");
            return 0;
        }
        value = value * 10 + static_cast<uint32_t>(c - '0');
    }
    return value;
}

static uint32_t call_nat(char const * name, uint8_t const * payload, uint32_t payload_len) {
    char const * result = vir_call(name, static_cast<uint32_t>(strlen(name)), payload, payload_len, 0);
    if (result == nullptr) {
        uint32_t error_len = vir_call_error_size();
        fprintf(stderr, "vir_call(%s) failed", name);
        if (error_len != 0) {
            fprintf(stderr, ": %.*s", static_cast<int>(error_len), vir_call_error());
        }
        fprintf(stderr, "\n");
        g_benchmark_failed = true;
        return 0;
    }
    return parse_nat_result(result, vir_call_result_size());
}

static uint32_t call_fib(uint32_t input) {
    uint8_t payload[4 + 1 + 4 + 16 + 1 + 1];
    uint8_t * cursor = payload;
    write_u32(cursor, 1);
    write_nat_type(cursor);
    write_decimal(cursor, input);
    write_call_tail_nat(cursor);
    return call_nat("fib", payload, static_cast<uint32_t>(cursor - payload));
}

static uint32_t call_sort(uint32_t const * input, uint32_t len) {
    uint8_t payload[4 + 2 + 4 + 64 * (4 + 16) + 1 + 1];
    uint8_t * cursor = payload;
    write_u32(cursor, 1);
    write_array_nat_type(cursor);
    write_u32(cursor, len);
    for (uint32_t i = 0; i < len; i++) {
        write_decimal(cursor, input[i]);
    }
    write_call_tail_nat(cursor);
    return call_nat("SortDemo.demoFromArray", payload, static_cast<uint32_t>(cursor - payload));
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

    bench_fib();
    bench_sort();
    return g_benchmark_failed ? 1 : 0;
}
