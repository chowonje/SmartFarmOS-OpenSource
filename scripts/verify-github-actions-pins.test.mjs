import assert from "node:assert/strict";
import test from "node:test";
import { findUnpinnedActionReferences } from "./verify-github-actions-pins.mjs";

test("rejects mutable action tags", () => {
  assert.deepEqual(
    findUnpinnedActionReferences("steps:\n  - uses: actions/checkout@v7\n", "ci.yml"),
    [{ path: "ci.yml", line: 2, reference: "actions/checkout@v7" }],
  );
});

test("accepts full commit SHAs and repository-local actions", () => {
  const source = [
    "steps:",
    "  - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0",
    "  - uses: ./.github/actions/local-check",
    "",
  ].join("\n");

  assert.deepEqual(findUnpinnedActionReferences(source), []);
});

test("rejects branch references in quoted reusable workflow syntax", () => {
  const source = "jobs:\n  call:\n    uses: 'owner/repository/.github/workflows/check.yml@main'\n";
  assert.equal(findUnpinnedActionReferences(source)[0]?.line, 3);
});
