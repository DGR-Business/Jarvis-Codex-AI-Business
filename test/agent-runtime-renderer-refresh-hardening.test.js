const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const CONFIG = require("../src/config");
const {
  SOCIAL_MEDIA_MANAGER_CLIENT_CONTROL_V1: buyerIntentSpec,
} = require("../config/buyer-intent-validation-specs");
const {
  all,
  fromJson,
  get,
  now,
  openDatabase,
  run,
  toJson,
} = require("../src/db");
const {
  __setDigitalProductFactoryForTests,
  refreshLocalDigitalProductFiles,
  renderRetainedProductBuilderOutput,
} = require("../src/runtime/agent-runtime");
const {
  renderDigitalProductKit,
} = require("../src/runtime/digital-product-file-factory");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function productCase(taskId) {
  const item = {
    ...buyerIntentSpec.sample.item,
    id: "catalogue_item_refresh_hardening_v1",
  };
  const spec = {
    schema: "pantheon.product-build-spec.v1",
    planId: "catalogue_refresh_hardening_v1",
    revisionNumber: 1,
    opportunityId: "opp-refresh-hardening",
    ventureId: "venture-refresh-hardening",
    catalogueItems: [{
      id: item.id,
      title: item.title,
      audience: buyerIntentSpec.buyer,
      offer: buyerIntentSpec.offer,
      priceCents: buyerIntentSpec.priceCents,
    }],
    manifestFilename: "pantheon-product-manifest.json",
    bundleFilename: "client-control-and-profitability-workbook.zip",
    storefrontPreviewCount: 2,
    validationSample: {
      packageTitle: item.title,
      customerPromise: buyerIntentSpec.sample.customerPromise,
      setupSteps: buyerIntentSpec.sample.setupSteps,
      disclaimers: buyerIntentSpec.sample.disclaimers,
      exactItemBlueprint: item,
      noFullCatalogueAuthorised: true,
    },
  };
  const blueprint = {
    schema: "pantheon.product-blueprint.v3",
    packageTitle: item.title,
    customerPromise: buyerIntentSpec.sample.customerPromise,
    setupSteps: buyerIntentSpec.sample.setupSteps,
    disclaimers: [
      ...buyerIntentSpec.sample.disclaimers,
      "Keep a separate archival copy and review every page before use. ".repeat(10),
    ],
    catalogueItems: [item],
  };
  const production = {
    stage: "product_build",
    planId: spec.planId,
    revisionNumber: spec.revisionNumber,
  };
  const payload = {
    liveSpendRequest: {
      tools: ["product_file_factory"],
      parameters: {
        productBuildSpec: spec,
        pantheonProduction: production,
      },
    },
  };
  return {
    task: {
      id: taskId,
      workflow_id: `workflow-${taskId}`,
      venture_id: null,
      title: "Build the exact retained product package",
      kind: "live_ai_worker_execution",
      agent: "product_builder",
      status: "completed",
      payload,
      result: {},
    },
    spec,
    production,
    blueprint,
  };
}

async function setupRefreshRuntime(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-refresh-${name}-`));
  const artifactRoot = path.join(root, "artifacts");
  const fixture = productCase(`task-refresh-${name}`);
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  const timestamp = now();
  run(
    db,
    `INSERT INTO workflows
     (id, type, title, status, current_step, priority, metadata, created_at, updated_at)
     VALUES (?, 'product_build', 'Renderer refresh hardening fixture', 'completed',
       'Product files retained', 1, '{}', ?, ?)`,
    [fixture.task.workflow_id, timestamp, timestamp],
  );
  run(
    db,
    `INSERT INTO tasks
     (id, workflow_id, title, kind, agent, status, payload, result, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    [
      fixture.task.id,
      fixture.task.workflow_id,
      fixture.task.title,
      fixture.task.kind,
      fixture.task.agent,
      fixture.task.status,
      toJson(fixture.task.payload),
      timestamp,
      timestamp,
    ],
  );
  const recoveryTask = {
    ...fixture.task,
    agent: "jarvis",
    kind: "local_product_output_recovery",
    payload: {
      liveSpendRequest: {
        provider: "pantheon-local-runtime",
        tools: ["product_file_factory"],
        parameters: {
          productBuildSpec: fixture.spec,
          pantheonProduction: fixture.production,
        },
      },
    },
  };
  const { generatedFiles } = await renderRetainedProductBuilderOutput(
    db,
    recoveryTask,
    { work: { productBlueprint: fixture.blueprint } },
    {
      artifactRoot,
      rendererRevision: "legacy-renderer-v0",
    },
  );
  generatedFiles.blueprint = null;
  const result = { output: { generatedFiles } };
  run(
    db,
    "UPDATE tasks SET result = ? WHERE id = ?",
    [toJson(result), fixture.task.id],
  );
  return {
    root,
    artifactRoot,
    db,
    fixture,
    generatedFiles,
  };
}

function closeRefreshRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function resolvedFilePath(item) {
  return path.resolve(
    path.isAbsolute(item.filePath)
      ? item.filePath
      : path.join(CONFIG.rootDir, item.filePath),
  );
}

function exactIdHashSnapshot(items) {
  return items
    .map((item) => ({ id: item.id, sha256: item.sha256 }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function retainedByteSnapshot(generatedFiles) {
  return [
    ...generatedFiles.files,
    ...generatedFiles.previews,
    ...generatedFiles.qualityReviewImages,
  ].map((item) => ({
    id: item.id,
    filePath: item.filePath,
    sha256: sha256(fs.readFileSync(resolvedFilePath(item))),
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function artifactTreeSnapshot(root) {
  const entries = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        entries.push({ type: "directory", path: relativePath });
        walk(fullPath);
      } else if (entry.isFile()) {
        const bytes = fs.readFileSync(fullPath);
        entries.push({
          type: "file",
          path: relativePath,
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function frozenFactoryInputs(runtime) {
  const stageRoot = path.join(
    runtime.artifactRoot,
    ".staging",
    "digital-product-kits",
    runtime.fixture.task.id,
  );
  return fs.readdirSync(stageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(stageRoot, entry.name, "factory-input.json"))
    .filter((candidate) => fs.existsSync(candidate))
    .map((filePath) => ({
      filePath,
      input: JSON.parse(fs.readFileSync(filePath, "utf8")),
    }));
}

function databaseSnapshot(runtime) {
  return {
    task: get(
      runtime.db,
      "SELECT result, updated_at FROM tasks WHERE id = ?",
      [runtime.fixture.task.id],
    ),
    deliverables: JSON.stringify(all(
      runtime.db,
      "SELECT * FROM deliverables ORDER BY id",
    )),
    events: JSON.stringify(all(runtime.db, "SELECT * FROM events ORDER BY id")),
    cataloguePlans: JSON.stringify(all(
      runtime.db,
      "SELECT * FROM catalogue_plans ORDER BY id",
    )),
  };
}

function assertDatabaseSnapshot(runtime, expected) {
  assert.deepEqual(
    get(
      runtime.db,
      "SELECT result, updated_at FROM tasks WHERE id = ?",
      [runtime.fixture.task.id],
    ),
    expected.task,
  );
  assert.equal(
    JSON.stringify(all(runtime.db, "SELECT * FROM deliverables ORDER BY id")),
    expected.deliverables,
  );
  assert.equal(
    JSON.stringify(all(runtime.db, "SELECT * FROM events ORDER BY id")),
    expected.events,
  );
  assert.equal(
    JSON.stringify(all(runtime.db, "SELECT * FROM catalogue_plans ORDER BY id")),
    expected.cataloguePlans,
  );
}

test("renderer refresh recovers the exact source blueprint and retains immutable QA revisions", async () => {
  const runtime = await setupRefreshRuntime("source-blueprint");
  try {
    const frozenInput = frozenFactoryInputs(runtime).find(
      ({ input }) => input.sourceBlueprintHash === runtime.generatedFiles.blueprintHash,
    );
    assert.ok(frozenInput);
    assert.deepEqual(frozenInput.input.sourceBlueprint, runtime.fixture.blueprint);
    assert.notDeepEqual(frozenInput.input.blueprint, runtime.fixture.blueprint);

    const poisonRoot = path.join(
      path.dirname(path.dirname(frozenInput.filePath)),
      ".uncommitted-poison.tmp",
    );
    fs.mkdirSync(poisonRoot, { recursive: true });
    const poisonBlueprint = {
      ...runtime.fixture.blueprint,
      packageTitle: "Uncommitted Poison Blueprint",
    };
    fs.writeFileSync(
      path.join(poisonRoot, "factory-input.json"),
      JSON.stringify({
        ...frozenInput.input,
        sourceBlueprint: poisonBlueprint,
        sourceBlueprintHash: sha256(Buffer.from(JSON.stringify(poisonBlueprint))),
      }),
      "utf8",
    );

    const historicalQa = runtime.generatedFiles.qualityReviewImages.map((item) => ({
      ...item,
      bytes: fs.readFileSync(resolvedFilePath(item)),
      row: get(runtime.db, "SELECT * FROM deliverables WHERE id = ?", [item.id]),
    }));
    const originalPackage = exactIdHashSnapshot(runtime.generatedFiles.files);
    const originalPreviews = exactIdHashSnapshot(runtime.generatedFiles.previews);
    const originalQaRowCount = get(
      runtime.db,
      "SELECT COUNT(*) AS count FROM deliverables WHERE title = 'Product File Review'",
    ).count;

    const refreshed = await refreshLocalDigitalProductFiles(
      runtime.db,
      runtime.fixture.task.id,
      {
        artifactRoot: runtime.artifactRoot,
        rendererRevision: "pdf-all-pages-v1",
      },
    );

    assert.deepEqual(exactIdHashSnapshot(refreshed.files), originalPackage);
    assert.deepEqual(exactIdHashSnapshot(refreshed.previews), originalPreviews);
    assert.equal(refreshed.blueprintHash, runtime.generatedFiles.blueprintHash);
    assert.deepEqual(refreshed.blueprint, runtime.fixture.blueprint);
    assert.equal(refreshed.qualityReviewImages.length, 2);
    assert.ok(refreshed.qualityReviewImages.every(
      (item) => item.rendererRevision === "pdf-all-pages-v1",
    ));
    assert.ok(refreshed.qualityReviewImages.every(
      (item) => !historicalQa.some((historical) => historical.id === item.id),
    ));
    assert.ok(refreshed.qualityReviewImages.every(
      (item) => !historicalQa.some((historical) => historical.filePath === item.filePath),
    ));

    for (const historical of historicalQa) {
      const row = get(
        runtime.db,
        "SELECT * FROM deliverables WHERE id = ?",
        [historical.id],
      );
      assert.deepEqual(row, historical.row);
      assert.deepEqual(fs.readFileSync(resolvedFilePath(historical)), historical.bytes);
    }
    assert.equal(
      get(
        runtime.db,
        "SELECT COUNT(*) AS count FROM deliverables WHERE title = 'Product File Review'",
      ).count,
      originalQaRowCount + 2,
    );

    const taskResult = fromJson(get(
      runtime.db,
      "SELECT result FROM tasks WHERE id = ?",
      [runtime.fixture.task.id],
    ).result, {});
    const receipt = taskResult.output.localRendererRefresh;
    const previousGuide = receipt.previousFiles.find(
      (item) => item.archiveEntry === "customer-files/00-customer-setup-guide.pdf",
    );
    const currentGuide = receipt.currentFiles.find(
      (item) => item.archiveEntry === "customer-files/00-customer-setup-guide.pdf",
    );
    const currentGuideReview = receipt.currentQualityReviewImages.find(
      (item) => item.evidenceRole === "setup_guide_inspection",
    );
    assert.equal(previousGuide.humanName, "00-customer-setup-guide.pdf");
    assert.equal(currentGuide.humanName, "00-customer-setup-guide.pdf");
    assert.equal(currentGuide.sha256, currentGuideReview.inspectionCoverage.sourceSha256);
    assert.equal(currentGuideReview.inspectionCoverage.sourcePageCount, 3);
    assert.equal(currentGuideReview.inspectionCoverage.renderedPageCount, 3);
    assert.equal(currentGuideReview.inspectionCoverage.completeCoverage, true);
    assert.deepEqual(
      currentGuideReview.inspectionCoverage.pages.map((page) => page.pageNumber),
      [1, 2, 3],
    );
    assert.equal(
      currentGuideReview.inspectionCoverage.inspectionSha256,
      currentGuideReview.sha256,
    );
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls").count,
      0,
    );

    const repeatState = databaseSnapshot(runtime);
    const repeatArtifacts = artifactTreeSnapshot(runtime.artifactRoot);
    const repeated = await refreshLocalDigitalProductFiles(
      runtime.db,
      runtime.fixture.task.id,
      {
        artifactRoot: runtime.artifactRoot,
        rendererRevision: "pdf-all-pages-v1",
      },
    );
    assert.deepEqual(
      repeated.qualityReviewImages.map((item) => item.id),
      refreshed.qualityReviewImages.map((item) => item.id),
    );
    assert.deepEqual(
      repeated.qualityReviewImages.map((item) => item.filePath),
      refreshed.qualityReviewImages.map((item) => item.filePath),
    );
    assert.equal(
      get(
        runtime.db,
        "SELECT COUNT(*) AS count FROM deliverables WHERE title = 'Product File Review'",
      ).count,
      originalQaRowCount + 2,
    );
    assertDatabaseSnapshot(runtime, repeatState);
    assert.deepEqual(artifactTreeSnapshot(runtime.artifactRoot), repeatArtifacts);
  } finally {
    closeRefreshRuntime(runtime);
  }
});

test("changed or corrupt fallback candidates leave DB and current files untouched", async () => {
  const runtime = await setupRefreshRuntime("candidate-rejection");
  try {
    const changedBlueprint = {
      ...runtime.fixture.blueprint,
      disclaimers: [
        ...buyerIntentSpec.sample.disclaimers,
        "This deliberately different frozen fallback must change the customer setup guide. ".repeat(10),
      ],
    };
    const changedHash = sha256(Buffer.from(JSON.stringify(changedBlueprint)));
    renderDigitalProductKit(
      runtime.fixture.task,
      changedBlueprint,
      { artifactRoot: runtime.artifactRoot },
    );
    const changedInputs = frozenFactoryInputs(runtime).filter(
      ({ input }) => input.sourceBlueprintHash === changedHash,
    );
    assert.equal(changedInputs.length, 1);

    const taskRow = get(
      runtime.db,
      "SELECT result FROM tasks WHERE id = ?",
      [runtime.fixture.task.id],
    );
    const changedResult = fromJson(taskRow.result, {});
    changedResult.output.generatedFiles.blueprint = null;
    changedResult.output.generatedFiles.blueprintHash = changedHash;
    run(
      runtime.db,
      "UPDATE tasks SET result = ? WHERE id = ?",
      [toJson(changedResult), runtime.fixture.task.id],
    );

    const stateBefore = databaseSnapshot(runtime);
    const artifactsBefore = artifactTreeSnapshot(runtime.artifactRoot);
    const currentBytesBefore = retainedByteSnapshot(changedResult.output.generatedFiles);
    await assert.rejects(
      refreshLocalDigitalProductFiles(
        runtime.db,
        runtime.fixture.task.id,
        {
          artifactRoot: runtime.artifactRoot,
          rendererRevision: "rejected-pdf-renderer-v2",
        },
      ),
      /before persistence because the customer package or storefront previews changed/i,
    );
    assertDatabaseSnapshot(runtime, stateBefore);
    assert.deepEqual(
      retainedByteSnapshot(changedResult.output.generatedFiles),
      currentBytesBefore,
    );
    assert.deepEqual(artifactTreeSnapshot(runtime.artifactRoot), artifactsBefore);

    const missingHashResult = fromJson(
      get(runtime.db, "SELECT result FROM tasks WHERE id = ?", [runtime.fixture.task.id]).result,
      {},
    );
    missingHashResult.output.generatedFiles.blueprintHash = null;
    run(
      runtime.db,
      "UPDATE tasks SET result = ? WHERE id = ?",
      [toJson(missingHashResult), runtime.fixture.task.id],
    );
    const missingHashState = databaseSnapshot(runtime);
    const missingHashArtifacts = artifactTreeSnapshot(runtime.artifactRoot);
    await assert.rejects(
      refreshLocalDigitalProductFiles(
        runtime.db,
        runtime.fixture.task.id,
        {
          artifactRoot: runtime.artifactRoot,
          rendererRevision: "rejected-pdf-renderer-v2",
        },
      ),
      /exact frozen Product Builder blueprint hash is unavailable/i,
    );
    assertDatabaseSnapshot(runtime, missingHashState);
    assert.deepEqual(
      artifactTreeSnapshot(runtime.artifactRoot),
      missingHashArtifacts,
    );
    missingHashResult.output.generatedFiles.blueprintHash = changedHash;
    run(
      runtime.db,
      "UPDATE tasks SET result = ? WHERE id = ?",
      [toJson(missingHashResult), runtime.fixture.task.id],
    );

    for (const { filePath, input } of frozenFactoryInputs(runtime)) {
      if (input.sourceBlueprintHash !== changedHash) continue;
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          ...input,
          sourceBlueprintHash: "0".repeat(64),
        }),
        "utf8",
      );
    }
    const corruptFallbackState = databaseSnapshot(runtime);
    const corruptFallbackArtifacts = artifactTreeSnapshot(runtime.artifactRoot);
    const corruptFallbackBytes = retainedByteSnapshot(
      changedResult.output.generatedFiles,
    );
    await assert.rejects(
      refreshLocalDigitalProductFiles(
        runtime.db,
        runtime.fixture.task.id,
        {
          artifactRoot: runtime.artifactRoot,
          rendererRevision: "rejected-pdf-renderer-v2",
        },
      ),
      /no matching frozen Product Builder blueprint was found/i,
    );
    assertDatabaseSnapshot(runtime, corruptFallbackState);
    assert.deepEqual(
      retainedByteSnapshot(changedResult.output.generatedFiles),
      corruptFallbackBytes,
    );
    assert.deepEqual(
      artifactTreeSnapshot(runtime.artifactRoot),
      corruptFallbackArtifacts,
    );
  } finally {
    closeRefreshRuntime(runtime);
  }
});

test("historical QA revision IDs reject changed replay bytes without partial mutation", async () => {
  const runtime = await setupRefreshRuntime("immutable-qa-replay");
  try {
    const revisionOne = await refreshLocalDigitalProductFiles(
      runtime.db,
      runtime.fixture.task.id,
      {
        artifactRoot: runtime.artifactRoot,
        rendererRevision: "immutable-qa-v1",
      },
    );
    await refreshLocalDigitalProductFiles(
      runtime.db,
      runtime.fixture.task.id,
      {
        artifactRoot: runtime.artifactRoot,
        rendererRevision: "immutable-qa-v2",
      },
    );
    const historicalRows = revisionOne.qualityReviewImages.map((item) => ({
      item,
      row: get(runtime.db, "SELECT * FROM deliverables WHERE id = ?", [item.id]),
      bytes: fs.readFileSync(resolvedFilePath(item)),
    }));
    const stateBefore = databaseSnapshot(runtime);
    const artifactsBefore = artifactTreeSnapshot(runtime.artifactRoot);

    __setDigitalProductFactoryForTests(async (task, blueprint, options) => {
      const rendered = renderDigitalProductKit(task, blueprint, options);
      const workbook = rendered.qualityReviewImages.find(
        (item) => item.metadata?.evidenceRole === "workbook_inspection",
      );
      return {
        ...rendered,
        qualityReviewImages: rendered.qualityReviewImages.map((item) => (
          item.metadata?.evidenceRole === "setup_guide_inspection"
            ? {
              ...item,
              bytes: workbook.bytes,
              metadata: {
                ...item.metadata,
                inspectionCoverage: {
                  ...(item.metadata?.inspectionCoverage || {}),
                  inspectionSha256: sha256(workbook.bytes),
                },
              },
            }
            : item
        )),
      };
    });
    await assert.rejects(
      refreshLocalDigitalProductFiles(
        runtime.db,
        runtime.fixture.task.id,
        {
          artifactRoot: runtime.artifactRoot,
          rendererRevision: "immutable-qa-v1",
        },
      ),
      /before persistence because quality-review revision immutable-qa-v1 already contains different bytes/i,
    );
    assertDatabaseSnapshot(runtime, stateBefore);
    assert.deepEqual(artifactTreeSnapshot(runtime.artifactRoot), artifactsBefore);
    for (const historical of historicalRows) {
      assert.deepEqual(
        get(runtime.db, "SELECT * FROM deliverables WHERE id = ?", [historical.item.id]),
        historical.row,
      );
      assert.deepEqual(fs.readFileSync(resolvedFilePath(historical.item)), historical.bytes);
    }
  } finally {
    __setDigitalProductFactoryForTests(null);
    closeRefreshRuntime(runtime);
  }
});
