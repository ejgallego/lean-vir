/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include <stddef.h>
#include <stdint.h>

#include <string>

namespace lean::vir {

class package_binary_reader {
    uint8_t const * m_data;
    size_t m_size;
    size_t m_pos = 0;
    std::string m_error;

public:
    bool ok = true;

    package_binary_reader(uint8_t const * data, size_t size):
        m_data(data),
        m_size(size) {
    }

    std::string const & error() const {
        return m_error;
    }

    bool at_end() const {
        return m_pos == m_size;
    }

    size_t pos() const {
        return m_pos;
    }

    size_t remaining() const {
        return m_size - m_pos;
    }

    bool count_fits(uint32_t count, char const * label, size_t min_item_bytes) {
        if (!ok) {
            return false;
        }
        if (min_item_bytes == 0) {
            fail(std::string(label) + " minimum item size must be positive");
            return false;
        }
        if (count > remaining() / min_item_bytes) {
            fail(
                std::string(label) + " count " + std::to_string(count) +
                " exceeds remaining section bytes " + std::to_string(remaining()));
            return false;
        }
        return true;
    }

    uint32_t bounded_count(char const * label, size_t min_item_bytes) {
        uint32_t count = u32();
        if (!count_fits(count, label, min_item_bytes)) {
            return 0;
        }
        return count;
    }

    void fail(std::string const & message) {
        if (ok) {
            ok = false;
            m_error = "byte " + std::to_string(m_pos) + ": " + message;
        }
    }

    uint8_t u8() {
        if (!ok) {
            return 0;
        }
        if (m_pos >= m_size) {
            fail("unexpected end of IR package");
            return 0;
        }
        return m_data[m_pos++];
    }

    bool boolean() {
        uint8_t value = u8();
        if (value == 0) {
            return false;
        }
        if (value == 1) {
            return true;
        }
        fail("invalid boolean tag " + std::to_string(value));
        return false;
    }

    uint32_t u32() {
        uint32_t b0 = u8();
        uint32_t b1 = u8();
        uint32_t b2 = u8();
        uint32_t b3 = u8();
        return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    }

    std::string string() {
        uint32_t len = u32();
        if (!ok) {
            return std::string();
        }
        if (len > m_size - m_pos) {
            fail("string length " + std::to_string(len) + " exceeds remaining package bytes");
            return std::string();
        }
        std::string out(reinterpret_cast<char const *>(m_data + m_pos), len);
        m_pos += len;
        return out;
    }
};

}
