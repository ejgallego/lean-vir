import assert from "node:assert/strict";
import test from "node:test";

import { runSync } from "../scripts/process-utils.mjs";
import {
  exactObject,
  identifier,
  isIdentifier,
  object,
  string,
} from "../scripts/validation-utils.mjs";

test("configuration validators share identifier and exact-object semantics", () => {
  assert.equal(isIdentifier("prettyM.default-1"), true);
  assert.equal(isIdentifier("../prettyM"), false);
  assert.equal(identifier("prettyM", "example ID"), "prettyM");
  assert.equal(string("Pretty M", "example title"), "Pretty M");
  assert.deepEqual(object({ value: 1 }, "config"), { value: 1 });
  assert.deepEqual(
    exactObject({ value: 1 }, ["value"], "config"),
    { value: 1 },
  );
  assert.throws(() => identifier("bad/id", "example ID"), /not a safe identifier/);
  assert.throws(() => object([], "config"), /config must be an object/);
  assert.throws(
    () => exactObject({ value: 1, typo: true }, ["value"], "config"),
    /config has unknown property typo/,
  );
});

test("synchronous process runner captures output and reports stderr", () => {
  assert.equal(
    runSync(
      process.execPath,
      ["-e", "process.stdout.write('ready\\n')"],
      { capture: true },
    ),
    "ready",
  );
  assert.throws(
    () => runSync(
      process.execPath,
      ["-e", "process.stderr.write('failure detail\\n'); process.exit(7)"],
      { capture: true },
    ),
    /failed with status 7\nfailure detail/,
  );
});
