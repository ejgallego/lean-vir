/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function smokeRuntimeCalls(runtime) {
  const fibCases = [
    [0, 0],
    [1, 1],
    [8, 21],
    [10, 55],
    [12, 144],
    [17, 1597],
  ];

  for (const [input, expected] of fibCases) {
    const actual = runtime.call("fib", input);
    if (actual !== String(expected)) {
      throw new Error(`upstream fib ${input}: expected ${expected}, got ${actual}`);
    }
  }

  let repeatedFib = 0;
  for (let i = 0; i < 80; i++) {
    repeatedFib += Number(runtime.call("fib", 17));
  }
  if (repeatedFib !== 127760) {
    throw new Error(`upstream repeated fib: expected 127760, got ${repeatedFib}`);
  }

  const sortChecksum = runtime.call("SortDemo.demo");
  if (sortChecksum !== "192") {
    throw new Error(`upstream SortDemo.demo: expected 192, got ${sortChecksum}`);
  }

  const genericFib = runtime.call("fib", 12);
  if (genericFib !== "144") {
    throw new Error(`generic fib input: expected 144, got ${genericFib}`);
  }

  const editableChecksum = runtime.call("SortDemo.demoFromArray", [4, 1, 3, 2]);
  if (editableChecksum !== "30") {
    throw new Error(`upstream SortDemo.demoFromArray: expected 30, got ${editableChecksum}`);
  }

  const genericEditableChecksum = runtime.call("SortDemo.demoFromArray", [4, 1, 3, 2]);
  if (genericEditableChecksum !== "30") {
    throw new Error(`generic SortDemo.demoFromArray: expected 30, got ${genericEditableChecksum}`);
  }

  const genericStringScore = runtime.call("Vir.Fixtures.Basic.stringUtf8RoundtripScore", "Aé∀Z");
  if (genericStringScore !== "1381") {
    throw new Error(`generic String input: expected 1381, got ${genericStringScore}`);
  }

  const genericByteArrayScore = runtime.call("Vir.Fixtures.Basic.byteArrayInputScore", [65, 66, 67]);
  if (genericByteArrayScore !== "136") {
    throw new Error(`generic ByteArray input: expected 136, got ${genericByteArrayScore}`);
  }

  let repeatedSortChecksum = 0;
  for (let i = 0; i < 5; i++) {
    repeatedSortChecksum += Number(runtime.call("SortDemo.demoFromArray", [4, 1, 3, 2]));
  }
  if (repeatedSortChecksum !== 150) {
    throw new Error(`upstream repeated SortDemo.demoFromArray: expected 150, got ${repeatedSortChecksum}`);
  }
}
