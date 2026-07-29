const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const AdmZip = require("adm-zip");

const {
  SOCIAL_MEDIA_MANAGER_CLIENT_CONTROL_V1: buyerIntentSpec,
} = require("../config/buyer-intent-validation-specs");
const {
  __validateGuideInspectionReceiptForTests,
  factoryReadiness,
  normalizeProductBlueprintForFactory,
  renderDigitalProductKit,
} = require("../src/runtime/digital-product-file-factory");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function productCase(overrides = {}) {
  const item = {
    ...buyerIntentSpec.sample.item,
    id: "catalogue_item_renderer_hardening_v1",
  };
  const spec = {
    schema: "pantheon.product-build-spec.v1",
    planId: "catalogue_renderer_hardening_v1",
    opportunityId: "opp-renderer-hardening",
    ventureId: "venture-renderer-hardening",
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
    ...(overrides.spec || {}),
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
    ...(overrides.blueprint || {}),
  };
  return {
    task: {
      id: overrides.taskId || "task-renderer-hardening",
      payload: {
        liveSpendRequest: {
          parameters: { productBuildSpec: spec },
        },
      },
    },
    spec,
    blueprint,
  };
}

test("digital-product rendering is fresh, atomic, and proves ordered three-page evidence", () => {
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-render-hardening-"));
  try {
    const fixture = productCase();
    const first = renderDigitalProductKit(
      fixture.task,
      fixture.blueprint,
      { artifactRoot },
    );
    const firstGuide = first.qualityReviewImages.find(
      (image) => image.filename === "actual-setup-guide.png",
    );
    const coverage = firstGuide.metadata.inspectionCoverage;
    assert.equal(coverage.sourcePageCount, 3);
    assert.equal(coverage.renderedPageCount, 3);
    assert.equal(coverage.completeCoverage, true);
    assert.deepEqual(coverage.pages.map((page) => page.pageNumber), [1, 2, 3]);
    assert.ok(coverage.pages.every((page) => (
      page.width > 0
      && page.height > 0
      && /^[a-f0-9]{64}$/.test(page.rasterSha256)
    )));
    assert.equal(coverage.inspectionSha256, sha256(firstGuide.bytes));

    const firstBundle = first.files.find((file) => file.filename === fixture.spec.bundleFilename);
    const firstArchive = new AdmZip(firstBundle.bytes);
    const sourceGuideBytes = firstArchive.readFile("customer-files/00-customer-setup-guide.pdf");
    assert.ok(sourceGuideBytes);
    assert.equal(coverage.sourceSha256, sha256(sourceGuideBytes));
    assert.equal(
      __validateGuideInspectionReceiptForTests(
        {
          schema: "pantheon.local-quality-inspection.v1",
          images: { "actual-setup-guide.png": coverage },
        },
        sourceGuideBytes,
        firstGuide.bytes,
      ),
      coverage,
    );

    const taskStageRoot = path.join(
      artifactRoot,
      ".staging",
      "digital-product-kits",
      fixture.task.id,
    );
    const firstStages = fs.readdirSync(taskStageRoot);
    assert.equal(firstStages.length, 1);
    assert.ok(firstStages.every((name) => !name.endsWith(".tmp")));
    const stalePath = path.join(
      taskStageRoot,
      firstStages[0],
      "rendered",
      "customer-files",
      "stale-secret.txt",
    );
    fs.writeFileSync(stalePath, "must never enter a later render", "utf8");

    const second = renderDigitalProductKit(
      fixture.task,
      fixture.blueprint,
      { artifactRoot },
    );
    const secondBundle = second.files.find((file) => file.filename === fixture.spec.bundleFilename);
    const secondArchive = new AdmZip(secondBundle.bytes);
    assert.equal(secondArchive.getEntry("customer-files/stale-secret.txt"), null);
    assert.equal(sha256(secondBundle.bytes), sha256(firstBundle.bytes));
    const finalStages = fs.readdirSync(taskStageRoot);
    assert.equal(finalStages.length, 2);
    assert.ok(finalStages.every((name) => !name.endsWith(".tmp")));
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test("guide inspection receipts fail closed when byte or ordered-page bindings are changed", () => {
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-receipt-hardening-"));
  try {
    const fixture = productCase({ taskId: "task-receipt-hardening" });
    const rendered = renderDigitalProductKit(
      fixture.task,
      fixture.blueprint,
      { artifactRoot },
    );
    const guide = rendered.qualityReviewImages.find(
      (image) => image.filename === "actual-setup-guide.png",
    );
    const bundle = rendered.files.find((file) => file.filename === fixture.spec.bundleFilename);
    const sourceGuideBytes = new AdmZip(bundle.bytes)
      .readFile("customer-files/00-customer-setup-guide.pdf");
    const receipt = {
      schema: "pantheon.local-quality-inspection.v1",
      images: {
        "actual-setup-guide.png": guide.metadata.inspectionCoverage,
      },
    };
    for (const mutate of [
      (copy) => { copy.images["actual-setup-guide.png"].sourceRelativePath = "../wrong.pdf"; },
      (copy) => { copy.images["actual-setup-guide.png"].sourceSha256 = "0".repeat(64); },
      (copy) => { copy.images["actual-setup-guide.png"].inspectionSha256 = "0".repeat(64); },
      (copy) => { copy.images["actual-setup-guide.png"].pages.reverse(); },
      (copy) => { copy.images["actual-setup-guide.png"].orderedPageIdentitySha256 = "0".repeat(64); },
    ]) {
      const changed = structuredClone(receipt);
      mutate(changed);
      assert.throws(
        () => __validateGuideInspectionReceiptForTests(
          changed,
          sourceGuideBytes,
          guide.bytes,
        ),
        /byte-bound complete PDF page coverage/i,
      );
    }
    assert.throws(
      () => __validateGuideInspectionReceiptForTests(
        receipt,
        sourceGuideBytes,
        Buffer.concat([guide.bytes, Buffer.from("tampered")]),
      ),
      /byte-bound complete PDF page coverage/i,
    );
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test("renderer output names are safe leaves in both JavaScript and Python", () => {
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-leaf-hardening-"));
  try {
    for (const [field, value] of [
      ["bundleFilename", "..\\escaped-audit.zip"],
      ["bundleFilename", "nested/escaped-audit.zip"],
      ["bundleFilename", "CON.zip"],
      ["bundleFilename", "CON .zip"],
      ["manifestFilename", "..\\escaped-audit.json"],
      ["manifestFilename", "C:\\escaped-audit.json"],
    ]) {
      const fixture = productCase({ spec: { [field]: value } });
      assert.throws(
        () => renderDigitalProductKit(
          fixture.task,
          fixture.blueprint,
          { artifactRoot },
        ),
        /safe leaf filename/i,
      );
    }
    assert.equal(fs.existsSync(path.join(artifactRoot, "escaped-audit.zip")), false);

    const readiness = factoryReadiness({ refresh: true });
    assert.equal(readiness.ready, true, readiness.reason);
    const fixture = productCase({ spec: { bundleFilename: "..\\escaped-python.zip" } });
    const inputPath = path.join(artifactRoot, "unsafe-input.json");
    const outputRoot = path.join(artifactRoot, "python-output");
    fs.writeFileSync(inputPath, JSON.stringify({
      schema: "pantheon.digital-product-factory-input.v1",
      spec: fixture.spec,
      blueprint: fixture.blueprint,
      runtimeNormalizations: [],
    }), "utf8");
    const python = spawnSync(
      readiness.python,
      [readiness.renderer, inputPath, outputRoot],
      { encoding: "utf8", timeout: 30_000 },
    );
    assert.notEqual(python.status, 0);
    assert.match(String(python.stderr || python.stdout), /safe leaf filename/i);
    assert.equal(fs.existsSync(path.join(artifactRoot, "escaped-python.zip")), false);
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test("buyer-facing disclaimer rewriting happens before deduplication and limiting", () => {
  const fixture = productCase();
  const normalized = normalizeProductBlueprintForFactory(
    {
      ...fixture.blueprint,
      disclaimers: [
        "This product is local.",
        "Third supplied disclaimer.",
      ],
    },
    {
      ...fixture.spec,
      validationSample: {
        ...fixture.spec.validationSample,
        disclaimers: [
          "This validation sample is local.",
          "Second required disclaimer.",
        ],
      },
    },
  );
  assert.deepEqual(normalized.blueprint.disclaimers, [
    "This product is local.",
    "Second required disclaimer.",
    "Third supplied disclaimer.",
  ]);
});
