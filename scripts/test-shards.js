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

module.exports = {
  partitionTestFiles,
  selectTestShard,
};
