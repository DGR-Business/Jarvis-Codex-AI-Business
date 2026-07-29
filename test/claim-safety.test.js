"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  claimSafetyIsConfirmed,
  claimSafetyRequiresCorrection,
} = require("../src/runtime/claim-safety");

test("claim safety rejects contradictory approval language", () => {
  for (const statement of [
    "Safe overall; one claim should be revised.",
    "Safe, but a correction is required.",
    "Supported, however this needs a revision.",
    "Acceptable, but the claim has to be corrected.",
    "Unsafe: the benefit is not supported.",
    "Safe overall; the claims remain unsupported.",
    "Supported overall, but one statement is misleading.",
    "Acceptable wording, although the result is unreliable.",
    "Safe overall; the benefit cannot be substantiated.",
  ]) {
    assert.equal(claimSafetyRequiresCorrection(statement), true, statement);
    assert.equal(claimSafetyIsConfirmed(statement), false, statement);
  }
});

test("claim safety preserves explicit absence and completed-revision wording", () => {
  for (const statement of [
    "Safe: no correction is required.",
    "Supported: the revised wording matches the retained file; no correction is required.",
    "Acceptable: this does not need a revision.",
    "Safe: no unsupported claims remain.",
    "Supported: the retained statement is not misleading.",
  ]) {
    assert.equal(claimSafetyRequiresCorrection(statement), false, statement);
    assert.equal(claimSafetyIsConfirmed(statement), true, statement);
  }
});
