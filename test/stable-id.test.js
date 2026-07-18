const test = require("node:test");
const assert = require("node:assert/strict");
const { spendCostId, stableIdSegment } = require("../src/runtime/stable-id");

test("short safe identifiers retain their existing value", () => {
  assert.equal(stableIdSegment("task-live"), "task-live");
  assert.equal(spendCostId("task-live"), "cost_spend_task-live");
});

test("long identifiers retain a stable hash suffix instead of colliding", () => {
  const shared = `task_${"same_".repeat(30)}`;
  const first = spendCostId(`${shared}retry_1`);
  const second = spendCostId(`${shared}retry_2`);

  assert.notEqual(first, second);
  assert.equal(first, spendCostId(`${shared}retry_1`));
  assert.ok(first.length <= "cost_spend_".length + 88);
  assert.match(first, /_[a-f0-9]{12}$/);
});
