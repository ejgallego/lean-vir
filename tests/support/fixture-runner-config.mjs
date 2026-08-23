/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { parseRunnerJobLimit } from "./runner-jobs.mjs";

export function parseFixtureRunnerConfig({ argv = [], env = {}, parallelism = 1 } = {}) {
  const showHelp = argv.includes("-h") || argv.includes("--help");
  if (!showHelp) {
    for (const arg of argv) {
      if (arg !== "--no-build") {
        throw new Error(`unknown argument: ${arg}; run node tests/fixtures/runner.mjs --help`);
      }
    }
  }

  const configuredJobs = parseRunnerJobLimit(env.VIR_FIXTURE_JOBS, "VIR_FIXTURE_JOBS");
  return Object.freeze({
    showHelp,
    fixtureFilter: env.VIR_FIXTURE_FILTER?.trim() ?? "",
    skipBuild: env.VIR_FIXTURE_SKIP_BUILD === "1" || argv.includes("--no-build"),
    configuredJobs,
    parallelism: Number.isInteger(parallelism) && parallelism > 0 ? parallelism : 1,
  });
}

export function fixtureMatchesFilter(fixture, filter) {
  if (filter === "") return true;
  const needle = filter.toLowerCase();
  const haystack = [
    fixture.id,
    fixture.source,
    fixture.entry,
    ...(fixture.roots ?? []),
  ].join("\n").toLowerCase();
  return haystack.includes(needle);
}

export function fixtureJobCount(total, config) {
  if (config.configuredJobs !== null) {
    return Math.min(config.configuredJobs, total);
  }
  return Math.min(Math.max(1, Math.floor(config.parallelism / 2)), total);
}
