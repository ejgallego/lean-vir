import assert from "node:assert/strict";
import { test } from "node:test";
import { replaceFixture } from "./fixture-edit.mjs";

test("fixture edits reject missing, ambiguous and no-op mutations", () => {
  assert.throws(() => replaceFixture("changed fixture", "old fixture", "mutation"));
  assert.throws(() => replaceFixture("x x", "x", "y"));
  assert.throws(() => replaceFixture("x", "", "y"));
  assert.throws(() => replaceFixture("x", "x", "x"));
  assert.throws(() => replaceFixture("x", "x", "y", 0));
  assert.throws(() => replaceFixture("changed fixture", "old fixture", "mutation", "all"));
});

test("fixture edits replace only the declared occurrences, with literal output", () => {
  assert.equal(replaceFixture("x y", "x", "$&"), "$& y");
  assert.equal(replaceFixture("x x", "x", "y", 2), "y y");
  assert.equal(replaceFixture("x x x", "x", "y", "all"), "y y y");
});
