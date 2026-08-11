const path = require("node:path");

const LOCAL_ORDINARY_SHARD_COUNT = 5;
const ORDINARY_TEST_WEIGHT_FLOORS = Object.freeze({
  "pantheon-backup-recovery-set.test.js": 900_000,
  "pantheon-backup-doctor.test.js": 450_000,
  "preventure-research-terminal-retained-recovery.test.js": 300_000,
  "runtime.test.js": 300_000,
  "pantheon-production.test.js": 250_000,
  "preventure-research-credential-persistence.test.js": 120_000,
});

function ordinaryTestWeight(file, fileSize) {
  const measuredSize = Number(fileSize);
  if (!Number.isFinite(measuredSize) || measuredSize < 0) {
    throw new Error(`Pantheon received an invalid test-file size for ${file}.`);
  }
  // File size is a useful default proxy, but encrypted recovery, process-child,
  // and exhaustive SQLite fault suites do substantially more work per byte.
  // Static floors keep all five ordinary shards deterministic while preventing
  // those known suites from sharing one four-minute process budget.
  const runtimeFloor = ORDINARY_TEST_WEIGHT_FLOORS[path.basename(file)] || 0;
  return Math.max(measuredSize, runtimeFloor);
}

function lexicalCompare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function partitionTestFiles(files, shardCount, weightForFile) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error("Pantheon received an invalid CI test-shard count.");
  }
  if (typeof weightForFile !== "function") {
    throw new TypeError("Pantheon requires a test-file weight resolver.");
  }

  const weightedFiles = files.map((file) => {
    const weight = Number(weightForFile(file));
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`Pantheon received an invalid test-file weight for ${file}.`);
    }
    return { file, weight };
  }).sort((left, right) => (
    right.weight - left.weight || lexicalCompare(left.file, right.file)
  ));

  const shards = Array.from(
    { length: shardCount },
    (_, index) => ({ index, files: [], weight: 0 }),
  );
  for (const entry of weightedFiles) {
    const target = shards.reduce((lightest, candidate) => {
      if (candidate.weight < lightest.weight) return candidate;
      if (candidate.weight > lightest.weight) return lightest;
      return candidate.index < lightest.index ? candidate : lightest;
    });
    target.files.push(entry.file);
    target.weight += entry.weight;
  }

  return shards.map((shard) => shard.files.sort(lexicalCompare));
}

function selectTestShard(files, shardCount, shardIndex, weightForFile) {
  if (
    !Number.isInteger(shardIndex)
    || shardIndex < 0
    || shardIndex >= shardCount
  ) {
    throw new Error("Pantheon received an invalid CI test-shard index.");
  }
  return partitionTestFiles(files, shardCount, weightForFile)[shardIndex];
}

function planTestInvocations(files, options, weightForFile) {
  if (!Array.isArray(files)) {
    throw new TypeError("Pantheon requires a test-file list.");
  }
  if (!options || typeof options !== "object") {
    throw new TypeError("Pantheon requires test invocation options.");
  }
  if (options.explicit === true || options.lifecycleCi === true) {
    return [files];
  }
  if (options.ci === true) {
    return [[...selectTestShard(
      files,
      options.shardCount,
      options.shardIndex,
      weightForFile,
    )]];
  }
  return partitionTestFiles(
    files,
    options.localShardCount ?? LOCAL_ORDINARY_SHARD_COUNT,
    weightForFile,
  ).filter((shard) => shard.length > 0);
}

module.exports = {
  LOCAL_ORDINARY_SHARD_COUNT,
  ORDINARY_TEST_WEIGHT_FLOORS,
  ordinaryTestWeight,
  partitionTestFiles,
  planTestInvocations,
  selectTestShard,
};
