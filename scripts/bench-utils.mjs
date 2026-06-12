/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function formatMs(ms) {
  return ms < 1 ? `${(ms * 1000).toFixed(1)} us` : `${ms.toFixed(2)} ms`;
}

export function parseBenchmarkSamples(stdout, prefix) {
  const byLabel = new Map();
  for (const line of stdout.split("\n")) {
    const match = new RegExp(`^${prefix} (\\S+) (\\d+) (\\d+) (\\d+)$`).exec(line.trim());
    if (!match) continue;
    const label = match[1];
    const sample = byLabel.get(label) ?? {
      label,
      iterations: Number(match[2]),
      checksum: Number(match[3]),
      samples: [],
    };
    sample.iterations = Number(match[2]);
    sample.checksum = Number(match[3]);
    sample.samples.push(Number(match[4]) / 1_000_000);
    byLabel.set(label, sample);
  }
  for (const sample of byLabel.values()) {
    sample.medianMs = median(sample.samples);
  }
  return byLabel;
}

export function requireBenchmarkSample(stdout, prefix, label, description = prefix) {
  const sample = parseBenchmarkSamples(stdout, prefix).get(label);
  if (!sample) {
    throw new Error(`no ${description} benchmark samples found for ${label}`);
  }
  return sample;
}
