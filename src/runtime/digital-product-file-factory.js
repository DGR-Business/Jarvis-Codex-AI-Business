const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const CONFIG = require("../config");
const { rendererReadiness } = require("./renderer-environment");

const PRODUCT_BLUEPRINT_SCHEMA = "pantheon.product-blueprint.v3";
const LEGACY_PRODUCT_BLUEPRINT_SCHEMAS = new Set([
  "pantheon.product-blueprint.v1",
  "pantheon.product-blueprint.v2",
]);
const CALCULATION_OPERATIONS = new Set(["multiply", "sum", "subtract", "percent_of"]);
const RENDERED_COLUMN_MAX = 18;

function safeId(value, fallback = "product-kit") {
  return String(value || fallback)
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 80) || fallback;
}

const WINDOWS_RESERVED_LEAF_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
]);

function safeOutputLeaf(value, label, requiredExtension) {
  const filename = String(value || "").trim();
  const reservedStem = filename.split(".", 1)[0].replace(/[ .]+$/g, "").toUpperCase();
  const containsControlCharacter = [...filename].some(
    (character) => character.charCodeAt(0) <= 0x1f,
  );
  if (
    !filename
    || filename === "."
    || filename === ".."
    || filename !== path.basename(filename)
    || filename !== path.posix.basename(filename)
    || filename !== path.win32.basename(filename)
    || path.isAbsolute(filename)
    || path.posix.isAbsolute(filename)
    || path.win32.isAbsolute(filename)
    || containsControlCharacter
    || /[\\/<>:"|?*]/.test(filename)
    || /[ .]$/.test(filename)
    || WINDOWS_RESERVED_LEAF_NAMES.has(reservedStem)
    || path.extname(filename).toLowerCase() !== requiredExtension
  ) {
    throw new Error(`${label} must be a safe leaf filename ending in ${requiredExtension}.`);
  }
  return filename;
}

function containedOutputLeaf(root, filename, label) {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, filename);
  if (path.dirname(candidate) !== resolvedRoot) {
    throw new Error(`${label} escapes the renderer output directory.`);
  }
  return candidate;
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateGuideInspectionReceipt(
  qualityInspection,
  sourceGuideBytes,
  guideInspectionBytes,
) {
  const guideInspection = qualityInspection?.images?.["actual-setup-guide.png"];
  const pages = Array.isArray(guideInspection?.pages) ? guideInspection.pages : [];
  const sourcePageCount = Number(guideInspection?.sourcePageCount || 0);
  const renderedPageCount = Number(guideInspection?.renderedPageCount || 0);
  const pageIdentitiesValid = (
    pages.length === sourcePageCount
    && pages.every((page, index) => (
      Number.isInteger(page?.pageNumber)
      && page.pageNumber === index + 1
      && Number.isInteger(page?.width)
      && page.width > 0
      && Number.isInteger(page?.height)
      && page.height > 0
      && /^[a-f0-9]{64}$/.test(String(page?.rasterSha256 || ""))
    ))
  );
  const orderedPageIdentitySha256 = sha256Bytes(
    Buffer.from(canonicalJson(pages), "utf8"),
  );
  if (
    qualityInspection?.schema !== "pantheon.local-quality-inspection.v1"
    || !guideInspection
    || guideInspection.sourceFile !== "00-customer-setup-guide.pdf"
    || guideInspection.sourceRelativePath !== "customer-files/00-customer-setup-guide.pdf"
    || guideInspection.sourceSha256 !== sha256Bytes(sourceGuideBytes)
    || guideInspection.inspectionFile !== "actual-setup-guide.png"
    || guideInspection.inspectionRelativePath !== "quality-review/actual-setup-guide.png"
    || guideInspection.inspectionSha256 !== sha256Bytes(guideInspectionBytes)
    || guideInspection.orderedPageIdentitySha256 !== orderedPageIdentitySha256
    || guideInspection.completeCoverage !== true
    || !Number.isInteger(sourcePageCount)
    || sourcePageCount < 1
    || !Number.isInteger(renderedPageCount)
    || renderedPageCount !== sourcePageCount
    || !pageIdentitiesValid
  ) {
    throw new Error("Local setup-guide inspection does not prove byte-bound complete PDF page coverage.");
  }
  return guideInspection;
}

function removeFreshStage(stageRoot, taskStageRoot) {
  const resolvedStage = path.resolve(stageRoot);
  const resolvedParent = path.resolve(taskStageRoot);
  if (
    path.dirname(resolvedStage) !== resolvedParent
    || !path.basename(resolvedStage).endsWith(".tmp")
  ) {
    throw new Error("Pantheon refused to clean an unexpected renderer staging path.");
  }
  fs.rmSync(resolvedStage, { recursive: true, force: true });
}

function fieldReference(value) {
  return String(value || "")
    .replace(/%/g, " percent ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buyerFacingValidationText(value) {
  return String(value || "")
    .replace(/\bvalidation sample\b/gi, "product")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeRequiredList(required, supplied, limit) {
  return [...new Set([
    ...(Array.isArray(required) ? required : []),
    ...(Array.isArray(supplied) ? supplied : []),
  ].map((item) => String(item || "").trim()).filter(Boolean))].slice(0, limit);
}

function normalizeProductBlueprintForFactory(blueprint, spec = {}) {
  const source = blueprint && typeof blueprint === "object"
    ? blueprint
    : {};
  const normalized = JSON.parse(JSON.stringify(source));
  const normalizations = [];
  if (
    normalized.schema !== PRODUCT_BLUEPRINT_SCHEMA
    || !Array.isArray(normalized.catalogueItems)
  ) {
    return { blueprint: normalized, normalizations };
  }
  const validationSample = spec?.validationSample;
  const exactItem = validationSample?.exactItemBlueprint;
  if (exactItem && normalized.catalogueItems.length === 1) {
    const item = normalized.catalogueItems[0];
    const before = JSON.stringify({
      packageTitle: normalized.packageTitle,
      customerPromise: normalized.customerPromise,
      setupSteps: normalized.setupSteps,
      disclaimers: normalized.disclaimers,
      item,
    });
    normalized.packageTitle = String(
      exactItem.title
      || validationSample.packageTitle
      || normalized.packageTitle
      || "",
    ).trim();
    normalized.customerPromise = String(
      validationSample.customerPromise || normalized.customerPromise || "",
    ).trim();
    normalized.setupSteps = mergeRequiredList(
      validationSample.setupSteps,
      normalized.setupSteps,
      6,
    );
    normalized.disclaimers = mergeRequiredList(
      (Array.isArray(validationSample.disclaimers) ? validationSample.disclaimers : [])
        .map(buyerFacingValidationText),
      (Array.isArray(normalized.disclaimers) ? normalized.disclaimers : [])
        .map(buyerFacingValidationText),
      3,
    );
    item.id = String(exactItem.id || item.id || "").trim();
    item.title = String(exactItem.title || item.title || "").trim();
    item.purpose = String(exactItem.purpose || item.purpose || "").trim();
    item.instructions = mergeRequiredList(
      exactItem.instructions,
      item.instructions,
      5,
    );
    item.columns = JSON.parse(JSON.stringify(exactItem.columns || []));
    item.sampleRows = JSON.parse(JSON.stringify(exactItem.sampleRows || []));
    item.calculations = JSON.parse(JSON.stringify(exactItem.calculations || []));
    if (before !== JSON.stringify({
      packageTitle: normalized.packageTitle,
      customerPromise: normalized.customerPromise,
      setupSteps: normalized.setupSteps,
      disclaimers: normalized.disclaimers,
      item,
    })) {
      normalizations.push({
        code: "validation_contract_reconciled",
        itemId: item.id,
        fieldName: null,
        sampleValue: null,
        reason: "The approved buyer-test contract, not the model draft, defines the final fields, formulas, dropdowns, and sample records.",
      });
    }
  }
  for (const item of normalized.catalogueItems) {
    const columns = Array.isArray(item.columns) ? item.columns : [];
    const rows = Array.isArray(item.sampleRows) ? item.sampleRows : [];
    const calculations = Array.isArray(item.calculations) ? item.calculations : [];
    for (const calculation of calculations) {
      const target = String(calculation?.target || "").trim();
      if (!target || columns.some((column) => fieldReference(column.name) === fieldReference(target))) {
        continue;
      }
      if (columns.length >= RENDERED_COLUMN_MAX) {
        throw new Error(
          `Product blueprint item ${item.id} is missing calculated field ${target}, `
          + `but all ${RENDERED_COLUMN_MAX} safe rendered field positions are already used.`,
        );
      }
      const inputTypes = (Array.isArray(calculation.inputs) ? calculation.inputs : [])
        .map((input) => columns.find((column) => fieldReference(column.name) === fieldReference(input))?.type)
        .filter(Boolean);
      const type = calculation.operation === "percent_of"
        ? "percent"
        : inputTypes.includes("currency")
          ? "currency"
          : "number";
      columns.push({
        name: target,
        type,
        guidance: `Calculated automatically from ${calculation.inputs.join(" and ")}.`,
        options: [],
      });
      for (const row of rows) {
        if (Array.isArray(row)) row.push("");
      }
      normalizations.push({
        code: "calculated_target_added_by_runtime",
        itemId: String(item.id || ""),
        fieldName: target,
        sampleValue: "",
        reason: `Pantheon added the declared ${calculation.operation} result field so the approved calculation can exist in the workbook.`,
      });
    }
    const workflowStatus = columns.find((column) => (
      column?.type === "status"
      && /(?:^|\s)status$/i.test(String(column.name || "").trim())
    ));
    if (workflowStatus) continue;
    if (columns.length >= RENDERED_COLUMN_MAX) {
      throw new Error(
        `Product blueprint item ${item.id} needs a dedicated Status or workflow-status field, `
        + `but all ${RENDERED_COLUMN_MAX} safe rendered field positions are already used.`,
      );
    }
    const field = {
      name: "Workflow Status",
      type: "status",
      guidance: "Choose the current stage of this record so the workbook dashboard can summarize progress.",
      options: ["Not Started", "In Progress", "Ready", "Complete"],
    };
    columns.push(field);
    item.columns = columns;
    for (const row of rows) {
      if (Array.isArray(row)) row.push("In Progress");
    }
    normalizations.push({
      code: "workflow_status_added_by_runtime",
      itemId: String(item.id || ""),
      fieldName: field.name,
      sampleValue: "In Progress",
      reason: "Pantheon added its standard workflow field so the generated workbook has a truthful progress dashboard.",
    });
  }
  return { blueprint: normalized, normalizations };
}

function assertBlueprintMatchesSpec(spec, blueprint) {
  if (!spec || spec.schema !== "pantheon.product-build-spec.v1") {
    throw new Error("Product Builder is missing the exact approved product-build specification.");
  }
  if (
    !blueprint
    || (
      blueprint.schema !== PRODUCT_BLUEPRINT_SCHEMA
      && !LEGACY_PRODUCT_BLUEPRINT_SCHEMAS.has(blueprint.schema)
    )
  ) {
    throw new Error(`Product Builder must return blueprint schema ${PRODUCT_BLUEPRINT_SCHEMA}.`);
  }
  const expectedItems = Array.isArray(spec.catalogueItems) ? spec.catalogueItems : [];
  const actualItems = Array.isArray(blueprint.catalogueItems) ? blueprint.catalogueItems : [];
  const validationSample = spec?.validationSample;
  const minimumItems = validationSample?.noFullCatalogueAuthorised === true ? 1 : 3;
  const maximumItems = validationSample?.noFullCatalogueAuthorised === true ? 1 : 6;
  if (
    expectedItems.length < minimumItems
    || expectedItems.length > maximumItems
    || actualItems.length !== expectedItems.length
  ) {
    throw new Error("The product blueprint must cover every approved catalogue item exactly once.");
  }
  const expectedIds = expectedItems.map((item) => String(item.id));
  const actualIds = actualItems.map((item) => String(item.id));
  if (new Set(actualIds).size !== actualIds.length || expectedIds.some((id) => !actualIds.includes(id))) {
    throw new Error("The product blueprint item IDs do not match the exact approved catalogue.");
  }
  for (const item of actualItems) {
    const columns = Array.isArray(item.columns) ? item.columns : [];
    const rows = Array.isArray(item.sampleRows) ? item.sampleRows : [];
    const names = columns.map((column) => String(column.name || "").trim().toLowerCase());
    if (
      columns.length < 4
      || columns.length > RENDERED_COLUMN_MAX
      || names.some((name) => !name)
      || new Set(names).size !== names.length
    ) {
      throw new Error(`Product blueprint item ${item.id} needs 4-${RENDERED_COLUMN_MAX} unique, named columns.`);
    }
    if (!rows.length || rows.length > 3 || rows.some((row) => !Array.isArray(row) || row.length !== columns.length)) {
      throw new Error(`Product blueprint item ${item.id} has invalid sample-row coverage.`);
    }
    if (!Array.isArray(item.instructions) || item.instructions.length < 2) {
      throw new Error(`Product blueprint item ${item.id} needs practical customer instructions.`);
    }
    if (blueprint.schema === PRODUCT_BLUEPRINT_SCHEMA) {
      for (const column of columns) {
        const options = Array.isArray(column.options) ? column.options.map((value) => String(value || "").trim()) : null;
        if (!options) {
          throw new Error(`Product blueprint item ${item.id} field ${column.name || "unnamed"} is missing its dropdown options array.`);
        }
        if (column.type !== "status" && options.length > 0) {
          throw new Error(`Product blueprint item ${item.id} field ${column.name} can only declare options when its type is status.`);
        }
        if (column.type === "status") {
          const normalizedOptions = options.map((value) => value.toLowerCase());
          if (
            options.length < 2
            || options.length > 12
            || options.some((value) => !value || value.length > 80 || value.includes(","))
            || new Set(normalizedOptions).size !== options.length
          ) {
            throw new Error(`Product blueprint item ${item.id} field ${column.name} needs 2-12 unique, comma-free dropdown options.`);
          }
          const columnIndex = columns.indexOf(column);
          const invalidSample = rows.some((row) => {
            const value = String(row[columnIndex] || "").trim().toLowerCase();
            return value && !normalizedOptions.includes(value);
          });
          if (invalidSample) {
            throw new Error(`Product blueprint item ${item.id} field ${column.name} has sample data outside its declared dropdown options.`);
          }
        }
      }
      const workflowStatus = columns.find((column) => (
        column.type === "status"
        && /(?:^|\s)status$/i.test(String(column.name || "").trim())
      ));
      if (!workflowStatus) {
        throw new Error(`Product blueprint item ${item.id} needs a dedicated Status or workflow-status field for its dashboard metric.`);
      }
    }
    const calculations = Array.isArray(item.calculations) ? item.calculations : [];
    if (blueprint.schema !== "pantheon.product-blueprint.v1" && !Array.isArray(item.calculations)) {
      throw new Error(`Product blueprint item ${item.id} must declare its calculation list, even when it is empty.`);
    }
    const referencedNames = new Map(columns.map((column, index) => [
      fieldReference(column.name),
      { index, name: String(column.name || "").trim() },
    ]));
    if (referencedNames.size !== columns.length) {
      throw new Error(`Product blueprint item ${item.id} has ambiguous field names.`);
    }
    const targets = new Set();
    const calculationDependencies = new Map();
    for (const calculation of calculations) {
      const target = fieldReference(calculation?.target);
      const inputs = Array.isArray(calculation?.inputs)
        ? calculation.inputs.map(fieldReference)
        : [];
      const operation = String(calculation?.operation || "");
      if (
        !target
        || !referencedNames.has(target)
        || targets.has(target)
        || !CALCULATION_OPERATIONS.has(operation)
        || inputs.length < 2
        || inputs.length > 6
        || inputs.some((name) => !referencedNames.has(name) || name === target)
      ) {
        throw new Error(
          `Product blueprint item ${item.id} has an invalid calculated field `
          + `(${calculation?.target || "unnamed"}; ${operation || "no operation"}; `
          + `${inputs.join(", ") || "no inputs"}).`,
        );
      }
      if (["multiply", "subtract", "percent_of"].includes(operation) && inputs.length !== 2) {
        throw new Error(`Product blueprint item ${item.id} uses the wrong number of inputs for ${operation}.`);
      }
      targets.add(target);
      calculationDependencies.set(target, inputs);
    }
    function reaches(start, target, visiting = new Set()) {
      if (start === target) return true;
      if (visiting.has(start)) return false;
      visiting.add(start);
      return (calculationDependencies.get(start) || []).some((dependency) => (
        calculationDependencies.has(dependency) && reaches(dependency, target, visiting)
      ));
    }
    for (const target of calculationDependencies.keys()) {
      if ((calculationDependencies.get(target) || []).some((input) => (
        calculationDependencies.has(input) && reaches(input, target)
      ))) {
        throw new Error(`Product blueprint item ${item.id} contains a circular calculation.`);
      }
    }
  }
  if (validationSample?.exactItemBlueprint) {
    const exact = validationSample.exactItemBlueprint;
    const item = actualItems.find((candidate) => String(candidate.id) === String(exact.id));
    const exactBindings = {
      columns: exact.columns || [],
      sampleRows: exact.sampleRows || [],
      calculations: exact.calculations || [],
    };
    const actualBindings = {
      columns: item?.columns || [],
      sampleRows: item?.sampleRows || [],
      calculations: item?.calculations || [],
    };
    if (!item || JSON.stringify(actualBindings) !== JSON.stringify(exactBindings)) {
      throw new Error("The validation product does not match its exact approved fields, formulas, dropdowns, and sample records.");
    }
  }
  return blueprint;
}

function factoryReadiness(options = {}) {
  const rootDir = path.resolve(options.rootDir || CONFIG.rootDir);
  const renderer = path.join(rootDir, "scripts", "render-digital-product-kit.py");
  if (!fs.existsSync(renderer)) {
    return {
      ready: false,
      python: null,
      renderer,
      reason: "The local digital-product renderer is missing.",
    };
  }
  return {
    ...rendererReadiness({
      rootDir,
      requirementsPath: options.requirementsPath,
      environment: options.environment || process.env,
      spawn: options.spawn,
    }),
    renderer,
  };
}

function assertDigitalProductFactoryReady() {
  const readiness = factoryReadiness();
  if (!readiness.ready) throw new Error(readiness.reason);
  return readiness;
}

function composeStorefrontCover(task, sourceBytes, options = {}) {
  if (!Buffer.isBuffer(sourceBytes) || sourceBytes.length === 0) {
    throw new Error("Pantheon cannot compose a storefront cover without a generated image.");
  }
  const title = String(options.title || task?.payload?.subject || task?.title || "Digital Product").trim();
  const subtitle = String(
    options.subtitle
    || "Editable files and practical workflows for focused everyday work",
  ).trim();
  if (!title) throw new Error("Pantheon cannot compose a storefront cover without a product title.");
  if (!subtitle) throw new Error("Pantheon cannot compose a storefront cover without a customer promise.");
  const readiness = assertDigitalProductFactoryReady();
  const compositor = path.join(CONFIG.rootDir, "scripts", "compose-storefront-cover.py");
  if (!fs.existsSync(compositor)) {
    throw new Error("The local storefront-cover compositor is missing.");
  }
  const sourceHash = crypto.createHash("sha256").update(sourceBytes).digest("hex");
  const renderer = "pantheon-storefront-cover-v3";
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify({ sourceHash, title, subtitle, renderer }))
    .digest("hex");
  const stageRoot = path.join(
    options.artifactRoot || CONFIG.artifactRoot,
    ".staging",
    "storefront-covers",
    safeId(task?.id),
    fingerprint.slice(0, 16),
  );
  fs.mkdirSync(stageRoot, { recursive: true });
  const sourcePath = path.join(stageRoot, "provider-background.png");
  const outputPath = path.join(stageRoot, "storefront-cover.png");
  if (fs.existsSync(sourcePath)) {
    const storedHash = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
    if (storedHash !== sourceHash) throw new Error("The stored storefront background changed unexpectedly.");
  } else {
    fs.writeFileSync(sourcePath, sourceBytes, { flag: "wx" });
  }
  if (!fs.existsSync(outputPath)) {
    const composed = spawnSync(
      readiness.python,
      ["-I", compositor, sourcePath, outputPath, title, subtitle],
      {
        cwd: CONFIG.rootDir,
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      },
    );
    if (composed.error?.code === "ETIMEDOUT") {
      throw new Error("Local storefront-cover composition exceeded its 60-second deadline.");
    }
    if (composed.error) throw composed.error;
    if (composed.status !== 0) {
      throw new Error(`Local storefront-cover composition failed: ${String(composed.stderr || composed.stdout || "unknown error").trim()}`);
    }
  }
  const bytes = fs.readFileSync(outputPath);
  return {
    bytes,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    sourceSha256: sourceHash,
    fingerprint,
    renderer,
    subtitle,
  };
}

function renderDigitalProductKit(task, blueprint, options = {}) {
  const suppliedSpec = task?.payload?.liveSpendRequest?.parameters?.productBuildSpec || {};
  const manifestFilename = safeOutputLeaf(
    suppliedSpec.manifestFilename,
    "manifestFilename",
    ".json",
  );
  const bundleFilename = safeOutputLeaf(
    suppliedSpec.bundleFilename,
    "bundleFilename",
    ".zip",
  );
  const spec = {
    ...suppliedSpec,
    manifestFilename,
    bundleFilename,
  };
  const sourceBlueprintHash = sha256Bytes(Buffer.from(JSON.stringify(blueprint)));
  const normalized = normalizeProductBlueprintForFactory(blueprint, spec);
  assertBlueprintMatchesSpec(spec, normalized.blueprint);
  const readiness = assertDigitalProductFactoryReady();
  const fingerprint = sha256Bytes(Buffer.from(
    JSON.stringify({ spec, blueprint: normalized.blueprint, normalizations: normalized.normalizations }),
  ));
  const taskStageRoot = path.join(
    options.artifactRoot || CONFIG.artifactRoot,
    ".staging",
    "digital-product-kits",
    safeId(task.id),
  );
  fs.mkdirSync(taskStageRoot, { recursive: true });
  const renderIdentity = `${fingerprint.slice(0, 16)}-${Date.now()}-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const stageRoot = path.join(taskStageRoot, `.${renderIdentity}.tmp`);
  const committedStageRoot = path.join(taskStageRoot, renderIdentity);
  const inputPath = path.join(stageRoot, "factory-input.json");
  const outputRoot = path.join(stageRoot, "rendered");
  fs.mkdirSync(stageRoot);
  try {
    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        schema: "pantheon.digital-product-factory-input.v1",
        fingerprint,
        spec,
        blueprint: normalized.blueprint,
        sourceBlueprint: blueprint,
        sourceBlueprintHash,
        runtimeNormalizations: normalized.normalizations,
      }, null, 2),
      { encoding: "utf8", flag: "wx" },
    );
    const rendered = spawnSync(
      readiness.python,
      ["-I", readiness.renderer, inputPath, outputRoot],
      {
        cwd: CONFIG.rootDir,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    if (rendered.error?.code === "ETIMEDOUT") {
      throw new Error("Local digital-product rendering exceeded its two-minute deadline.");
    }
    if (rendered.error) throw rendered.error;
    if (rendered.status !== 0) {
      throw new Error(`Local digital-product rendering failed: ${String(rendered.stderr || rendered.stdout || "unknown error").trim()}`);
    }
    const manifestPath = containedOutputLeaf(outputRoot, manifestFilename, "manifestFilename");
    const bundlePath = containedOutputLeaf(outputRoot, bundleFilename, "bundleFilename");
    for (const requiredPath of [manifestPath, bundlePath]) {
      if (!fs.existsSync(requiredPath) || !fs.statSync(requiredPath).isFile()) {
        throw new Error(`Local digital-product rendering did not create ${path.basename(requiredPath)}.`);
      }
    }
    const qualityReviewRoot = path.join(outputRoot, "quality-review");
    const qualityReviewPaths = [
      containedOutputLeaf(qualityReviewRoot, "actual-workbook.png", "workbookReviewFilename"),
      containedOutputLeaf(qualityReviewRoot, "actual-setup-guide.png", "guideReviewFilename"),
    ];
    for (const requiredPath of qualityReviewPaths) {
      if (!fs.existsSync(requiredPath) || !fs.statSync(requiredPath).isFile()) {
        throw new Error(`Local digital-product rendering did not create ${path.basename(requiredPath)}.`);
      }
    }
    const qualityInspectionPath = containedOutputLeaf(
      qualityReviewRoot,
      "inspection-metadata.json",
      "inspectionMetadataFilename",
    );
    if (!fs.existsSync(qualityInspectionPath) || !fs.statSync(qualityInspectionPath).isFile()) {
      throw new Error("Local digital-product rendering did not create inspection-metadata.json.");
    }
    const qualityInspection = JSON.parse(fs.readFileSync(qualityInspectionPath, "utf8"));
    const sourceGuidePath = containedOutputLeaf(
      path.join(outputRoot, "customer-files"),
      "00-customer-setup-guide.pdf",
      "setupGuideFilename",
    );
    if (!fs.existsSync(sourceGuidePath) || !fs.statSync(sourceGuidePath).isFile()) {
      throw new Error("Local digital-product rendering did not retain the exact setup-guide PDF.");
    }
    const sourceGuideBytes = fs.readFileSync(sourceGuidePath);
    const guideInspectionBytes = fs.readFileSync(qualityReviewPaths[1]);
    validateGuideInspectionReceipt(
      qualityInspection,
      sourceGuideBytes,
      guideInspectionBytes,
    );
    const qualityReviewImages = qualityReviewPaths.map((filePath, index) => ({
      filename: path.basename(filePath),
      bytes: fs.readFileSync(filePath),
      metadata: {
        source: "local_deterministic_renderer",
        purpose: "quality_review_only",
        evidenceRole: index === 0 ? "workbook_inspection" : "setup_guide_inspection",
        derivedFromActualSavedFile: true,
        fingerprint,
        inspectionCoverage: qualityInspection.images?.[path.basename(filePath)] || null,
      },
    }));
    const files = [manifestPath, bundlePath].map((filePath) => ({
      filename: path.basename(filePath),
      bytes: fs.readFileSync(filePath),
      metadata: {
        source: "local_deterministic_renderer",
        fingerprint,
        sourceBlueprintHash,
        runtimeNormalizations: normalized.normalizations,
      },
    }));
    fs.renameSync(stageRoot, committedStageRoot);
    return {
      fingerprint,
      renderer: "pantheon-local-digital-product-factory-v1",
      constructionMode: spec.validationSample?.exactItemBlueprint
        ? "contract_defined_model_assisted"
        : "model_blueprint_deterministic_render",
      sourceBlueprintHash,
      renderedBlueprintHash: sha256Bytes(Buffer.from(JSON.stringify(normalized.blueprint))),
      runtimeNormalizations: normalized.normalizations,
      qualityReviewImages,
      files,
    };
  } catch (error) {
    if (fs.existsSync(stageRoot)) {
      try {
        removeFreshStage(stageRoot, taskStageRoot);
      } catch (cleanupError) {
        error.cleanupError = cleanupError.message;
      }
    }
    throw error;
  }
}

module.exports = {
  PRODUCT_BLUEPRINT_SCHEMA,
  __validateGuideInspectionReceiptForTests: validateGuideInspectionReceipt,
  assertBlueprintMatchesSpec,
  assertDigitalProductFactoryReady,
  composeStorefrontCover,
  factoryReadiness,
  normalizeProductBlueprintForFactory,
  renderDigitalProductKit,
};
