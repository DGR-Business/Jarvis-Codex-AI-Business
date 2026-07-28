const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const CONFIG = require("../config");

const PRODUCT_BLUEPRINT_SCHEMA = "pantheon.product-blueprint.v3";
const LEGACY_PRODUCT_BLUEPRINT_SCHEMAS = new Set([
  "pantheon.product-blueprint.v1",
  "pantheon.product-blueprint.v2",
]);
const CALCULATION_OPERATIONS = new Set(["multiply", "sum", "subtract", "percent_of"]);
const RENDERED_COLUMN_MAX = 18;
const REQUIRED_PYTHON_MODULES = ["openpyxl", "PIL", "pypdfium2", "reportlab"];

let cachedReadiness = null;

function safeId(value, fallback = "product-kit") {
  return String(value || fallback)
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 80) || fallback;
}

function fieldReference(value) {
  return String(value || "")
    .replace(/%/g, " percent ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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
    normalized.packageTitle = String(validationSample.packageTitle || normalized.packageTitle || "").trim();
    normalized.customerPromise = String(
      validationSample.customerPromise || normalized.customerPromise || "",
    ).trim();
    normalized.setupSteps = mergeRequiredList(
      validationSample.setupSteps,
      normalized.setupSteps,
      6,
    );
    normalized.disclaimers = mergeRequiredList(
      validationSample.disclaimers,
      normalized.disclaimers,
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

function resolvePython() {
  if (process.env.PANTHEON_PYTHON) return process.env.PANTHEON_PYTHON;
  if (process.env.JARVIS_PYTHON) return process.env.JARVIS_PYTHON;
  const candidates = [];
  const dependencyRoot = path.resolve(path.dirname(process.execPath), "..", "..");
  candidates.push(path.join(dependencyRoot, "python", "python.exe"));
  for (const home of [process.env.USERPROFILE, process.env.HOME].filter(Boolean)) {
    candidates.push(path.join(home, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe"));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return process.platform === "win32" ? "python" : "python3";
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
  if (cachedReadiness && options.refresh !== true) return cachedReadiness;
  const python = resolvePython();
  const renderer = path.join(CONFIG.rootDir, "scripts", "render-digital-product-kit.py");
  if (!fs.existsSync(renderer)) {
    cachedReadiness = { ready: false, python, renderer, reason: "The local digital-product renderer is missing." };
    return cachedReadiness;
  }
  const probe = spawnSync(
    python,
    ["-c", `import ${REQUIRED_PYTHON_MODULES.join(", ")}`],
    { cwd: CONFIG.rootDir, encoding: "utf8", timeout: 20_000 },
  );
  if (probe.error?.code === "ETIMEDOUT") {
    cachedReadiness = {
      ready: false,
      python,
      renderer,
      reason: "The local file-factory dependency check exceeded its 20-second deadline.",
    };
    return cachedReadiness;
  }
  cachedReadiness = probe.status === 0
    ? { ready: true, python, renderer, reason: null }
    : {
      ready: false,
      python,
      renderer,
      reason: `The local file factory is unavailable: ${String(probe.stderr || probe.stdout || "Python dependency check failed.").trim()}`,
    };
  return cachedReadiness;
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
      [compositor, sourcePath, outputPath, title, subtitle],
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
  const spec = task?.payload?.liveSpendRequest?.parameters?.productBuildSpec || {};
  const sourceBlueprintHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(blueprint))
    .digest("hex");
  const normalized = normalizeProductBlueprintForFactory(blueprint, spec);
  assertBlueprintMatchesSpec(spec, normalized.blueprint);
  const readiness = assertDigitalProductFactoryReady();
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify({ spec, blueprint: normalized.blueprint, normalizations: normalized.normalizations }))
    .digest("hex");
  const stageRoot = path.join(
    options.artifactRoot || CONFIG.artifactRoot,
    ".staging",
    "digital-product-kits",
    safeId(task.id),
    fingerprint.slice(0, 16),
  );
  const inputPath = path.join(stageRoot, "factory-input.json");
  const outputRoot = path.join(stageRoot, "rendered");
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      schema: "pantheon.digital-product-factory-input.v1",
      fingerprint,
      spec,
      blueprint: normalized.blueprint,
      sourceBlueprintHash,
      runtimeNormalizations: normalized.normalizations,
    }, null, 2),
    "utf8",
  );
  const rendered = spawnSync(
    readiness.python,
    [readiness.renderer, inputPath, outputRoot],
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
  const manifestPath = path.join(outputRoot, spec.manifestFilename);
  const bundlePath = path.join(outputRoot, spec.bundleFilename);
  for (const requiredPath of [manifestPath, bundlePath]) {
    if (!fs.existsSync(requiredPath) || !fs.statSync(requiredPath).isFile()) {
      throw new Error(`Local digital-product rendering did not create ${path.basename(requiredPath)}.`);
    }
  }
  const qualityReviewRoot = path.join(outputRoot, "quality-review");
  const qualityReviewPaths = [
    path.join(qualityReviewRoot, "actual-workbook.png"),
    path.join(qualityReviewRoot, "actual-setup-guide.png"),
  ];
  for (const requiredPath of qualityReviewPaths) {
    if (!fs.existsSync(requiredPath) || !fs.statSync(requiredPath).isFile()) {
      throw new Error(`Local digital-product rendering did not create ${path.basename(requiredPath)}.`);
    }
  }
  return {
    fingerprint,
    renderer: "pantheon-local-digital-product-factory-v1",
    constructionMode: spec.validationSample?.exactItemBlueprint
      ? "contract_defined_model_assisted"
      : "model_blueprint_deterministic_render",
    sourceBlueprintHash,
    renderedBlueprintHash: crypto
      .createHash("sha256")
      .update(JSON.stringify(normalized.blueprint))
      .digest("hex"),
    runtimeNormalizations: normalized.normalizations,
    qualityReviewImages: qualityReviewPaths.map((filePath) => ({
      filename: path.basename(filePath),
      bytes: fs.readFileSync(filePath),
      metadata: {
        source: "local_deterministic_renderer",
        purpose: "quality_review_only",
        derivedFromActualSavedFile: true,
        fingerprint,
      },
    })),
    files: [manifestPath, bundlePath].map((filePath) => ({
      filename: path.basename(filePath),
      bytes: fs.readFileSync(filePath),
      metadata: {
        source: "local_deterministic_renderer",
        fingerprint,
        sourceBlueprintHash,
        runtimeNormalizations: normalized.normalizations,
      },
    })),
  };
}

module.exports = {
  PRODUCT_BLUEPRINT_SCHEMA,
  assertBlueprintMatchesSpec,
  assertDigitalProductFactoryReady,
  composeStorefrontCover,
  factoryReadiness,
  normalizeProductBlueprintForFactory,
  renderDigitalProductKit,
};
