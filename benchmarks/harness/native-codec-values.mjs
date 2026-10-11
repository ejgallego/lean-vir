/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const none = () => ({ kind: "none" });
const some = (value) => ({ kind: "some", value });
const leaf = (value) => ({ kind: "leaf", value });

function tree(size, seed, start = 0) {
  if (size <= 1) return leaf(seed + BigInt(start));
  const leftSize = Math.floor(size / 2);
  return {
    kind: "branch",
    fields: {
      children: [tree(leftSize, seed, start), tree(size - leftSize, seed, start + leftSize)],
      extra: size % 2 === 0 ? some(leaf(seed)) : none(),
      pair: { fst: leaf(seed + 1n), snd: true },
      choice: size % 3 === 0
        ? { kind: "inl", value: leaf(seed + 2n) }
        : { kind: "inr", value: false },
    },
  };
}

export function nativeCodecCases(size, corpus) {
  const seed = corpus === "small" ? 0n : 900719925474099312345678901234567890n;
  const modes = ["off", "normal", "precise"];
  const records = Array.from({ length: size }, (_, i) => ({
    count: seed + BigInt(i),
    delta: -(seed + BigInt(i)),
    index: i,
    wide: 18446744073709551615n - BigInt(i),
    score: i + 0.25,
    enabled: i % 2 === 0,
    mode: modes[i % modes.length],
    label: `row:${i}:\0α雪`,
    bytes: Uint8Array.of(i % 256, 0, 255),
  }));
  const nested = Array.from({ length: size }, (_, i) => i % 4 === 0
    ? none()
    : some({
        fst: seed + BigInt(i),
        snd: i % 4 === 1 ? none() : i % 4 === 2 ? some(none()) : some(some(undefined)),
      }));
  const treeValue = tree(size, seed);
  const modeValues = Array.from({ length: size }, (_, i) => modes[i % modes.length]);
  const text = "\0α雪".repeat(size);
  const bytes = Uint8Array.from({ length: size }, (_, i) => i % 251);
  return [
    { name: "records", suffix: "Records", value: records, consumed: BigInt(size) },
    { name: "nested", suffix: "Nested", value: nested, consumed: size === 0 },
    { name: "tree", suffix: "Tree", value: treeValue, consumed: size <= 1 },
    { name: "modes", suffix: "Modes", value: modeValues, consumed: BigInt(size) },
    { name: "text", suffix: "Text", value: text, consumed: size === 0 },
    { name: "bytes", suffix: "Bytes", value: bytes, consumed: BigInt(size) },
  ];
}
