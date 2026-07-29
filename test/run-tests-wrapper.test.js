const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { partitionTestFiles } = require("../scripts/test-shards");

const workspaceRoot = path.resolve(__dirname, "..");

test("weighted CI shards cover every ordinary test exactly once", () => {
  const files = fs.readdirSync(path.join(workspaceRoot, "test"))
    .filter((name) => name.endsWith(".test.js") && name !== "windows-launcher.test.js")
    .sort()
    .map((name) => `test/${name}`);
  const weightForFile = (file) => fs.statSync(path.join(workspaceRoot, file)).size;
  const first = partitionTestFiles(files, 5, weightForFile);
  const second = partitionTestFiles([...files].reverse(), 5, weightForFile);
  const assigned = first.flat().sort();

  assert.deepEqual(assigned, files);
  assert.equal(new Set(assigned).size, files.length);
  assert.deepEqual(second, first, "shard assignment must not depend on input order");
  assert.ok(first.every((shard) => shard.length > 0));

  const runtimeShard = first.findIndex((shard) => shard.includes("test/runtime.test.js"));
  const productionShard = first.findIndex((shard) => shard.includes("test/pantheon-production.test.js"));
  assert.notEqual(runtimeShard, productionShard, "the two largest suites must remain separated");
});

test("weighted CI shards reject invalid configuration", () => {
  assert.throws(
    () => partitionTestFiles(["test/example.test.js"], 0, () => 1),
    /invalid CI test-shard count/,
  );
  assert.throws(
    () => partitionTestFiles(["test/example.test.js"], 1, () => -1),
    /invalid test-file weight/,
  );
});
