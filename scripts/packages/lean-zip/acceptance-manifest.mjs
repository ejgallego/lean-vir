/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const artifactFilePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const profileCorpus = "large-heterogeneous";
const profileLevels = [9, 10];
const profileOptimalKinds = ["exact", "fast"];

function invalidRow(line, reason) {
  throw new Error(
    `invalid native oracle manifest row (${reason}): ${JSON.stringify(line)}`,
  );
}

function requireLabel(value, line, field) {
  if (value === "") invalidRow(line, `${field} must not be empty`);
  return value;
}

function requireArtifactFile(value, line, field) {
  if (!artifactFilePattern.test(value)) {
    invalidRow(line, `${field} must be a safe artifact file name`);
  }
  return value;
}

function requireInteger(value, line, field, { min = 0, max } = {}) {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    invalidRow(line, `${field} must be an integer`);
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < min ||
    (max !== undefined && parsed > max)
  ) {
    const range = max === undefined ? `at least ${min}` : `${min}..${max}`;
    invalidRow(line, `${field} must be a safe integer in ${range}`);
  }
  return parsed;
}

function requireFields(fields, count, line) {
  if (fields.length !== count) {
    invalidRow(line, `expected ${count} tab-separated fields`);
  }
}

function requireUnique(rows, key, description) {
  const seen = new Set();
  for (const row of rows) {
    const value = key(row);
    if (seen.has(value)) {
      throw new Error(`duplicate native oracle ${description}: ${value}`);
    }
    seen.add(value);
  }
}

function requireProfileContract(manifest) {
  const { profileMatches, profileBases, profileOptimals } = manifest;
  for (const [rows, description] of [
    [profileMatches, "matcher"],
    [profileBases, "base-preparation"],
  ]) {
    const levels = rows
      .map(({ level }) => level)
      .sort((left, right) => left - right);
    if (
      rows.some(({ corpus }) => corpus !== profileCorpus) ||
      levels.length !== profileLevels.length ||
      levels.some((level, index) => level !== profileLevels[index])
    ) {
      throw new Error(
        `native oracle ${description} profile must contain ${profileCorpus} levels 9 and 10`,
      );
    }
  }

  const kinds = profileOptimals.map(({ kind }) => kind).sort();
  if (
    profileOptimals.some(({ corpus }) => corpus !== profileCorpus) ||
    kinds.length !== profileOptimalKinds.length ||
    kinds.some((kind, index) => kind !== profileOptimalKinds[index])
  ) {
    throw new Error(
      `native oracle optimal profile must contain ${profileCorpus} fast and exact rows`,
    );
  }

  const matchesByLevel = new Map(
    profileMatches.map((row) => [row.level, row]),
  );
  const profileInput = profileMatches[0].inputFile;
  if (profileMatches.some(({ inputFile }) => inputFile !== profileInput)) {
    throw new Error("native oracle profile stages reference different inputs");
  }
  for (const base of profileBases) {
    const match = matchesByLevel.get(base.level);
    if (
      match.inputFile !== base.inputFile ||
      match.tokensFile !== base.tokensFile
    ) {
      throw new Error(
        `native oracle level-${base.level} profile stages reference different artifacts`,
      );
    }
  }
  if (profileOptimals.some(({ inputFile }) => inputFile !== profileInput)) {
    throw new Error("native oracle profile stages reference different inputs");
  }
}

export function parseAcceptanceManifest(
  source,
  { includeProfile = false } = {},
) {
  if (typeof source !== "string") {
    throw new Error("native oracle manifest is empty");
  }
  const lines = source.split(/\r?\n/u);
  while (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) throw new Error("native oracle manifest is empty");

  const manifest = {
    compression: [],
    largeCompression: [],
    prescan: [],
    profileMatches: [],
    profileBases: [],
    profileOptimals: [],
  };

  for (const line of lines) {
    const fields = line.split("\t");
    switch (fields[0]) {
      case "compress":
      case "large-compress": {
        requireFields(fields, 5, line);
        const minLevel = fields[0] === "large-compress" ? 5 : 0;
        const vector = {
          name: requireLabel(fields[1], line, "case name"),
          level: requireInteger(fields[2], line, "compression level", {
            min: minLevel,
            max: 10,
          }),
          inputFile: requireArtifactFile(fields[3], line, "input file"),
          outputFile: requireArtifactFile(fields[4], line, "output file"),
        };
        const vectors =
          fields[0] === "compress"
            ? manifest.compression
            : manifest.largeCompression;
        vectors.push(vector);
        break;
      }
      case "prescan": {
        requireFields(fields, 4, line);
        if (fields[3] !== "true" && fields[3] !== "false") {
          invalidRow(line, "prescan decision must be true or false");
        }
        manifest.prescan.push({
          name: requireLabel(fields[1], line, "case name"),
          inputFile: requireArtifactFile(fields[2], line, "input file"),
          decision: fields[3] === "true",
        });
        break;
      }
      case "profile-match": {
        requireFields(fields, 5, line);
        manifest.profileMatches.push({
          corpus: requireLabel(fields[1], line, "profile corpus"),
          level: requireInteger(fields[2], line, "profile level", { max: 10 }),
          inputFile: requireArtifactFile(fields[3], line, "input file"),
          tokensFile: requireArtifactFile(fields[4], line, "tokens file"),
        });
        break;
      }
      case "profile-base": {
        requireFields(fields, 6, line);
        manifest.profileBases.push({
          corpus: requireLabel(fields[1], line, "profile corpus"),
          level: requireInteger(fields[2], line, "profile level", { max: 10 }),
          inputFile: requireArtifactFile(fields[3], line, "input file"),
          tokensFile: requireArtifactFile(fields[4], line, "tokens file"),
          outputBytes: requireInteger(fields[5], line, "output byte count"),
        });
        break;
      }
      case "profile-optimal": {
        requireFields(fields, 5, line);
        const kind = fields[2];
        if (!profileOptimalKinds.includes(kind)) {
          invalidRow(line, "optimal profile kind must be fast or exact");
        }
        manifest.profileOptimals.push({
          corpus: requireLabel(fields[1], line, "profile corpus"),
          kind,
          inputFile: requireArtifactFile(fields[3], line, "input file"),
          outputFile: requireArtifactFile(fields[4], line, "output file"),
        });
        break;
      }
      default:
        invalidRow(line, "unknown row kind");
    }
  }

  for (const [rows, key, description] of [
    [
      manifest.compression,
      ({ name, level }) => `${name} level ${level}`,
      "compression vector",
    ],
    [
      manifest.largeCompression,
      ({ name, level }) => `${name} level ${level}`,
      "large-compression vector",
    ],
    [manifest.prescan, ({ name }) => name, "prescan vector"],
    [
      manifest.profileMatches,
      ({ corpus, level }) => `${corpus} level ${level}`,
      "matcher profile",
    ],
    [
      manifest.profileBases,
      ({ corpus, level }) => `${corpus} level ${level}`,
      "base-preparation profile",
    ],
    [
      manifest.profileOptimals,
      ({ corpus, kind }) => `${corpus} ${kind}`,
      "optimal profile",
    ],
  ]) {
    requireUnique(rows, key, description);
  }

  for (const [rows, description] of [
    [manifest.compression, "compression"],
    [manifest.largeCompression, "large-compression"],
    [manifest.prescan, "prescan"],
  ]) {
    if (rows.length === 0) {
      throw new Error(`native oracle manifest has no ${description} rows`);
    }
  }

  const profileRowCount =
    manifest.profileMatches.length +
    manifest.profileBases.length +
    manifest.profileOptimals.length;
  if (includeProfile) {
    requireProfileContract(manifest);
  } else if (profileRowCount !== 0) {
    throw new Error("native oracle emitted profile stages without --profile");
  }

  return manifest;
}
