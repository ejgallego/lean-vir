/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Positions are zero-based LSP coordinates at the tactic below each marker.
export function fixturePosition(source, marker) {
  const lines = source.split("\n");
  const matches = lines.flatMap((line, index) =>
    line.trim() === `-- ${marker}` ? [index] : [],
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one fixture marker ${marker}; found ${matches.length}`,
    );
  }
  const line = matches[0] + 2;
  if (!lines[line]?.trim()) {
    throw new Error(`Missing tactic below fixture marker ${marker}`);
  }
  return { line, character: 2 };
}

// Test-only: preserve the acceptance failure and attempt every teardown step.
export async function withCleanup(run, steps) {
  const errors = [];
  let result;
  try {
    result = await run();
  } catch (error) {
    errors.push(error);
  }
  for (const [label, cleanup] of steps) {
    try {
      await cleanup();
    } catch (cause) {
      errors.push(new Error(`Cleanup failed: ${label}`, { cause }));
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "RPC acceptance/cleanup failures", {
      cause: errors[0],
    });
  }
  return result;
}

// Error.message/stack are not enumerable; plain RPC errors also carry a code.
export function describeError(error) {
  if (error === null || typeof error !== "object") {
    return { message: String(error) };
  }
  return {
    message: error.message ?? String(error),
    stack: error.stack,
    code: error.code,
    ...(error instanceof AggregateError && {
      errors: error.errors.map(describeError),
    }),
    ...("cause" in error && { cause: describeError(error.cause) }),
  };
}

export async function until(
  label,
  predicate,
  { attempts = 2000, delay = 10 } = {},
) {
  for (let i = 0; i < attempts; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(`RPC browser condition timed out: ${label}`);
}
