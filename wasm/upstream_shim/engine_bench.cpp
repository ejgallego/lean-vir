#include <stdint.h>
#include <stdio.h>
#include <time.h>

extern "C" uint32_t vir_load_ir_package(uint8_t const * data, uint32_t size);
extern "C" uint32_t vir_last_package_error_size(void);
extern "C" char const * vir_last_package_error(void);
extern "C" uint32_t vir_upstream_fib_repeated(uint32_t iterations, uint32_t n);
extern "C" uint32_t vir_sort_checksum_repeated(uint32_t const * values, uint32_t len, uint32_t iterations);

#include "vir_demo_package.inc"

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

static void bench_fib() {
    constexpr uint32_t iterations = 80;
    constexpr uint32_t input = 17;
    for (unsigned sample = 0; sample < 7; sample++) {
        uint64_t start = monotonic_nanos();
        uint32_t checksum = vir_upstream_fib_repeated(iterations, input);
        uint64_t stop = monotonic_nanos();
        print_sample("fib", iterations, checksum, stop - start);
    }
}

static void bench_sort() {
    constexpr uint32_t iterations = 2000;
    uint32_t input[] = { 7, 3, 9, 1, 4, 1, 5, 2, 8, 6, 0, 10, 12, 11, 13, 14 };
    for (unsigned sample = 0; sample < 7; sample++) {
        uint64_t start = monotonic_nanos();
        uint32_t checksum = vir_sort_checksum_repeated(input, 16, iterations);
        uint64_t stop = monotonic_nanos();
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
    return 0;
}
