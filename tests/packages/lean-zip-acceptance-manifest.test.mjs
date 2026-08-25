/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAcceptanceManifest,
} from "../../scripts/packages/lean-zip/acceptance-manifest.mjs";

const baselineRows = [
  "compress\tempty\t0\tempty.input.bin\tempty.level-0.deflate.bin",
  "compress\tshort-text\t10\tshort-text.input.bin\tshort-text.level-10.deflate.bin",
  "large-compress\tlarge-repeated-text\t5\tlarge.input.bin\tlarge.level-5.deflate.bin",
  "prescan\talphabet-205\talphabet-205.input.bin\tfalse",
];

const profileRows = [
  "profile-match\tlarge-heterogeneous\t9\tlarge-heterogeneous.input.bin\tlarge-heterogeneous.level-9.tokens.bin",
  "profile-match\tlarge-heterogeneous\t10\tlarge-heterogeneous.input.bin\tlarge-heterogeneous.level-10.tokens.bin",
  "profile-base\tlarge-heterogeneous\t9\tlarge-heterogeneous.input.bin\tlarge-heterogeneous.level-9.tokens.bin\t1234",
  "profile-base\tlarge-heterogeneous\t10\tlarge-heterogeneous.input.bin\tlarge-heterogeneous.level-10.tokens.bin\t1200",
  "profile-optimal\tlarge-heterogeneous\tfast\tlarge-heterogeneous.input.bin\tlarge-heterogeneous.optimal-fast.deflate.bin",
  "profile-optimal\tlarge-heterogeneous\texact\tlarge-heterogeneous.input.bin\tlarge-heterogeneous.optimal-exact.deflate.bin",
];

const profileWholeRows = [
  "large-compress\tlarge-heterogeneous\t9\tlarge-heterogeneous.input.bin\tlarge-heterogeneous.level-9.deflate.bin",
  "large-compress\tlarge-heterogeneous\t10\tlarge-heterogeneous.input.bin\tlarge-heterogeneous.level-10.deflate.bin",
];

function manifestSource(rows = baselineRows, separator = "\n") {
  return `${rows.join(separator)}${separator}`;
}

function profileManifest(rows = profileRows, wholeRows = profileWholeRows) {
  return manifestSource([...baselineRows, ...wholeRows, ...rows]);
}

test("acceptance manifests parse typed baseline rows", () => {
  const manifest = parseAcceptanceManifest(
    manifestSource(baselineRows, "\r\n"),
  );
  assert.deepEqual(manifest.compression, [
    {
      name: "empty",
      level: 0,
      inputFile: "empty.input.bin",
      outputFile: "empty.level-0.deflate.bin",
    },
    {
      name: "short-text",
      level: 10,
      inputFile: "short-text.input.bin",
      outputFile: "short-text.level-10.deflate.bin",
    },
  ]);
  assert.deepEqual(manifest.largeCompression, [
    {
      name: "large-repeated-text",
      level: 5,
      inputFile: "large.input.bin",
      outputFile: "large.level-5.deflate.bin",
    },
  ]);
  assert.deepEqual(manifest.prescan, [
    {
      name: "alphabet-205",
      inputFile: "alphabet-205.input.bin",
      decision: false,
    },
  ]);
  assert.deepEqual(manifest.profileMatches, []);
  assert.deepEqual(manifest.profileBases, []);
  assert.deepEqual(manifest.profileOptimals, []);
});

test("acceptance manifests validate the complete profiling contract", () => {
  const manifest = parseAcceptanceManifest(
    profileManifest(),
    { includeProfile: true },
  );
  assert.deepEqual(
    manifest.profileMatches.map(({ level }) => level),
    [9, 10],
  );
  assert.deepEqual(
    manifest.profileBases.map(({ outputBytes }) => outputBytes),
    [1234, 1200],
  );
  assert.deepEqual(
    manifest.profileOptimals.map(({ kind }) => kind),
    ["fast", "exact"],
  );
});

test(
  "acceptance manifests reject malformed values before reading artifacts",
  () => {
    for (const [row, pattern] of [
      ["unknown\tcase", /unknown row kind/u],
      ["compress\tcase\t1\tinput.bin", /expected 5 tab-separated fields/u],
      [
        "compress\t\t1\tinput.bin\toutput.bin",
        /case name must not be empty/u,
      ],
      [
        "compress\tcase\t1.5\tinput.bin\toutput.bin",
        /compression level must be an integer/u,
      ],
      [
        "compress\tcase\t11\tinput.bin\toutput.bin",
        /compression level must be a safe integer in 0\.\.10/u,
      ],
      [
        "large-compress\tcase\t4\tinput.bin\toutput.bin",
        /compression level must be a safe integer in 5\.\.10/u,
      ],
      [
        "compress\tcase\t1\t..\/input.bin\toutput.bin",
        /input file must be a safe artifact file name/u,
      ],
      [
        "prescan\tcase\tinput.bin\tTRUE",
        /prescan decision must be true or false/u,
      ],
      [
        "profile-base\tlarge-heterogeneous\t9\tinput.bin\ttokens.bin\t-1",
        /output byte count must be an integer/u,
      ],
      [
        "profile-optimal\tlarge-heterogeneous\tslow\tinput.bin\toutput.bin",
        /optimal profile kind must be fast or exact/u,
      ],
    ]) {
      assert.throws(
        () => parseAcceptanceManifest(manifestSource([row, ...baselineRows])),
        pattern,
        row,
      );
    }
  },
);

test("acceptance manifests require every baseline vector category", () => {
  assert.throws(
    () => parseAcceptanceManifest(""),
    /native oracle manifest is empty/u,
  );
  for (const [kind, description] of [
    ["compress", "compression"],
    ["large-compress", "large-compression"],
    ["prescan", "prescan"],
  ]) {
    assert.throws(
      () =>
        parseAcceptanceManifest(
          manifestSource(
            baselineRows.filter((row) => !row.startsWith(`${kind}\t`)),
          ),
        ),
      new RegExp(`no ${description} rows`, "u"),
    );
  }
});

test("acceptance manifests reject duplicate vectors", () => {
  assert.throws(
    () =>
      parseAcceptanceManifest(
        manifestSource([...baselineRows, baselineRows[0]]),
      ),
    /duplicate native oracle compression vector: empty level 0/u,
  );
});

test("profiling rows must match the selected mode and each other", () => {
  assert.throws(
    () =>
      parseAcceptanceManifest(manifestSource([...baselineRows, ...profileRows])),
    /emitted profile stages without --profile/u,
  );
  assert.throws(
    () =>
      parseAcceptanceManifest(
        profileManifest(profileRows.slice(0, -1)),
        { includeProfile: true },
      ),
    /optimal profile must contain .* fast and exact rows/u,
  );

  const mismatchedRows = profileRows.map((row) =>
    row.startsWith("profile-base\tlarge-heterogeneous\t10\t")
      ? row.replace("level-10.tokens.bin", "other.tokens.bin")
      : row,
  );
  assert.throws(
    () =>
      parseAcceptanceManifest(
        profileManifest(mismatchedRows),
        { includeProfile: true },
      ),
    /level-10 profile stages reference different artifacts/u,
  );
});

test("profiling rows require matching whole-compression vectors", () => {
  assert.throws(
    () => parseAcceptanceManifest(profileManifest(profileRows, []), {
      includeProfile: true,
    }),
    /whole-compression profile must contain large-heterogeneous levels 9 and 10/u,
  );

  const mismatchedWholeRows = profileWholeRows.map((row) =>
    row.startsWith("large-compress\tlarge-heterogeneous\t10\t")
      ? row.replace(
          "large-heterogeneous.input.bin",
          "other-large.input.bin",
        )
      : row,
  );
  assert.throws(
    () =>
      parseAcceptanceManifest(
        profileManifest(profileRows, mismatchedWholeRows),
        { includeProfile: true },
      ),
    /whole-compression profile references a different input/u,
  );
});

test("profiling rows share one corpus and input", () => {
  const wrongLevelRows = profileRows.map((row) =>
    row.startsWith("profile-match\tlarge-heterogeneous\t9\t")
      ? row.replace("\t9\t", "\t8\t")
      : row,
  );
  assert.throws(
    () =>
      parseAcceptanceManifest(profileManifest(wrongLevelRows), {
        includeProfile: true,
      }),
    /matcher profile must contain large-heterogeneous levels 9 and 10/u,
  );

  for (const [prefix, pattern] of [
    [
      "profile-match\tlarge-heterogeneous\t10\t",
      /profile stages reference different inputs/u,
    ],
    [
      "profile-optimal\tlarge-heterogeneous\texact\t",
      /profile stages reference different inputs/u,
    ],
  ]) {
    const mismatchedRows = profileRows.map((row) =>
      row.startsWith(prefix)
        ? row.replace(
            "large-heterogeneous.input.bin",
            "other-large.input.bin",
          )
        : row,
    );
    assert.throws(
      () =>
        parseAcceptanceManifest(profileManifest(mismatchedRows), {
          includeProfile: true,
        }),
      pattern,
      prefix,
    );
  }
});
