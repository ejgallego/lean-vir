/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

#pragma once

#include <stddef.h>

#include "util/name.h"

namespace lean {

name name_from_dotted(char const * text, size_t len);

}
