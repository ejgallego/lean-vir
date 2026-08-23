import assert from "node:assert/strict";
import test from "node:test";

import { parseProducerArguments } from "../../scripts/packages/vir-client-package-lib.mjs";

const specification = {
  checkoutRoles: ["producer", "runtime", "client"],
  packageRoles: ["workload"],
  defaultProducer: "/producer",
  usage: "usage",
};

test("source-package arguments normalize explicit inputs", () => {
  const options = parseProducerArguments(
    [
      "--output",
      "/output",
      "--checkout",
      "runtime=/runtime",
      "--checkout",
      "client=/client",
      "--package",
      "workload=/workload",
    ],
    specification,
  );
  assert.equal(options.output, "/output");
  assert.deepEqual(Object.fromEntries(options.checkouts), {
    runtime: "/runtime",
    client: "/client",
    producer: "/producer",
  });
  assert.deepEqual(Object.fromEntries(options.packages), {
    workload: "/workload",
  });
});

test("source-package arguments fail closed", () => {
  assert.throws(
    () =>
      parseProducerArguments(
        ["--output", "/output", "--checkout", "unknown=/checkout"],
        specification,
      ),
    /unknown checkout role/,
  );
  assert.throws(
    () =>
      parseProducerArguments(
        [
          "--output",
          "/output",
          "--checkout",
          "runtime=/runtime",
          "--checkout",
          "client=/client",
        ],
        specification,
      ),
    /missing dependency package: workload/,
  );
});
