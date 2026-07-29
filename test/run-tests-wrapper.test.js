const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  LOCAL_ORDINARY_SHARD_COUNT,
  partitionTestFiles,
  planTestInvocations,
} = require("../scripts/test-shards");

const workspaceRoot = path.resolve(__dirname, "..");

test("weighted ordinary shards cover every ordinary test exactly once", () => {
  const files = fs.readdirSync(path.join(workspaceRoot, "test"))
    .filter((name) => name.endsWith(".test.js") && name !== "windows-launcher.test.js")
    .sort()
    .map((name) => `test/${name}`);
  const weightForFile = (file) => fs.statSync(path.join(workspaceRoot, file)).size;
  const first = partitionTestFiles(files, LOCAL_ORDINARY_SHARD_COUNT, weightForFile);
  const second = partitionTestFiles(
    [...files].reverse(),
    LOCAL_ORDINARY_SHARD_COUNT,
    weightForFile,
  );
  const assigned = first.flat().sort();

  assert.deepEqual(assigned, files);
  assert.equal(new Set(assigned).size, files.length);
  assert.deepEqual(second, first, "shard assignment must not depend on input order");
  assert.ok(first.every((shard) => shard.length > 0));

  const runtimeShard = first.findIndex((shard) => shard.includes("test/runtime.test.js"));
  const productionShard = first.findIndex((shard) => shard.includes("test/pantheon-production.test.js"));
  assert.notEqual(runtimeShard, productionShard, "the two largest suites must remain separated");
});

test("local full tests plan five sequential invocations while focused and CI runs stay singular", () => {
  const files = fs.readdirSync(path.join(workspaceRoot, "test"))
    .filter((name) => name.endsWith(".test.js") && name !== "windows-launcher.test.js")
    .sort()
    .map((name) => `test/${name}`);
  const weightForFile = (file) => fs.statSync(path.join(workspaceRoot, file)).size;
  const local = planTestInvocations(
    files,
    {
      explicit: false,
      ci: false,
      lifecycleCi: false,
      localShardCount: LOCAL_ORDINARY_SHARD_COUNT,
    },
    weightForFile,
  );

  assert.equal(local.length, LOCAL_ORDINARY_SHARD_COUNT);
  assert.ok(local.every((invocation) => invocation.length > 0));
  assert.deepEqual(local.flat().sort(), files);
  assert.equal(new Set(local.flat()).size, files.length);
  assert.equal(local.flat().some((file) => file.endsWith("windows-launcher.test.js")), false);

  const focusedFiles = ["test/runtime.test.js", "test/foundation.test.js"];
  assert.deepEqual(
    planTestInvocations(
      focusedFiles,
      { explicit: true, ci: false, lifecycleCi: false },
      weightForFile,
    ),
    [focusedFiles],
  );

  const ci = planTestInvocations(
    files,
    {
      explicit: false,
      ci: true,
      lifecycleCi: false,
      shardCount: LOCAL_ORDINARY_SHARD_COUNT,
      shardIndex: 3,
    },
    weightForFile,
  );
  assert.deepEqual(
    ci,
    [partitionTestFiles(files, LOCAL_ORDINARY_SHARD_COUNT, weightForFile)[3]],
  );
});

test("ordinary runs continue to reject the quarantined Windows lifecycle test", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(workspaceRoot, "scripts", "run-tests.js"), "test/windows-launcher.test.js"],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PANTHEON_LIFECYCLE_CI: "0",
      },
      timeout: 10_000,
      windowsHide: true,
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout || ""}${result.stderr || ""}`,
    /Windows lifecycle integration is quarantined/,
  );
});

test("weighted shards reject invalid configuration", () => {
  assert.throws(
    () => partitionTestFiles(["test/example.test.js"], 0, () => 1),
    /invalid CI test-shard count/,
  );
  assert.throws(
    () => partitionTestFiles(["test/example.test.js"], 1, () => -1),
    /invalid test-file weight/,
  );
});
