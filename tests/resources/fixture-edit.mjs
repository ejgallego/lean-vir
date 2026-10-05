import assert from "node:assert/strict";

// Intentional fixture mutations must never silently test the unchanged input.
// Literal replacement also avoids JavaScript replacement-string interpolation.
export function replaceFixture(source, before, after, count = 1) {
  assert.ok(before.length > 0 && before !== after, "fixture edit must change a nonempty literal");
  assert.ok(count === "all" || (Number.isInteger(count) && count > 0), "fixture edit requires a positive occurrence count");
  const parts = source.split(before);
  const matches = parts.length - 1;
  if (count === "all") assert.ok(matches > 0, `missing fixture literal: ${before}`);
  else assert.equal(matches, count, `fixture literal occurrence count: ${before}`);
  return parts.join(after);
}
