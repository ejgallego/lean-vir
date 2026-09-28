/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include <stddef.h>

#include "util/name.h"

namespace lean {

/**
 * Return whether `text` is the restricted textual Name spelling accepted by
 * the structural Expr/Level adapter.
 *
 * The adapter accepts ordinary non-empty Lean identifier components separated
 * by dots, plus the canonical anonymous spelling (`"[anonymous]"`) and the
 * legacy empty spelling. Numeric, escaped, empty and otherwise non-identifier
 * components are rejected because this parser only constructs string Name
 * components.
 */
bool is_supported_dotted_name(char const * text, size_t len);

bool is_supported_name(name const & value);

// The caller must first check is_supported_dotted_name. Invalid input is not
// normalized here because empty and numeric components have distinct Name
// identities that this string-only adapter cannot preserve.
name name_from_dotted(char const * text, size_t len);

}
