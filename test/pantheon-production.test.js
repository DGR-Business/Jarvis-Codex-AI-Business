const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const AdmZip = require("adm-zip");

const CONFIG = require("../src/config");
const {
  all,
  fromJson,
  get,
  now,
  openDatabase,
  run,
  seedDatabase,
  toJson,
} = require("../src/db");
const { decideApproval } = require("../src/runtime/approvals");
const {
  __setAgentRuntimeSdkRunnerForTests,
  __setDigitalProductFactoryForTests,
  refreshLocalStorefrontCover,
} = require("../src/runtime/agent-runtime");
const {
  buildWorkerModelPacket,
  productBuilderFileOutputJsonSchema,
} = require("../src/runtime/agent-model-contracts");
const { findAgentDefinition, getAgentHandoff } = require("../src/runtime/ai-team");
const { getCockpitState, getDecisionsState } = require("../src/runtime/cockpit-state");
const { runOnce } = require("../src/runtime/orchestrator");
const {
  applyPantheonHandoffDecision,
  getProductionState,
  prepareCatalogueBuild,
  prepareVerifiedLaunchContextRepair,
  publicationPlanPriceText,
  publicationPriceChannelHypothesis,
  publicationPresentationText,
  publicationScorecard,
  projectCompletedProductionTask,
  recoverQualityReviewAfterEvidenceRepair,
  recoverQualityReviewAfterLocalRendererRepair,
} = require("../src/runtime/pantheon-production");
const { recoverRetainedProductBuilderResult } = require("../src/runtime/pantheon-recovery");
const { runPantheonSupervisorCycle } = require("../src/runtime/pantheon-supervisor");
const { claimNextTask } = require("../src/runtime/task-claims");
const {
  assertBlueprintMatchesSpec,
  composeStorefrontCover,
  normalizeProductBlueprintForFactory,
  renderDigitalProductKit,
} = require("../src/runtime/digital-product-file-factory");
const {
  digitalProductKitCompatibilityIssues,
  offerClaimAlignmentIssues,
  productBlueprintClaimAlignmentIssues,
} = require("../src/runtime/product-claim-alignment");

test("publication briefs use the current venture's buyer and differentiation", () => {
  const plan = {
    price_floor_cents: 799,
    metadata: {
      productManifest: {
        packageTitle: "Job Search Evidence Tracker and Interview Learning System",
        customerPromise: "Organize job-search evidence and choose the next useful action.",
      },
    },
  };
  const opportunity = {
    buyer: "Active job seekers applying across multiple companies.",
    overall_score: 73,
    demand_score: 80,
    supply_gap_score: 65,
    economics_score: 70,
    channel_fit_score: 75,
    execution_fit_score: 90,
    risk_score: 65,
    confidence: "medium",
    metadata: {},
  };

  const hypothesis = publicationPriceChannelHypothesis(plan, opportunity);
  assert.match(hypothesis, /companies see the verified package/);
  assert.doesNotMatch(hypothesis, /companies\. see/);

  const scorecard = publicationScorecard(plan, opportunity);
  assert.match(scorecard.dimensions.supply_gap.note, /verified customer workflow/);
  assert.doesNotMatch(scorecard.dimensions.supply_gap.note, /freelancer/i);

  assert.equal(
    publicationPlanPriceText("The accepted listing price is AUD 7.99.", plan),
    "The accepted listing price is A$7.99.",
  );
  assert.match(
    publicationPresentationText(
      "The right decision is to prepare a measured paid test rather than publish or claim validated sales.",
      plan,
    ),
    /accepted measured organic test after separate publication approval/,
  );
});

function makeRuntime(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-production-${name}-`));
  const previousArtifactRoot = CONFIG.artifactRoot;
  CONFIG.artifactRoot = path.join(root, "artifacts");
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  seedCatalogue(db);
  return { root, db, previousArtifactRoot };
}

function closeRuntime(runtime) {
  runtime.db.close();
  CONFIG.artifactRoot = runtime.previousArtifactRoot;
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function seedCatalogue(db) {
  const ts = now();
  run(
    db,
    `INSERT INTO workflows
     (id, venture_id, type, title, status, current_step, priority, metadata, created_at, updated_at)
     VALUES ('wf-pantheon-production', 'venture-digital-products', 'pantheon_commercial_discovery',
       'Cash control template catalogue', 'agent_running', 'Catalogue plan ready', 1, '{}', ?, ?)`,
    [ts, ts],
  );
  run(
    db,
    `INSERT INTO commands
     (id, venture_id, source, raw_text, intent, status, workflow_id, summary, metadata, created_at, updated_at)
     VALUES ('cmd-pantheon-production', 'venture-digital-products', 'test',
       'Build a useful cash-control template catalogue.', 'commercial_discovery', 'running',
       'wf-pantheon-production', 'Build the approved catalogue.', '{}', ?, ?)`,
    [ts, ts],
  );
  run(
    db,
    `INSERT INTO opportunity_rounds
     (id, venture_id, status, mode, prompt, geography, language, max_candidates,
      started_at, created_by, metadata, created_at, updated_at)
     VALUES ('round-pantheon-production', 'venture-digital-products', 'ready_to_build',
       'operator_idea', 'Cash control tools', 'Australia', 'English', 3, ?,
       'test', ?, ?, ?)`,
    [
      ts,
      toJson({ workflowId: "wf-pantheon-production", commandId: "cmd-pantheon-production" }),
      ts,
      ts,
    ],
  );
  run(
    db,
    `INSERT INTO opportunities
     (id, round_id, venture_id, source_type, status, title, business_model, buyer, problem,
      offer_direction, geography, language, channel, overall_score, confidence,
      recommendation, smallest_validation, evidence_ids, metadata, created_at, updated_at)
     VALUES ('opp-pantheon-production', 'round-pantheon-production', 'venture-digital-products',
       'reviewed_fixture', 'ready_to_build', 'Freelancer Cash Control Toolkit',
       'Digital spreadsheet template', 'Australian freelancers',
       'Irregular income makes weekly cash decisions difficult.',
       'A practical spreadsheet and guide bundle', 'Australia', 'English', 'Gumroad',
       84, 'medium', 'Build the minimum credible catalogue.',
       'Measure qualified views, paid buyers and net contribution.', '[]', '{}', ?, ?)`,
    [ts, ts],
  );
  run(
    db,
    `INSERT INTO catalogue_plans
     (id, venture_id, opportunity_id, status, title, rationale, target_item_count,
      target_variant_count, audience_segments, channels, geographies, languages,
      price_floor_cents, price_ceiling_cents, metadata, created_at, updated_at)
     VALUES ('plan-pantheon-production', 'venture-digital-products', 'opp-pantheon-production',
       'planned', 'Freelancer cash-control catalogue', 'Three distinct products for the proof.',
       3, 0, '["Australian freelancers"]', '["Gumroad"]', '["Australia"]', '["English"]',
       2900, 3900, ?, ?, ?)`,
    [toJson({ buildStatus: "not_started", noSellableFilesClaimed: true }), ts, ts],
  );
  for (const [index, title] of ["Weekly Cash Planner", "Quarterly Tax Reserve Planner", "Invoice Follow-up Tracker"].entries()) {
    run(
      db,
      `INSERT INTO catalogue_items
       (id, plan_id, venture_id, status, quality_status, title, product_type, audience,
        geography, language, offer, price_cents, metadata, created_at, updated_at)
       VALUES (?, 'plan-pantheon-production', 'venture-digital-products', 'planned',
        'not_reviewed', ?, 'Digital spreadsheet template', 'Australian freelancers',
        'Australia', 'English', ?, 2900, ?, ?, ?)`,
      [
        `catalogue-item-${index + 1}`,
        title,
        `${title} with setup instructions and realistic sample data.`,
        toJson({ sequence: index + 1, exactSpecificationRequired: true }),
        ts,
        ts,
      ],
    );
  }
}

function prepareBuild(db) {
  return prepareCatalogueBuild(db, {
    roundId: "round-pantheon-production",
    opportunityId: "opp-pantheon-production",
    planId: "plan-pantheon-production",
    operatorChoiceRequired: true,
  });
}

function approve(db, approval) {
  return decideApproval(db, approval.id, "approved", "Approve this exact local catalogue build.", {
    expectedScopeHash: approval.scope_hash,
  });
}

function workerOutput(worker, work = {}) {
  return {
    summary: `${worker} completed the exact internal assignment.`,
    recommendation: "Continue only inside the protected Pantheon workflow.",
    evidence: ["The exact approved records and locally retained output were used."],
    risks: ["Real buyer demand remains unproven until a measured market test."],
    nextAction: "Continue to the next protected review step.",
    operatorDecision: "approve",
    confidence: "medium",
    work,
    roleOutput: work,
  };
}

function productBlueprint(spec) {
  return {
    schema: "pantheon.product-blueprint.v3",
    packageTitle: "Freelancer Cash Control Toolkit",
    customerPromise: "A practical set of weekly cash, reserve, and invoice workflow templates.",
    setupSteps: ["Open the bundle.", "Review each sample row.", "Replace the samples with your own records."],
    disclaimers: ["This organisational toolkit is not financial or tax advice."],
    catalogueItems: spec.catalogueItems.map((item, index) => ({
      id: item.id,
      title: item.title,
      purpose: item.offer,
      instructions: ["Review the field guide.", "Replace the sample row.", "Update the tracker during your weekly review."],
      columns: [
        { name: "Record", type: "text", guidance: "A clear name for this record.", options: [] },
        { name: "Client", type: "text", guidance: "The related client or account.", options: [] },
        { name: "Due Date", type: "date", guidance: "The next relevant date.", options: [] },
        { name: "Amount", type: "currency", guidance: "The recorded amount in AUD.", options: [] },
        { name: "Status", type: "status", guidance: "The current workflow status.", options: ["Not started", "In progress", "Complete"] },
      ],
      sampleRows: [[`Example ${index + 1}`, "Sample Client", "31 Jul 2026", "1200", "In progress"]],
      calculations: [],
    })),
  };
}

test("Product Builder output is bound to the exact approved catalogue", () => {
  const approvedIds = [
    "catalogue_item_1",
    "catalogue_item_2",
    "catalogue_item_3",
    "catalogue_item_4",
  ];
  const schema = productBuilderFileOutputJsonSchema({
    catalogueItems: approvedIds.map((id) => ({ id })),
  });
  const itemList = schema.properties.work.properties.productBlueprint.properties.catalogueItems;

  assert.equal(itemList.minItems, approvedIds.length);
  assert.equal(itemList.maxItems, approvedIds.length);
  assert.deepEqual(itemList.items.properties.id.enum, approvedIds);
  assert.deepEqual(
    itemList.items.properties.columns.items.required,
    ["name", "type", "guidance", "options"],
  );
  assert.equal(itemList.items.properties.sampleRows.maxItems, 3);
});

test("product blueprint accepts a clearly named communication status field", () => {
  const spec = {
    schema: "pantheon.product-build-spec.v1",
    catalogueItems: Array.from({ length: 3 }, (_, index) => ({
      id: `item-${index + 1}`,
    })),
  };
  const blueprint = {
    schema: "pantheon.product-blueprint.v3",
    packageTitle: "Customer Communication Kit",
    customerPromise: "Editable communication records and status tracking.",
    setupSteps: ["Open the workbook.", "Replace the sample records."],
    disclaimers: [],
    catalogueItems: spec.catalogueItems.map((item, index) => ({
      id: item.id,
      title: `Communication Workbook ${index + 1}`,
      purpose: "Record one customer communication workflow.",
      instructions: ["Replace the sample record.", "Update the status after each action."],
      columns: [
        { name: "Record ID", type: "text", guidance: "Use an internal reference.", options: [] },
        { name: "Contact Date", type: "date", guidance: "Record the contact date.", options: [] },
        { name: "Message Copy", type: "text", guidance: "Store the approved wording.", options: [] },
        {
          name: "Communication Status",
          type: "status",
          guidance: "Record the workflow state.",
          options: ["Draft", "Sent", "Closed"],
        },
      ],
      sampleRows: [[`CASE-${index + 1}`, "2026-07-21", "Example wording", "Sent"]],
      calculations: [],
    })),
  };

  assert.equal(assertBlueprintMatchesSpec(spec, blueprint), blueprint);
});

test("local product factory adds one recorded workflow status without changing the provider blueprint", () => {
  const spec = {
    schema: "pantheon.product-build-spec.v1",
    catalogueItems: Array.from({ length: 3 }, (_, index) => ({ id: `item-${index + 1}` })),
  };
  const source = {
    schema: "pantheon.product-blueprint.v3",
    packageTitle: "Client Operations Kit",
    customerPromise: "Organize recurring client work.",
    setupSteps: ["Open the workbook.", "Review the example.", "Replace it with your records."],
    disclaimers: [],
    catalogueItems: spec.catalogueItems.map((item, index) => ({
      id: item.id,
      title: `Tracker ${index + 1}`,
      purpose: "Record and review client work.",
      instructions: ["Replace the sample.", "Review the dashboard."],
      columns: [
        { name: "Record", type: "text", guidance: "Name the record.", options: [] },
        { name: "Client", type: "text", guidance: "Name the client.", options: [] },
        { name: "Due Date", type: "date", guidance: "Record the due date.", options: [] },
        { name: "Notes", type: "text", guidance: "Add a concise note.", options: [] },
      ],
      sampleRows: [[`Example ${index + 1}`, "Sample Client", "2026-07-31", "Example note"]],
      calculations: [],
    })),
  };
  const sourceSnapshot = JSON.parse(JSON.stringify(source));
  const normalized = normalizeProductBlueprintForFactory(source);

  assert.deepEqual(source, sourceSnapshot, "The exact provider output must remain immutable.");
  assert.equal(normalized.normalizations.length, 3);
  assert.ok(normalized.blueprint.catalogueItems.every((item) => (
    item.columns.at(-1).name === "Workflow Status"
    && item.sampleRows.every((row) => row.length === item.columns.length)
    && item.sampleRows.every((row) => row.at(-1) === "In Progress")
  )));
  assert.equal(assertBlueprintMatchesSpec(spec, normalized.blueprint), normalized.blueprint);
  const repeated = normalizeProductBlueprintForFactory(normalized.blueprint);
  assert.equal(repeated.normalizations.length, 0);
  assert.ok(repeated.blueprint.catalogueItems.every((item) => (
    item.columns.filter((column) => column.name === "Workflow Status").length === 1
  )));

  const crowded = JSON.parse(JSON.stringify(source));
  crowded.catalogueItems[0].columns = [
    { name: "Client", type: "text", guidance: "Name the client.", options: [] },
    { name: "Discovery Inputs", type: "text", guidance: "Record discovery inputs.", options: [] },
    { name: "Agreed Scope", type: "text", guidance: "Record the scope.", options: [] },
    { name: "Deliverables", type: "text", guidance: "Record deliverables.", options: [] },
    { name: "Decision Point", type: "text", guidance: "Record the decision.", options: [] },
    { name: "Meeting Action", type: "text", guidance: "Record the action.", options: [] },
    { name: "Action Owner", type: "text", guidance: "Name the owner.", options: [] },
    { name: "Due Date", type: "date", guidance: "Record the due date.", options: [] },
    { name: "Follow-Up Date", type: "date", guidance: "Record the follow-up date.", options: [] },
    { name: "Follow-Up Message", type: "text", guidance: "Draft the follow-up.", options: [] },
    { name: "Agreed Fee", type: "currency", guidance: "Record the agreed fee.", options: [] },
    { name: "Amount Paid", type: "currency", guidance: "Record the amount paid.", options: [] },
  ];
  crowded.catalogueItems[0].sampleRows = [[
    "Sample Client",
    "Discovery notes",
    "Agreed scope",
    "Deliverable list",
    "Approve next step",
    "Send source file",
    "Sample Owner",
    "2026-08-01",
    "2026-08-03",
    "Example follow-up",
    "2000",
    "500",
  ]];
  crowded.catalogueItems[0].calculations = [{
    target: "Balance Due",
    operation: "subtract",
    inputs: ["Agreed Fee", "Amount Paid"],
  }];
  const crowdedNormalized = normalizeProductBlueprintForFactory(crowded);
  assert.equal(crowdedNormalized.blueprint.catalogueItems[0].columns.length, 14);
  assert.deepEqual(
    crowdedNormalized.normalizations
      .filter((item) => item.itemId === crowded.catalogueItems[0].id)
      .map((item) => item.code),
    ["calculated_target_added_by_runtime", "workflow_status_added_by_runtime"],
  );
  assert.equal(
    crowdedNormalized.blueprint.catalogueItems[0].columns.find((column) => column.name === "Balance Due").type,
    "currency",
  );
  assert.equal(
    crowdedNormalized.blueprint.catalogueItems[0].sampleRows[0].length,
    crowdedNormalized.blueprint.catalogueItems[0].columns.length,
  );
  assert.equal(assertBlueprintMatchesSpec(spec, crowdedNormalized.blueprint), crowdedNormalized.blueprint);
});

test("claim alignment rejects unsupported outcomes and accepts explicit product mechanisms", () => {
  const offerIssues = offerClaimAlignmentIssues({
    promise: "Collect better inputs and finish projects faster.",
    catalogueItems: [{
      title: "Client Intake",
      outcome: "Confirm scope and complete project information.",
      includedTools: ["Client details form"],
      differentiation: "A short editable workbook.",
    }],
  });
  assert.ok(offerIssues.some((issue) => /unmeasured comparative outcome/i.test(issue)));
  assert.ok(offerIssues.some((issue) => /confirm scope/i.test(issue)));
  assert.ok(offerIssues.some((issue) => /complete project information/i.test(issue)));

  assert.deepEqual(offerClaimAlignmentIssues({
    promise: "The files organize follow-up timing. They do not promise increased bookings, retention, or revenue.",
    catalogueItems: [{
      title: "Follow-Up Log",
      outcome: "Record the next contact date and message status.",
      includedTools: ["Next Contact Date field", "Message Status field"],
      differentiation: "Named fields and a short setup checklist.",
    }],
  }), []);

  assert.ok(digitalProductKitCompatibilityIssues({
    catalogueItems: [{
      title: "Agency Delivery Bundle",
      format: "Editable workspace",
      outcome: "Coordinate multiple projects using reusable databases and a project index.",
      differentiation: "A compact operating system.",
    }],
  }).some((issue) => /multiple data structures/i.test(issue)));
  assert.deepEqual(digitalProductKitCompatibilityIssues({
    catalogueItems: [{
      title: "Agency Delivery Tracker",
      format: "Excel workbook and sample CSV",
      outcome: "Record project owners, active milestones, approval decisions, and next actions in one tracker.",
      differentiation: "Literal fields and controlled statuses.",
    }],
  }), []);
  assert.deepEqual(digitalProductKitCompatibilityIssues({
    catalogueItems: [{
      title: "Complete Job Search Command Centre Bundle",
      format: "Linked Excel workbook package with a setup guide.",
      outcome: "Maintain linked records across the supplied Excel workbooks.",
      differentiation: "A coordinated Excel package instead of requiring a complex Notion workspace.",
    }],
  }), []);

  assert.deepEqual(offerClaimAlignmentIssues({
    promise: "Record intake and handover details in named fields rather than a guaranteed business result.",
    catalogueItems: [{
      title: "Client Delivery Kit",
      outcome: "Record client intake and handover details.",
      includedTools: ["Client Intake fields", "Handover Details fields"],
      differentiation: "A literal record-keeping workflow.",
    }],
  }), []);

  const spec = {
    catalogueItems: [{
      id: "item-1",
      title: "Client Intake",
      offer: "Confirm scope and complete project information.",
    }],
  };
  const unsupported = {
    schema: "pantheon.product-blueprint.v3",
    packageTitle: "Client Operations Toolkit",
    customerPromise: "A practical set of client workflow files.",
    setupSteps: ["Open the file.", "Review the example.", "Replace the sample."],
    disclaimers: [],
    catalogueItems: [{
      id: "item-1",
      title: "Client Intake",
      purpose: "Confirm scope and complete project information.",
      instructions: ["Replace the sample row."],
      columns: [
        { name: "Client", type: "text", guidance: "Record the client name.", options: [] },
        { name: "Project", type: "text", guidance: "Record the project name.", options: [] },
        { name: "Owner", type: "text", guidance: "Record the owner.", options: [] },
        { name: "Due date", type: "date", guidance: "Record the due date.", options: [] },
      ],
      sampleRows: [["Example Co", "Website", "Sam", "2026-08-01"]],
      calculations: [],
    }],
  };
  assert.ok(productBlueprintClaimAlignmentIssues(unsupported, spec).length >= 2);

  const supported = structuredClone(unsupported);
  supported.catalogueItems[0].instructions = [
    "Complete every required project-information field.",
    "Set Scope confirmation to Confirmed only after the buyer approves the recorded scope.",
  ];
  supported.catalogueItems[0].columns = [
    { name: "Project information", type: "text", guidance: "Required project information; use Missing until complete.", options: [] },
    { name: "Scope", type: "text", guidance: "Record the exact agreed scope.", options: [] },
    { name: "Scope confirmation", type: "status", guidance: "Use Draft, Confirmed, or Changes requested after buyer approval.", options: ["Draft", "Confirmed", "Changes requested"] },
    { name: "Owner", type: "text", guidance: "Record the owner.", options: [] },
  ];
  supported.catalogueItems[0].sampleRows = [["Website refresh", "Five pages", "Confirmed", "Sam"]];
  assert.deepEqual(productBlueprintClaimAlignmentIssues(supported, spec), []);
});

function completeTask(db, taskId, output) {
  const ts = now();
  run(
    db,
    `UPDATE tasks
     SET status = 'completed', result = ?, outcome_status = 'known',
         completed_at = ?, updated_at = ?
     WHERE id = ?`,
    [toJson({ output }), ts, ts, taskId],
  );
  return get(db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
}

function insertGeneratedDeliverables(runtime, task) {
  const db = runtime.db;
  const root = path.join(runtime.root, "production-test");
  fs.mkdirSync(root, { recursive: true });
  const manifestPath = path.join(root, "pantheon-product-manifest.json");
  const bundlePath = path.join(root, "cash-control-catalogue.zip");
  const manifest = {
    schema: "pantheon.product-manifest.v1",
    version: 1,
    planId: "plan-pantheon-production",
    opportunityId: "opp-pantheon-production",
    catalogueItems: [
      { id: "catalogue-item-1", files: ["weekly-cash-planner.csv"] },
      { id: "catalogue-item-2", files: ["quarterly-tax-reserve.csv"] },
      { id: "catalogue-item-3", files: ["invoice-follow-up.csv"] },
    ].map((item) => ({
      ...item,
      title: item.id,
      purpose: "Provide one complete customer-usable tracker.",
      validation: {
        sheets: ["Dashboard", "Read Me", "Tracker"],
        columns: 0,
        sampleRows: 0,
        formulaCells: 0,
        reopened: true,
        instructions: [
          { cell: "Read Me!C6", text: "Open the Tracker sheet." },
          { cell: "Read Me!C7", text: "Replace the sample values with reviewed records." },
        ],
        fields: [],
        sampleData: { headers: [], rows: [] },
        formulas: [],
        formulaCoverage: [],
        calculatedFields: [],
        dataValidations: [],
        statusFields: [],
        sheetSummary: {
          Dashboard: "Summary",
          Tracker: "Customer records",
          "Read Me": "Instructions",
        },
      },
    })),
    bundle: {
      filename: "cash-control-catalogue.zip",
      canonicalManifestInsideBundle: true,
    },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const zip = new AdmZip();
  zip.addFile("pantheon-product-manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile("weekly-cash-planner.csv", Buffer.from("week,income,expense\n1,1000,400\n"));
  zip.addFile("quarterly-tax-reserve.csv", Buffer.from("quarter,income,tax_reserve\nQ1,12000,3000\n"));
  zip.addFile("invoice-follow-up.csv", Buffer.from("invoice,client,status\nINV-001,Sample Client,In progress\n"));
  zip.writeZip(bundlePath);

  const ts = now();
  const files = [
    {
      id: "deliv-product-manifest",
      humanName: "pantheon-product-manifest.json",
      format: "application/json",
      filePath: path.relative(CONFIG.rootDir, manifestPath).replace(/\\/g, "/"),
      bytes: fs.statSync(manifestPath).size,
      sha256: "manifest-fixture-hash",
      manifest: true,
    },
    {
      id: "deliv-product-bundle",
      humanName: "cash-control-catalogue.zip",
      format: "application/zip",
      filePath: path.relative(CONFIG.rootDir, bundlePath).replace(/\\/g, "/"),
      bytes: fs.statSync(bundlePath).size,
      sha256: "bundle-fixture-hash",
      manifest: false,
    },
  ];
  for (const file of files) {
    run(
      db,
      `INSERT INTO deliverables
       (id, workflow_id, task_id, venture_id, title, human_name, audience, format,
        status, file_path, summary, metadata, content_hash, version, created_at, updated_at)
       VALUES (?, ?, ?, 'venture-digital-products', ?, ?, 'operator', ?,
        'built_pending_quality_review', ?, 'Validated production test file.', '{}', ?, 1, ?, ?)`,
      [
        file.id,
        task.workflow_id,
        task.id,
        file.manifest ? "Product Manifest" : "Generated Product File",
        file.humanName,
        file.format,
        file.filePath,
        file.sha256,
        ts,
        ts,
      ],
    );
  }
  return { files, manifest };
}

test("the local Digital Product Kit renderer creates usable workbooks, guide, previews and bundle", () => {
  const runtime = makeRuntime("local-file-renderer");
  try {
    const build = prepareBuild(runtime.db);
    const blueprint = productBlueprint(build.spec);
    blueprint.customerPromise = "Use these files to collect better inputs and track the work.";
    blueprint.setupSteps = [
      "Open missing-package.xlsx.",
      "Use the Source Register sheet before starting.",
    ];
    blueprint.catalogueItems[0].purpose = "Close projects cleanly with organized files, usage notes, final approvals, and a next-step invitation.";
    blueprint.catalogueItems[0].instructions = [
      "Open 01-short-name.xlsx and import 01-short-name-sample.csv.",
      "Add source items to Source Register, map them in Channel Matrix, update Status Board, and record decisions in Review Records.",
      "Review each record before marking it complete.",
      "Use Requested Assets and Milestones to keep delivery work visible to the project owner and client.",
      "Use Client-Facing Status to display a concise project state without exposing private notes.",
      "Use the project index for one row per active project.",
      "Use the delivery register for current handover work.",
      "Maintain reusable databases for the agency team.",
    ];
    blueprint.catalogueItems[0].columns.splice(
      4,
      0,
      { name: "Client-Facing Status", type: "status", guidance: "Use a concise status suitable for a client-facing view.", options: ["Warm", "Concise", "Gentle"] },
    );
    blueprint.catalogueItems[0].sampleRows[0].splice(4, 0, "Warm");
    blueprint.catalogueItems[0].columns[5].guidance = "Use Draft, Ready, or Archived; review the record locally before use.";
    blueprint.catalogueItems[0].columns[5].options = ["Draft", "Ready", "Archived"];
    blueprint.catalogueItems[0].sampleRows[0][5] = "Ready";
    const ambiguousStatusIndex = blueprint.catalogueItems[1].columns.findIndex((column) => (
      column.type === "status" && /status$/i.test(column.name)
    ));
    assert.notEqual(ambiguousStatusIndex, -1);
    blueprint.catalogueItems[1].columns[ambiguousStatusIndex].guidance = "Use Draft, Ready, or Approved.";
    blueprint.catalogueItems[1].columns[ambiguousStatusIndex].options = ["Draft", "Ready", "Approved"];
    for (const row of blueprint.catalogueItems[1].sampleRows) row[ambiguousStatusIndex] = "Ready";
    blueprint.catalogueItems[1].purpose = "Assign content angles, formats, hooks, CTAs, and status for each campaign.";
    blueprint.catalogueItems[0].columns[0].name = "Requested Assets";
    blueprint.catalogueItems[0].columns[1].name = "Next Milestone";
    blueprint.catalogueItems[0].sampleRows[0][1] = "A deliberately long customer-safe sample label that must remain visible when the workbook opens.";
    blueprint.catalogueItems[0].columns.push(
      { name: "Quantity", type: "number", guidance: "Enter the number of units.", options: [] },
      { name: "Unit Rate", type: "currency", guidance: "Enter the price per unit.", options: [] },
      { name: "Calculated Total", type: "currency", guidance: "Calculated automatically from quantity and unit rate.", options: [] },
      { name: "Completed Tasks", type: "number", guidance: "Enter the completed task count.", options: [] },
      { name: "Total Tasks", type: "number", guidance: "Enter the total task count.", options: [] },
      { name: "Completion Percent", type: "percent", guidance: "Calculated automatically from completed and total tasks.", options: [] },
    );
    blueprint.catalogueItems[0].sampleRows[0].push("2", "150", "300", "3", "4", "75%");
    blueprint.catalogueItems[0].calculations = [
      {
        target: "Calculated Total",
        operation: "multiply",
        inputs: ["Quantity", "Unit Rate"],
      },
      {
        target: "Completion %",
        operation: "percent_of",
        inputs: ["Completed Tasks", "Total Tasks"],
      },
    ];
    const runtimeStatusIndex = blueprint.catalogueItems[2].columns.findIndex((column) => (
      column.type === "status" && /status$/i.test(column.name)
    ));
    blueprint.catalogueItems[2].columns.splice(runtimeStatusIndex, 1);
    for (const row of blueprint.catalogueItems[2].sampleRows) row.splice(runtimeStatusIndex, 1);
    const rendered = renderDigitalProductKit(
      build.task,
      blueprint,
      { artifactRoot: runtime.root },
    );
    assert.equal(rendered.renderer, "pantheon-local-digital-product-factory-v1");
    assert.equal(rendered.files.length, 2);
    const manifestFile = rendered.files.find((file) => file.filename === build.spec.manifestFilename);
    const bundleFile = rendered.files.find((file) => file.filename === build.spec.bundleFilename);
    assert.ok(manifestFile && bundleFile);
    const manifest = JSON.parse(manifestFile.bytes.toString("utf8"));
    assert.equal(manifest.catalogueItems.length, 3);
    assert.equal(manifest.storefrontPreviews.length, 2);
    assert.equal(manifest.customerPromise, "Use these files to collect project inputs in a structured format and track the work.");
    assert.equal(
      manifest.catalogueItems[0].purpose,
      "Track file-index checks, usage notes, final approvals, and next steps in one place.",
    );
    assert.equal(manifest.setupGuide.contentSource, "same_claim_safe_blueprint_used_to_render_pdf");
    assert.equal(manifest.setupGuide.products.length, 3);
    assert.equal(rendered.runtimeNormalizations.length, 1);
    assert.equal(manifest.runtimeNormalizations.length, 1);
    assert.equal(manifest.runtimeNormalizations[0].code, "workflow_status_added_by_runtime");
    assert.ok(
      manifest.catalogueItems[2].factoryAdjustments
        .some((adjustment) => adjustment.code === "workflow_status_added_by_runtime"),
    );
    assert.ok(
      manifest.catalogueItems[2].validation.fields
        .some((field) => field.name === "Workflow Status"),
    );
    assert.equal(manifest.factoryAdjustments[0].code, "package_navigation_generated_from_runtime");
    assert.equal(
      manifest.catalogueItems[1].purpose,
      "Record and review Record, Client, Due Date, Amount, and Status in one editable tracker.",
    );
    assert.ok(
      manifest.catalogueItems[1].factoryAdjustments
        .some((adjustment) => adjustment.code === "purpose_rewritten_from_actual_fields"),
    );
    const exactWorkbookName = path.posix.basename(
      manifest.catalogueItems[0].files.find((filename) => filename.endsWith(".xlsx")),
    );
    assert.ok(
      manifest.catalogueItems[0].validation.instructions
        .some((instruction) => instruction.text.includes(exactWorkbookName)),
    );
    const customerFacingManifest = JSON.stringify({
      setupGuide: manifest.setupGuide,
      catalogueItems: manifest.catalogueItems,
    });
    assert.doesNotMatch(customerFacingManifest, /missing-package\.xlsx|01-short-name|Source Register|Review Records|project index|delivery register|reusable databases/i);
    assert.ok(
      manifest.catalogueItems[0].factoryAdjustments
        .some((adjustment) => adjustment.code === "model_topology_replaced"),
    );
    assert.ok(
      manifest.catalogueItems[0].factoryAdjustments
        .some((adjustment) => adjustment.code === "client_display_claim_narrowed"),
    );
    assert.ok(
      manifest.catalogueItems[0].factoryAdjustments
        .some((adjustment) => adjustment.code === "instruction_field_names_aligned"),
    );
    const statusToShare = manifest.catalogueItems[0].validation.fields.find(
      (field) => field.name === "Status to Share",
    );
    assert.ok(statusToShare);
    assert.equal(
      statusToShare.guidance,
      "Record a concise status that can be copied into a client update.",
    );
    assert.ok(
      manifest.catalogueItems[0].validation.instructions
        .some((instruction) => instruction.text.includes("Requested Assets and Next Milestone")),
    );
    assert.doesNotMatch(customerFacingManifest, /Client-Facing Status|client-facing view|Requested Assets and Milestones/i);
    assert.doesNotMatch(customerFacingManifest, /keep[^.]*visible[^.]*client/i);
    assert.ok(manifest.catalogueItems.every((item) => item.validation.reopened));
    assert.ok(manifest.catalogueItems.every((item) => item.validation.instructions.length >= 2));
    assert.ok(manifest.catalogueItems.every((item) => item.validation.fields.length === item.validation.columns));
    assert.ok(manifest.catalogueItems.every((item) => item.validation.sampleData.rows.length === item.validation.sampleRows));
    assert.deepEqual(
      manifest.catalogueItems[0].validation.statusFields
        .find((field) => field.field === "Status").options,
      ["Draft", "Ready", "Archived"],
    );
    assert.equal(manifest.catalogueItems[0].validation.dashboardMetric.statusField, "Status");
    assert.equal(manifest.catalogueItems[0].validation.dashboardMetric.countedValue, "Ready");
    assert.equal(manifest.catalogueItems[0].validation.dashboardMetric.countedValueInValidation, true);
    assert.match(manifest.catalogueItems[0].validation.dashboardMetric.formula, /"Ready"/);
    const clarifiedStatus = manifest.catalogueItems[1].validation.fields.find(
      (field) => field.name === blueprint.catalogueItems[1].columns[ambiguousStatusIndex].name,
    );
    assert.match(clarifiedStatus.guidance, /Ready means prepared for final review/i);
    assert.match(clarifiedStatus.guidance, /Approved means accepted for use/i);
    assert.equal(manifest.catalogueItems[1].validation.dashboardMetric.countedValue, "Approved");
    assert.ok(manifest.catalogueItems[0].validation.instructions.some((item) => /Tracker sheet to /i.test(item.text)));
    assert.equal(manifest.catalogueItems[0].validation.calculatedFields.length, 2);
    assert.equal(manifest.catalogueItems[0].validation.calculatedFields[0].target, "Calculated Total");
    assert.match(manifest.catalogueItems[0].validation.calculatedFields[0].formula, /G2\*H2/);
    assert.equal(manifest.catalogueItems[0].validation.calculatedFields[1].target, "Completion Percent");
    assert.match(
      manifest.catalogueItems[0].validation.calculatedFields[1].formula,
      /IF\(OR\(J2="",K2="",K2=0\),"",J2\/K2\)/,
    );
    assert.ok(manifest.catalogueItems[0].validation.formulaCells >= 500);
    assert.equal(
      manifest.catalogueItems[0].validation.formulaCoverage
        .reduce((total, coverage) => total + coverage.count, 0),
      manifest.catalogueItems[0].validation.formulaCells,
    );
    assert.ok(manifest.catalogueItems[0].validation.formulas.length <= 50);
    assert.ok(
      manifest.catalogueItems[0].validation.formulaCoverage
        .some((coverage) => /500$/.test(coverage.range)),
    );
    const bundle = new AdmZip(bundleFile.bytes);
    const names = bundle.getEntries().map((entry) => entry.entryName);
    assert.deepEqual(bundle.readFile(build.spec.manifestFilename), manifestFile.bytes);
    assert.equal(names.filter((name) => name.endsWith(".xlsx")).length, 3);
    assert.equal(names.filter((name) => name.endsWith("-sample.csv")).length, 3);
    assert.equal(names.filter((name) => name.startsWith("storefront-previews/") && name.endsWith(".png")).length, 2);
    const workbookBytes = bundle.readFile(names.find((name) => name.endsWith(".xlsx")));
    const workbookArchive = new AdmZip(workbookBytes);
    assert.ok(workbookArchive.getEntry("[Content_Types].xml"));
    assert.ok(workbookArchive.getEntry("xl/workbook.xml"));
    const sampleRowHeights = workbookArchive.getEntries()
      .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.entryName))
      .map((entry) => entry.getData().toString("utf8")
        .match(/<row[^>]*r="2"[^>]*\sht="([^"]+)"/))
      .filter(Boolean)
      .map((match) => Number(match[1]));
    assert.ok(
      sampleRowHeights.some((height) => height > 34),
      `Expected an expanded visible sample row, received ${JSON.stringify(sampleRowHeights)}`,
    );
    const guide = bundle.readFile("customer-files/00-customer-setup-guide.pdf");
    assert.equal(guide.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.ok(guide.length > 2000);
    const preview = bundle.readFile("storefront-previews/catalogue-overview.png");
    assert.equal(preview.subarray(1, 4).toString("ascii"), "PNG");
    assert.ok(preview.length > 2000);
    const repeated = renderDigitalProductKit(
      build.task,
      blueprint,
      { artifactRoot: runtime.root },
    );
    assert.deepEqual(
      repeated.files.map((file) => ({
        filename: file.filename,
        sha256: crypto.createHash("sha256").update(file.bytes).digest("hex"),
      })),
      rendered.files.map((file) => ({
        filename: file.filename,
        sha256: crypto.createHash("sha256").update(file.bytes).digest("hex"),
      })),
      "The same frozen blueprint must render byte-identical files.",
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("an approved AI background becomes a deterministic titled storefront cover", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-storefront-cover-"));
  try {
    const source = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGP88PUXAymAiSTVDKMaiANMRKqDg1ENxACSQwkA+bAC/1GEth0AAAAASUVORK5CYII=",
      "base64",
    );
    const task = {
      id: "task-storefront-cover-test",
      title: "Create a cover",
      payload: { subject: "Beauty Business Review and Rebooking Kit" },
    };
    const subtitle = "Keep client work organized from first brief to final handoff.";
    const first = composeStorefrontCover(task, source, { artifactRoot: root, subtitle });
    const repeated = composeStorefrontCover(task, source, { artifactRoot: root, subtitle });
    const differentPromise = composeStorefrontCover(task, source, {
      artifactRoot: root,
      subtitle: "A different truthful customer promise.",
    });
    assert.equal(first.bytes.subarray(1, 4).toString("ascii"), "PNG");
    assert.ok(first.bytes.length > source.length);
    assert.notEqual(first.sha256, crypto.createHash("sha256").update(source).digest("hex"));
    assert.equal(first.sourceSha256, crypto.createHash("sha256").update(source).digest("hex"));
    assert.equal(first.renderer, "pantheon-storefront-cover-v3");
    assert.equal(first.subtitle, subtitle);
    assert.equal(first.sha256, repeated.sha256);
    assert.deepEqual(first.bytes, repeated.bytes);
    assert.notEqual(first.sha256, differentPromise.sha256);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Jarvis can recompose a retained storefront background without another provider call", () => {
  const runtime = makeRuntime("local-cover-refresh");
  try {
    const taskId = "task-local-cover-refresh";
    const deliverableId = "deliv-local-cover-refresh";
    const ts = now();
    const source = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGP88PUXAymAiSTVDKMaiANMRKqDg1ENxACSQwkA+bAC/1GEth0AAAAASUVORK5CYII=",
      "base64",
    );
    const sourceHash = crypto.createHash("sha256").update(source).digest("hex");
    const sourceDir = path.join(CONFIG.artifactRoot, ".staging", "storefront-covers", taskId, "legacy-cover");
    const oldCoverPath = path.join(CONFIG.artifactRoot, "old-cover.png");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "provider-background.png"), source);
    fs.writeFileSync(oldCoverPath, source);
    run(
      runtime.db,
      `INSERT INTO tasks
       (id, workflow_id, title, kind, agent, status, payload, result,
        completed_at, created_at, updated_at, venture_id, outcome_status)
       VALUES (?, 'wf-pantheon-production', 'Create storefront cover',
        'live_ai_worker_execution', 'product_builder', 'completed', ?, ?, ?, ?, ?,
        'venture-digital-products', 'known')`,
      [
        taskId,
        toJson({
          subject: "Freelancer Client Delivery and Onboarding OS",
          liveSpendRequest: {
            parameters: {
              pantheonProduction: {
                stage: "storefront_visuals",
                planId: "plan-pantheon-production",
                customerPromise: "Keep client work organized from first brief to final handoff.",
              },
            },
          },
        }),
        toJson({
          output: {
            generatedAssets: [{
              id: deliverableId,
              filePath: path.relative(CONFIG.rootDir, oldCoverPath).replace(/\\/g, "/"),
              bytes: source.length,
              sha256: sourceHash,
            }],
          },
        }),
        ts,
        ts,
        ts,
      ],
    );
    run(
      runtime.db,
      `INSERT INTO deliverables
       (id, workflow_id, task_id, venture_id, title, human_name, audience, format,
        status, file_path, summary, metadata, content_hash, version, created_at, updated_at)
       VALUES (?, 'wf-pantheon-production', ?, 'venture-digital-products',
        'Generated Product Asset', 'Storefront cover', 'operator', 'image/png',
        'built_pending_quality_review', ?, 'Retained cover.', ?, ?, 1, ?, ?)`,
      [
        deliverableId,
        taskId,
        path.relative(CONFIG.rootDir, oldCoverPath).replace(/\\/g, "/"),
        toJson({
          providerBackgroundSha256: sourceHash,
          compositionRenderer: "pantheon-storefront-cover-v1",
          sha256: sourceHash,
          bytes: source.length,
        }),
        sourceHash,
        ts,
        ts,
      ],
    );

    const refreshed = refreshLocalStorefrontCover(runtime.db, taskId, {
      artifactRoot: CONFIG.artifactRoot,
    });
    assert.equal(refreshed.localCoverRefresh.noProviderCall, true);
    assert.equal(refreshed.localCoverRefresh.externalAction, false);
    assert.equal(refreshed.localCoverRefresh.sourceSha256, sourceHash);
    assert.notEqual(refreshed.asset.sha256, sourceHash);
    const stored = get(runtime.db, "SELECT * FROM deliverables WHERE id = ?", [deliverableId]);
    assert.equal(stored.content_hash, refreshed.asset.sha256);
    assert.equal(stored.version, 2);
    assert.equal(fromJson(stored.metadata, {}).compositionRenderer, "pantheon-storefront-cover-v3");
    assert.equal(
      fromJson(stored.metadata, {}).compositionSubtitle,
      "Keep client work organized from first brief to final handoff.",
    );
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls").count, 0);
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM events WHERE type = 'catalogue.local_cover_refreshed'").count,
      1,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("the operator build choice stays protected and the supervisor cannot silently approve it", async () => {
  const runtime = makeRuntime("operator-boundary");
  try {
    const build = prepareBuild(runtime.db);
    assert.equal(build.task.status, "blocked");
    assert.equal(build.approval.status, "pending");
    assert.equal(build.spec.catalogueItems.length, 3);
    assert.equal(build.spec.supportedByCurrentFactory, true);

    const cycle = await runPantheonSupervisorCycle(runtime.db, {
      triggerType: "test",
      startedBy: "pantheon-production-test",
      maxSteps: 2,
    });
    assert.equal(cycle.status, "waiting_for_operator");
    assert.equal(cycle.cycle.next_action_type, "review_internal_work");
    assert.equal(get(runtime.db, "SELECT status FROM approvals WHERE id = ?", [build.approval.id]).status, "pending");
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls").count, 0);
    const cockpit = getCockpitState(runtime.db);
    assert.equal(cockpit.importantWork[0].title, "Build the 3-product catalogue?");
    assert.equal(cockpit.importantWork[0].approveLabel, "Build this catalogue");
    assert.deepEqual(
      cockpit.importantWork[0].productBuild.items.map((item) => item.title),
      ["Weekly Cash Planner", "Quarterly Tax Reserve Planner", "Invoice Follow-up Tracker"],
    );
    assert.equal(cockpit.commercialDiscovery.production.plans[0].status, "waiting_for_build_decision");
  } finally {
    closeRuntime(runtime);
  }
});

test("Product Builder renders and validates a real manifest and bundle before completion", async () => {
  const previous = {
    key: process.env.OPENAI_API_KEY,
    liveModels: process.env.PANTHEON_ENABLE_LIVE_MODELS,
    disabledAdapter: process.env.PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER,
    disabledSdk: process.env.PANTHEON_DISABLE_OPENAI_AGENTS_SDK,
    rate: process.env.PANTHEON_API_CREDIT_AUD_PER_USD,
  };
  process.env.OPENAI_API_KEY = "test-pantheon-product-key";
  process.env.PANTHEON_ENABLE_LIVE_MODELS = "1";
  process.env.PANTHEON_API_CREDIT_AUD_PER_USD = "2";
  delete process.env.PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.PANTHEON_DISABLE_OPENAI_AGENTS_SDK;

  const runtime = makeRuntime("file-factory");
  try {
    const build = prepareBuild(runtime.db);
    approve(runtime.db, get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [build.approval.id]));
    const productFiles = build.spec.catalogueItems.map((item, index) => ({
      path: `product-${index + 1}.csv`,
      bytes: Buffer.from(`item,value\n${index + 1},ready\n`),
    }));
    const manifest = {
      schema: "pantheon.product-manifest.v1",
      version: 1,
      planId: build.spec.planId,
      opportunityId: build.spec.opportunityId,
      catalogueItems: build.spec.catalogueItems.map((item, index) => ({
        id: item.id,
        files: [`product-${index + 1}.csv`],
      })),
      files: productFiles.map((file) => ({
        path: file.path,
        bytes: file.bytes.length,
        sha256: crypto.createHash("sha256").update(file.bytes).digest("hex"),
      })),
      bundle: {
        filename: build.spec.bundleFilename,
        canonicalManifestInsideBundle: true,
      },
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const zip = new AdmZip();
    for (const file of productFiles) zip.addFile(file.path, file.bytes);
    zip.addFile(build.spec.manifestFilename, manifestBytes);
    const bundleBytes = zip.toBuffer();
    __setDigitalProductFactoryForTests(async () => ({
      renderer: "pantheon-local-digital-product-factory-v1",
      files: [
        { filename: build.spec.manifestFilename, bytes: manifestBytes },
        { filename: build.spec.bundleFilename, bytes: bundleBytes },
      ],
    }));
    __setAgentRuntimeSdkRunnerForTests(async () => ({
      finalOutput: workerOutput("Product Builder", {
        productFormat: "ZIP catalogue with CSV templates",
        productionMethod: "Luna blueprint followed by Pantheon's deterministic local renderer.",
        qualityChecks: ["Manifest coverage", "Archive validation", "Sample data present"],
        limitations: ["Semantic usefulness still needs independent review"],
        approvalNeeded: "Quality review before launch preparation",
        channelFit: "Gumroad digital download",
        productBlueprint: productBlueprint(build.spec),
      }),
      lastResponseId: "resp-pantheon-product-build",
      rawResponses: [{
        responseId: "resp-pantheon-product-build",
        usage: { input_tokens: 900, output_tokens: 500, total_tokens: 1400 },
        output: [],
      }],
      runContext: { usage: { inputTokens: 900, outputTokens: 500, totalTokens: 1400 } },
      lastAgent: { name: "Product Builder" },
      interruptions: [],
    }));

    const executed = await runOnce(runtime.db, { taskId: build.task.id });
    const evaluation = get(
      runtime.db,
      "SELECT status, score, findings, metadata FROM agent_eval_results WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
      [build.task.id],
    );
    assert.equal(executed.status, "completed", JSON.stringify({
      error: executed.error || null,
      evaluation: evaluation ? {
        ...evaluation,
        findings: fromJson(evaluation.findings, []),
        metadata: fromJson(evaluation.metadata, {}),
      } : null,
    }));
    assert.equal(executed.result.output.generatedFiles.files.length, 2);
    assert.equal(executed.result.output.generatedFiles.manifest.planId, build.spec.planId);
    assert.equal(executed.result.qualityGate.status, "not_required");
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM deliverables WHERE task_id = ? AND status = 'built_pending_quality_review'", [build.task.id]).count,
      2,
    );
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM deliverables WHERE workflow_id = ? AND format = 'pdf'", [build.task.workflow_id]).count,
      0,
      "Supervisor-owned internal work must not generate an operator PDF at every worker boundary.",
    );
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM agent_handoffs WHERE task_id = ?", [build.task.id]).count, 0);
  } finally {
    closeRuntime(runtime);
    __setAgentRuntimeSdkRunnerForTests(null);
    __setDigitalProductFactoryForTests(null);
    for (const [name, value] of [
      ["OPENAI_API_KEY", previous.key],
      ["PANTHEON_ENABLE_LIVE_MODELS", previous.liveModels],
      ["PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER", previous.disabledAdapter],
      ["PANTHEON_DISABLE_OPENAI_AGENTS_SDK", previous.disabledSdk],
      ["PANTHEON_API_CREDIT_AUD_PER_USD", previous.rate],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Jarvis recovers an exact retained Product Builder result after a tested local validator repair", async () => {
  const runtime = makeRuntime("retained-output-recovery");
  const recoveryArtifactRoot = path.join(
    CONFIG.rootDir,
    "data",
    `test-retained-recovery-${crypto.randomUUID()}`,
  );
  const previous = {
    key: process.env.OPENAI_API_KEY,
    liveModels: process.env.PANTHEON_ENABLE_LIVE_MODELS,
    disabledAdapter: process.env.PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER,
    disabledSdk: process.env.PANTHEON_DISABLE_OPENAI_AGENTS_SDK,
    rate: process.env.PANTHEON_API_CREDIT_AUD_PER_USD,
  };
  try {
    process.env.OPENAI_API_KEY = "test-recovery-key";
    process.env.PANTHEON_ENABLE_LIVE_MODELS = "1";
    process.env.PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER = "0";
    process.env.PANTHEON_DISABLE_OPENAI_AGENTS_SDK = "0";
    process.env.PANTHEON_API_CREDIT_AUD_PER_USD = "1.579";
    const build = prepareBuild(runtime.db);
    approve(runtime.db, get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [build.approval.id]));
    const retainedOutput = workerOutput("Product Builder", {
      productFormat: "Three-file spreadsheet bundle",
      productionMethod: "Luna blueprint followed by Pantheon's deterministic local renderer.",
      qualityChecks: ["Exact IDs", "Workbook validation", "Status fields"],
      limitations: ["Buyer demand remains unproven"],
      approvalNeeded: "Independent quality review",
      channelFit: "Gumroad digital download",
      productBlueprint: productBlueprint(build.spec),
    });
    __setDigitalProductFactoryForTests(async () => {
      throw new Error("Simulated superseded local validator rejected Communication Status.");
    });
    __setAgentRuntimeSdkRunnerForTests(async () => ({
      finalOutput: retainedOutput,
      lastResponseId: "resp-retained-product-builder",
      rawResponses: [{
        responseId: "resp-retained-product-builder",
        usage: { input_tokens: 800, output_tokens: 400, total_tokens: 1200 },
        output: [],
      }],
      runContext: { usage: { inputTokens: 800, outputTokens: 400, totalTokens: 1200 } },
      lastAgent: { name: "Product Builder" },
      interruptions: [],
    }));

    const failed = await runOnce(runtime.db, { taskId: build.task.id });
    assert.equal(failed.status, "needs_attention");
    assert.equal(
      get(runtime.db, "SELECT outcome_status FROM tasks WHERE id = ?", [build.task.id]).outcome_status,
      "known_provider_result_needs_review",
    );
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM deliverables WHERE task_id = ?", [build.task.id]).count,
      0,
    );
    const staleRetry = prepareCatalogueBuild(runtime.db, {
      roundId: "round-pantheon-production",
      opportunityId: "opp-pantheon-production",
      planId: "plan-pantheon-production",
      operatorChoiceRequired: false,
      revisionNumber: 1,
      revisionFeedback: "Simulate a later reviewed retry that recovery will supersede.",
    });
    run(
      runtime.db,
      `UPDATE tasks
       SET status = 'needs_attention',
           outcome_status = 'known_provider_result_needs_review',
           error = 'Simulated later retry failed the superseded local validator.',
           updated_at = ?
       WHERE id = ?`,
      [now(), staleRetry.task.id],
    );

    __setDigitalProductFactoryForTests(null);
    const recovered = await recoverRetainedProductBuilderResult(runtime.db, build.task.id, {
      artifactRoot: recoveryArtifactRoot,
    });
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.existing, false);
    assert.equal(recovered.receipt.status, "complete");
    assert.equal(recovered.projection.projected, true);
    assert.equal(recovered.projection.stage, "product_build");
    assert.equal(recovered.task.kind, "local_product_output_recovery");
    assert.equal(recovered.task.agent, "jarvis");
    assert.equal(recovered.task.result.raw.noNewProviderCall, true);
    assert.equal(recovered.task.result.output.generatedFiles.manifest.catalogueItems.length, 3);
    assert.equal(
      getCockpitState(runtime.db).importantWork.some((item) => item.id === build.task.id),
      false,
      "A recovered provider result remains auditable but must leave current operator attention.",
    );
    assert.equal(
      get(runtime.db, "SELECT status FROM tasks WHERE id = ?", [build.task.id]).status,
      "failed",
      "The original failed provider-backed task remains auditable without blocking recovered work.",
    );
    assert.equal(
      get(runtime.db, "SELECT status FROM tasks WHERE id = ?", [staleRetry.task.id]).status,
      "failed",
      "A later reviewed retry remains auditable but cannot block the recovered successor.",
    );
    const successorTask = recovered.projection.result.next.task;
    const successorStage = successorTask.payload.liveSpendRequest.parameters.pantheonProduction.stage;
    assert.equal(getProductionState(runtime.db).currentTask.id, successorTask.id);
    assert.equal(
      getProductionState(runtime.db).currentTask.payload.liveSpendRequest.parameters.pantheonProduction.stage,
      successorStage,
    );
    const supersededApprovalId = successorTask.approval_id;
    approve(
      runtime.db,
      get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [supersededApprovalId]),
    );
    const refreshed = await recoverRetainedProductBuilderResult(runtime.db, build.task.id, {
      artifactRoot: recoveryArtifactRoot,
      rendererRevision: "workbook-layout-and-status-v3-test",
    });
    assert.equal(refreshed.existing, false);
    assert.notEqual(refreshed.task.id, recovered.task.id);
    assert.equal(
      refreshed.projection.projected,
      true,
      `Expected refreshed package projection: ${JSON.stringify(refreshed.projection)}`,
    );
    assert.equal(
      refreshed.projection.result.next.task.payload.liveSpendRequest.parameters.pantheonProduction.buildTaskId,
      refreshed.task.id,
      `Expected refreshed successor binding: ${JSON.stringify({
        nextTaskId: refreshed.projection.result.next.task.id,
        nextExisting: refreshed.projection.result.next.existing,
        nextBuildTaskId: refreshed.projection.result.next.task.payload.liveSpendRequest.parameters.pantheonProduction.buildTaskId,
        refreshedTaskId: refreshed.task.id,
      })}`,
    );
    const replacementSuccessor = getProductionState(runtime.db).currentTask;
    assert.equal(
      replacementSuccessor.id,
      refreshed.projection.result.next.task.id,
    );
    assert.equal(
      get(runtime.db, "SELECT status FROM tasks WHERE id = ?", [successorTask.id]).status,
      "cancelled",
    );
    const storefrontApprovals = all(
      runtime.db,
      "SELECT id, status, task_id FROM approvals WHERE task_id = ? ORDER BY requested_at",
      [successorTask.id],
    );
    assert.equal(
      get(runtime.db, "SELECT status FROM approvals WHERE id = ?", [supersededApprovalId]).status,
      "superseded",
      `Expected old approval retirement; approvals: ${JSON.stringify(storefrontApprovals)}; events: ${JSON.stringify(
        all(runtime.db, "SELECT type, entity_id, metadata FROM events WHERE type = 'production.unstarted_request_superseded'"),
      )}`,
    );
    assert.notEqual(
      replacementSuccessor.approval_id,
      supersededApprovalId,
      `Expected a new exact approval after package refresh; approvals: ${JSON.stringify(storefrontApprovals)}`,
    );
    assert.equal(
      replacementSuccessor.payload.liveSpendRequest.parameters.pantheonProduction.buildTaskId,
      refreshed.task.id,
    );
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM deliverables WHERE task_id = ? AND status = 'superseded'", [recovered.task.id]).count >= 4,
      true,
      "A corrected local package must leave the older files as non-current history.",
    );
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM deliverables WHERE task_id = ? AND status = 'built_pending_quality_review'", [refreshed.task.id]).count >= 4,
      true,
    );
    approve(
      runtime.db,
      get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [replacementSuccessor.approval_id]),
    );
    const successorClaim = claimNextTask(runtime.db, {
      taskId: replacementSuccessor.id,
      claimant: "recovery-ordering-test",
    });
    assert.equal(successorClaim.task.id, replacementSuccessor.id);
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ?", [recovered.task.id]).count,
      0,
      "Local recovery must not create a new model call.",
    );
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM deliverables WHERE task_id = ?", [recovered.task.id]).count >= 4,
      true,
    );

    const repeated = await recoverRetainedProductBuilderResult(runtime.db, build.task.id, {
      artifactRoot: recoveryArtifactRoot,
      rendererRevision: "workbook-layout-and-status-v3-test",
    });
    assert.equal(repeated.existing, true);
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM tasks WHERE kind = 'local_product_output_recovery'").count,
      2,
    );
    assert.equal(
      getProductionState(runtime.db).currentTask.payload.liveSpendRequest.parameters.pantheonProduction.stage,
      successorStage,
      "Replaying recovery must restore the genuine successor instead of moving backward.",
    );
  } finally {
    closeRuntime(runtime);
    fs.rmSync(recoveryArtifactRoot, { recursive: true, force: true });
    __setAgentRuntimeSdkRunnerForTests(null);
    __setDigitalProductFactoryForTests(null);
    for (const [name, value] of [
      ["OPENAI_API_KEY", previous.key],
      ["PANTHEON_ENABLE_LIVE_MODELS", previous.liveModels],
      ["PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER", previous.disabledAdapter],
      ["PANTHEON_DISABLE_OPENAI_AGENTS_SDK", previous.disabledSdk],
      ["PANTHEON_API_CREDIT_AUD_PER_USD", previous.rate],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("finished files flow through quality, copy and launch planning to one real operator boundary", () => {
  const runtime = makeRuntime("launch-boundary");
  try {
    const build = prepareBuild(runtime.db);
    const generated = insertGeneratedDeliverables(runtime, build.task);
    completeTask(runtime.db, build.task.id, {
      ...workerOutput("Product Builder", {
        productFormat: "ZIP catalogue",
        producedFiles: generated.files.map((file) => file.humanName),
        catalogueCoverage: ["catalogue-item-1", "catalogue-item-2", "catalogue-item-3"],
      }),
      generatedFiles: generated,
    });
    const buildProjection = projectCompletedProductionTask(runtime.db, build.task.id);
    assert.equal(buildProjection.stage, "product_build");
    const qualityTask = buildProjection.result.next.task;
    assert.equal(qualityTask.agent, "quality_reviewer");
    const reviewRequest = qualityTask.payload.liveSpendRequest;
    assert.deepEqual(
      reviewRequest.parameters.reviewBindings.map((binding) => binding.deliverableId).sort(),
      generated.files.map((file) => file.id).sort(),
    );
    assert.equal(reviewRequest.parameters.qualityReviewPacket.catalogueItems.length, 3);
    assert.deepEqual(
      reviewRequest.parameters.qualityReviewPacket.catalogueItems.map((item) => item.id),
      ["catalogue-item-1", "catalogue-item-2", "catalogue-item-3"],
    );
    assert.equal(reviewRequest.parameters.qualityReviewPacket.deterministicChecks.exactCatalogueCoverage, true);
    assert.equal(reviewRequest.parameters.qualityReviewPacket.schema, "pantheon.product-quality-review-packet.v3");
    assert.equal(
      reviewRequest.parameters.qualityReviewPacket.deterministicChecks.formulaCoverageComplete,
      true,
    );
    assert.match(qualityTask.payload.workBrief.assetPrompt, /complete frozen qualityReviewPacket/i);
    assert.doesNotMatch(qualityTask.payload.workBrief.assetPrompt, /catalogueItems/);
    const reviewModelPacket = buildWorkerModelPacket(
      runtime.db,
      qualityTask,
      findAgentDefinition(runtime.db, qualityTask),
    );
    assert.equal(reviewModelPacket.qualityReviewTargets.length, 2);
    assert.equal(reviewModelPacket.qualityReviewPacket.catalogueItems.length, 3);

    completeTask(runtime.db, qualityTask.id, workerOutput("Quality Reviewer", {
      qualityScore: 92,
      riskFindings: [],
      missingEvidence: [],
      claimSafety: "safe",
      operatorRecommendation: "Continue to launch preparation.",
    }));
    const qualityProjection = projectCompletedProductionTask(runtime.db, qualityTask.id);
    assert.equal(qualityProjection.result.verdict.passed, true);
    for (const file of generated.files) {
      assert.equal(
        get(runtime.db, "SELECT status FROM deliverables WHERE id = ?", [file.id]).status,
        "quality_passed",
        "Every file reviewed in the accepted package, including its manifest, must carry the final quality verdict.",
      );
    }
    const copyTask = qualityProjection.result.next.task;
    assert.equal(copyTask.agent, "copy_conversion_agent");
    assert.equal(
      JSON.parse(copyTask.payload.workBrief.assetPrompt).currency,
      "AUD",
    );
    const expectedIncludedFiles = copyTask.payload.liveSpendRequest.parameters
      .pantheonProduction.verifiedLaunchState.expectedIncludedFiles;

    completeTask(runtime.db, copyTask.id, workerOutput("Copy and Conversion Agent", {
      productTitle: "Freelancer Cash Control Toolkit",
      headline: "Know what your freelance cash can safely do this week",
      description: "Three practical templates for weekly cash, quarterly reserves, and invoice follow-up.\\n\\nUse the reviewed files to plan the next step.",
      callToAction: "Download the toolkit",
      includedFiles: expectedIncludedFiles,
      tags: ["freelancer finance", "cash flow toolkit"],
      faq: ["What is included? The exact files listed in the customer package."],
      messageVariants: ["Plan the week", "Protect the quarter"],
      claimChecks: ["No guaranteed financial outcome"],
      trackingNote: "Run the first test at $29 and use qualified Gumroad views and paid purchases.",
    }));
    const copyProjection = projectCompletedProductionTask(runtime.db, copyTask.id);
    const listingPath = path.resolve(CONFIG.rootDir, copyProjection.result.deliverable.file_path);
    const listingText = fs.readFileSync(listingPath, "utf8");
    assert.match(listingText, /A\$29/);
    assert.doesNotMatch(listingText, /\\n/);
    assert.match(listingText, /invoice follow-up\.\n\nUse the reviewed files/);
    const distributionTask = copyProjection.result.next.task;
    assert.equal(distributionTask.agent, "distribution_operator");

    completeTask(runtime.db, distributionTask.id, workerOutput("Distribution Agent", {
      audience: "Australian freelancers",
      channelSteps: ["Publish the reviewed Gumroad listing", "Share up to three approved organic posts"],
      evidenceToCapture: ["Qualified product views", "Paid buyers", "Refunds", "Net contribution"],
      successMetric: "Three independent paid buyers and positive net cash contribution",
      stopRule: "Diagnose reach, offer, price and checkout after 14 days or 50 qualified views.",
      operatorWorkload: "Review the listing, complete private Gumroad setup, and press Publish.",
    }));
    const distributionProjection = projectCompletedProductionTask(runtime.db, distributionTask.id);
    const plan = distributionProjection.plan;
    assert.equal(plan.status, "launch_decision");
    assert.ok(plan.metadata.launchDecisionHandoffId);
    assert.ok(plan.metadata.approvalPackDeliverableId);
    const experiment = get(runtime.db, "SELECT status, hypothesis, offer FROM commercial_experiments");
    assert.equal(experiment.status, "ready");
    assert.doesNotMatch(experiment.hypothesis, /Show the finished Use\b/i);
    assert.doesNotMatch(experiment.hypothesis, /\.\s+through\b|\.\./);
    assert.match(experiment.hypothesis, /Customer promise:/i);
    assert.match(experiment.offer, /:/);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM deliverables WHERE format = 'pdf'").count, 1);
    const decisions = getDecisionsState(runtime.db);
    const launchChoice = decisions.approvals.find((item) => item.decisionActionKind === "launch_readiness");
    assert.equal(launchChoice.title, "Decide whether this product should move to publish-ready");
    assert.equal(launchChoice.approveLabel, "Move to publish-ready");

    const handoff = getAgentHandoff(runtime.db, plan.metadata.launchDecisionHandoffId);
    const decision = applyPantheonHandoffDecision(runtime.db, handoff, "approve", "Proceed to the separate real publishing action.");
    assert.equal(decision.externalActionCompleted, false);
    assert.equal(decision.plan.status, "ready_to_publish");
    assert.equal(getProductionState(runtime.db).readyToPublish.length, 1);
    const operatorMessage = get(runtime.db, "SELECT * FROM messages WHERE subject = 'Publish the approved product test'");
    assert.ok(operatorMessage);
    assert.match(operatorMessage.body, /press Publish/);
  } finally {
    closeRuntime(runtime);
  }
});

test("listing projection rejects a foreign-currency label on Pantheon's canonical AUD price", () => {
  const runtime = makeRuntime("foreign-listing-price");
  try {
    const build = prepareBuild(runtime.db);
    const generated = insertGeneratedDeliverables(runtime, build.task);
    completeTask(runtime.db, build.task.id, {
      ...workerOutput("Product Builder", {
        productFormat: "ZIP catalogue",
        producedFiles: generated.files.map((file) => file.humanName),
        catalogueCoverage: generated.manifest.catalogueItems.map((item) => item.id),
      }),
      generatedFiles: generated,
    });
    const buildProjection = projectCompletedProductionTask(runtime.db, build.task.id);
    const qualityTask = buildProjection.result.next.task;
    completeTask(runtime.db, qualityTask.id, workerOutput("Quality Reviewer", {
      qualityScore: 92,
      riskFindings: [],
      missingEvidence: [],
      claimSafety: "safe",
      operatorRecommendation: "Continue to launch preparation.",
    }));
    const qualityProjection = projectCompletedProductionTask(runtime.db, qualityTask.id);
    const copyTask = qualityProjection.result.next.task;
    const expectedIncludedFiles = copyTask.payload.liveSpendRequest.parameters
      .pantheonProduction.verifiedLaunchState.expectedIncludedFiles;
    completeTask(runtime.db, copyTask.id, workerOutput("Copy and Conversion Agent", {
      productTitle: "Freelancer Cash Control Toolkit",
      headline: "A practical Australian freelancer toolkit",
      description: "Three editable templates with setup guidance.",
      callToAction: "Download the toolkit",
      includedFiles: expectedIncludedFiles,
      tags: ["freelancer templates"],
      faq: ["What is included? The exact files shown above."],
      messageVariants: ["Start with one weekly workflow."],
      claimChecks: ["No guaranteed financial outcome."],
      trackingNote: "Run the first market test at US$29.",
    }));
    assert.throws(
      () => projectCompletedProductionTask(runtime.db, copyTask.id),
      /canonical AUD test price as a foreign-currency price/,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("verified launch-context repair replaces stale work with one compact current-truth handoff", () => {
  const runtime = makeRuntime("launch-context-repair");
  try {
    const build = prepareBuild(runtime.db);
    const generated = insertGeneratedDeliverables(runtime, build.task);
    completeTask(runtime.db, build.task.id, {
      ...workerOutput("Product Builder", {
        productFormat: "ZIP catalogue",
        producedFiles: generated.files.map((file) => file.humanName),
        catalogueCoverage: ["catalogue-item-1", "catalogue-item-2", "catalogue-item-3"],
      }),
      generatedFiles: generated,
    });
    const buildProjection = projectCompletedProductionTask(runtime.db, build.task.id);
    const qualityTask = buildProjection.result.next.task;
    completeTask(runtime.db, qualityTask.id, workerOutput("Quality Reviewer", {
      qualityScore: 93,
      riskFindings: [],
      missingEvidence: [],
      claimSafety: "safe",
      operatorRecommendation: "Continue to launch preparation.",
    }));
    const qualityProjection = projectCompletedProductionTask(runtime.db, qualityTask.id);
    const staleCopyTask = qualityProjection.result.next.task;

    const repair = prepareVerifiedLaunchContextRepair(runtime.db, {
      planId: "plan-pantheon-production",
      reason: "Replace a clipped launch packet with current verified product truth.",
    });
    assert.equal(repair.repaired, true);
    assert.equal(repair.contextRevision, 1);
    assert.ok(repair.supersededTaskIds.includes(staleCopyTask.id));
    assert.equal(
      repair.task.payload.liveSpendRequest.parameters.pantheonProduction.contextRevision,
      1,
    );
    const compactContext = JSON.parse(repair.task.payload.workBrief.assetPrompt);
    assert.equal(compactContext.currentVerifiedCatalogue.currentTruthRule.includes("audit history"), true);
    assert.equal(compactContext.currentVerifiedCatalogue.independentQuality.score, 93);
    assert.ok(repair.task.payload.workBrief.assetPrompt.length < 12_000);
    assert.equal(get(runtime.db, "SELECT status FROM tasks WHERE id = ?", [staleCopyTask.id]).status, "cancelled");
    assert.equal(
      get(runtime.db, "SELECT status FROM approvals WHERE id = ?", [staleCopyTask.approval_id]).status,
      "superseded",
    );

    const refreshed = prepareVerifiedLaunchContextRepair(runtime.db, {
      planId: "plan-pantheon-production",
      reason: "Use an even narrower verified launch record.",
    });
    assert.equal(refreshed.contextRevision, 2);
    assert.equal(get(runtime.db, "SELECT status FROM tasks WHERE id = ?", [repair.task.id]).status, "cancelled");
    assert.equal(
      get(runtime.db, "SELECT status FROM approvals WHERE id = ?", [repair.task.approval_id]).status,
      "superseded",
    );
    assert.equal(
      get(
        runtime.db,
        `SELECT COUNT(*) AS count
         FROM approvals
         JOIN tasks ON tasks.id = approvals.task_id
         WHERE approvals.status = 'pending'
           AND json_extract(tasks.payload, '$.liveSpendRequest.parameters.pantheonProduction.planId')
             = 'plan-pantheon-production'
           AND json_extract(tasks.payload, '$.liveSpendRequest.parameters.pantheonProduction.stage')
             IN ('conversion_copy', 'distribution_plan', 'chief_brief')`,
      ).count,
      1,
    );
    const repairedPlan = getProductionState(runtime.db).plans.find((plan) => plan.id === "plan-pantheon-production");
    assert.equal(repairedPlan.metadata.launchContextRevision, 2);
    assert.equal(repairedPlan.metadata.launchDecisionHandoffId, null);
  } finally {
    closeRuntime(runtime);
  }
});

test("Jarvis refreshes a false-negative quality packet without changing product files or calling a model", () => {
  const runtime = makeRuntime("quality-evidence-repair");
  try {
    const ts = now();
    const build = prepareCatalogueBuild(runtime.db, {
      roundId: "round-pantheon-production",
      opportunityId: "opp-pantheon-production",
      planId: "plan-pantheon-production",
      operatorChoiceRequired: true,
      revisionNumber: 1,
      revisionFeedback: "Use the corrected product package.",
    });
    assert.deepEqual(
      build.task.payload.workBrief.requiredCorrections,
      ["Use the corrected product package."],
    );
    assert.deepEqual(
      build.task.payload.liveSpendRequest.executionDescriptor.materializedInput.assignmentBrief.requiredCorrections,
      ["Use the corrected product package."],
    );
    assert.doesNotMatch(
      build.task.payload.workBrief.assetPrompt,
      /Use the corrected product package/,
    );
    const generated = insertGeneratedDeliverables(runtime, build.task);
    completeTask(runtime.db, build.task.id, {
      ...workerOutput("Product Builder", {
        productFormat: "ZIP catalogue",
        producedFiles: generated.files.map((file) => file.humanName),
        catalogueCoverage: generated.manifest.catalogueItems.map((item) => item.id),
      }),
      generatedFiles: generated,
    });
    const buildProjection = projectCompletedProductionTask(runtime.db, build.task.id);
    const qualityTask = buildProjection.result.next.task;
    const legacyPayload = structuredClone(qualityTask.payload);
    const legacyPacket = legacyPayload.liveSpendRequest.parameters.qualityReviewPacket;
    legacyPacket.schema = "pantheon.product-quality-review-packet.v2";
    legacyPacket.deterministicChecks.workbookSemanticsExposed = false;
    legacyPacket.deterministicChecks.formulaCoverageComplete = false;
    legacyPayload.liveSpendRequest.parameters.pantheonProduction.reviewFingerprint = "legacy-incomplete-evidence";
    run(
      runtime.db,
      `UPDATE tasks
       SET status = 'completed', outcome_status = 'known', payload = ?, result = ?,
           completed_at = ?, updated_at = ? WHERE id = ?`,
      [
        toJson(legacyPayload),
        toJson({ output: workerOutput("Quality Reviewer", { qualityScore: 78 }) }),
        ts,
        ts,
        qualityTask.id,
      ],
    );
    run(
      runtime.db,
      `INSERT INTO pantheon_journeys
       (id, venture_id, mode, status, active_stage, model, model_locked,
        budget_cap_cents, carried_exposure_cents, round_id, workflow_id,
        selected_opportunity_id, metadata, started_at, completed_at, created_at, updated_at)
       VALUES ('journey-quality-evidence-repair', 'venture-digital-products', 'rehearsal',
        'stopped_after_correction', 'quality_review', ?, 1, 1500, 0,
        'round-pantheon-production', 'wf-pantheon-production', 'opp-pantheon-production',
        '{}', ?, ?, ?, ?)`,
      [CONFIG.lunaModel, ts, ts, ts, ts],
    );
    run(
      runtime.db,
      "UPDATE pantheon_journeys SET status = 'stopped_after_correction', active_stage = 'quality_review', completed_at = ?, updated_at = ? WHERE id = 'journey-quality-evidence-repair'",
      [ts, ts],
    );
    run(
      runtime.db,
      "UPDATE catalogue_plans SET status = 'needs_attention', updated_at = ? WHERE id = 'plan-pantheon-production'",
      [ts],
    );

    const recovered = recoverQualityReviewAfterEvidenceRepair(runtime.db, qualityTask.id);
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.noProviderCall, true);
    assert.notEqual(recovered.task.id, qualityTask.id);
    assert.equal(recovered.task.agent, "quality_reviewer");
    assert.equal(
      recovered.task.payload.liveSpendRequest.parameters.qualityReviewPacket.schema,
      "pantheon.product-quality-review-packet.v3",
    );
    assert.equal(
      recovered.task.payload.liveSpendRequest.parameters.qualityReviewPacket
        .deterministicChecks.formulaCoverageComplete,
      true,
    );
    assert.equal(
      get(runtime.db, "SELECT status FROM pantheon_journeys WHERE id = 'journey-quality-evidence-repair'").status,
      "waiting_for_operator",
    );
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls").count, 0);
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM events WHERE type = 'quality_review.evidence_packet_recovered'").count,
      1,
    );
    const qualityDecision = getDecisionsState(runtime.db).approvals.find(
      (item) => item.id === recovered.approval.id,
    );
    assert.equal(qualityDecision.correctionNumber, 1);
    assert.equal(qualityDecision.finalQualityRecheck, true);
    assert.equal(qualityDecision.primaryActionLabel, "Review final quality recheck");
    assert.equal(qualityDecision.approveLabel, "Start final quality recheck");
  } finally {
    closeRuntime(runtime);
  }
});

test("Jarvis rechecks new package hashes after a proven zero-spend local renderer repair", () => {
  const runtime = makeRuntime("quality-renderer-repair");
  try {
    const ts = now();
    const build = prepareCatalogueBuild(runtime.db, {
      roundId: "round-pantheon-production",
      opportunityId: "opp-pantheon-production",
      planId: "plan-pantheon-production",
      operatorChoiceRequired: false,
      revisionNumber: 1,
      revisionFeedback: "Use the corrected product package.",
    });
    const generated = insertGeneratedDeliverables(runtime, build.task);
    generated.blueprintHash = "unchanged-blueprint-hash";
    completeTask(runtime.db, build.task.id, {
      ...workerOutput("Product Builder", {
        productFormat: "ZIP catalogue",
        producedFiles: generated.files.map((file) => file.humanName),
        catalogueCoverage: generated.manifest.catalogueItems.map((item) => item.id),
      }),
      generatedFiles: generated,
    });
    const buildProjection = projectCompletedProductionTask(runtime.db, build.task.id);
    const qualityTask = buildProjection.result.next.task;
    completeTask(runtime.db, qualityTask.id, {
      ...workerOutput("Quality Reviewer", {
        qualityScore: 82,
        riskFindings: ["One instruction names a field that the workbook does not contain."],
        missingEvidence: ["A corrected package with new verified hashes."],
        claimSafety: "Revise the field wording.",
        operatorRecommendation: "Correct the local package wording, then review the new bytes.",
      }),
      operatorDecision: "revise",
    });
    run(
      runtime.db,
      `INSERT INTO pantheon_journeys
       (id, venture_id, mode, status, active_stage, model, model_locked,
        budget_cap_cents, carried_exposure_cents, round_id, workflow_id,
        selected_opportunity_id, metadata, started_at, completed_at, created_at, updated_at)
       VALUES ('journey-quality-renderer-repair', 'venture-digital-products', 'rehearsal',
        'running', 'quality_review', ?, 1, 1500, 0,
        'round-pantheon-production', 'wf-pantheon-production', 'opp-pantheon-production',
        '{}', ?, NULL, ?, ?)`,
      [CONFIG.lunaModel, ts, ts, ts],
    );
    const stopped = projectCompletedProductionTask(runtime.db, qualityTask.id);
    assert.equal(stopped.result.correctionPrepared, false);
    assert.equal(
      get(runtime.db, "SELECT status FROM pantheon_journeys WHERE id = 'journey-quality-renderer-repair'").status,
      "stopped_after_correction",
    );

    const visualId = "deliv-renderer-repair-cover";
    const visualPath = path.join(CONFIG.artifactRoot, "renderer-repair-cover.png");
    fs.mkdirSync(path.dirname(visualPath), { recursive: true });
    fs.writeFileSync(
      visualPath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGP88PUXAymAiSTVDKMaiANMRKqDg1ENxACSQwkA+bAC/1GEth0AAAAASUVORK5CYII=",
        "base64",
      ),
    );
    run(
      runtime.db,
      `INSERT INTO deliverables
       (id, workflow_id, task_id, venture_id, title, human_name, audience, format,
        status, file_path, summary, metadata, content_hash, version, created_at, updated_at)
       VALUES (?, 'wf-pantheon-production', ?, 'venture-digital-products',
        'Storefront cover', 'Storefront cover', 'operator', 'image/png',
        'built_pending_quality_review', ?, 'Exact retained cover.',
        '{}', 'cover-hash', 1, ?, ?)`,
      [
        visualId,
        build.task.id,
        path.relative(CONFIG.rootDir, visualPath).replace(/\\/g, "/"),
        ts,
        ts,
      ],
    );
    const storedBuild = get(runtime.db, "SELECT result FROM tasks WHERE id = ?", [build.task.id]);
    const buildResult = fromJson(storedBuild.result, {});
    const previousFiles = buildResult.output.generatedFiles.files.map((file) => ({
      id: file.id,
      sha256: file.sha256,
      filePath: file.filePath,
    }));
    buildResult.output.generatedFiles.files = buildResult.output.generatedFiles.files.map((file) => ({
      ...file,
      sha256: `${file.sha256}-renderer-repaired`,
    }));
    const currentFiles = buildResult.output.generatedFiles.files.map((file) => ({
      id: file.id,
      sha256: file.sha256,
      filePath: file.filePath,
    }));
    run(
      runtime.db,
      "UPDATE tasks SET result = ?, updated_at = ? WHERE id = ?",
      [toJson(buildResult), now(), build.task.id],
    );
    for (const file of currentFiles) {
      run(
        runtime.db,
        "UPDATE deliverables SET content_hash = ?, version = version + 1, updated_at = ? WHERE id = ?",
        [file.sha256, now(), file.id],
      );
    }
    const planRow = get(runtime.db, "SELECT metadata FROM catalogue_plans WHERE id = 'plan-pantheon-production'");
    const planMetadata = fromJson(planRow.metadata, {});
    const refresh = {
      schema: "pantheon.local-renderer-refresh.v1",
      refreshedAt: now(),
      rendererRevision: "truth-aligned-fields-v1-test",
      sourceTaskId: build.task.id,
      blueprintHash: "unchanged-blueprint-hash",
      noProviderCall: true,
      externalAction: false,
      previousFiles,
      currentFiles,
    };
    run(
      runtime.db,
      "UPDATE catalogue_plans SET metadata = ?, updated_at = ? WHERE id = 'plan-pantheon-production'",
      [toJson({
        ...planMetadata,
        storefrontVisualIds: [visualId],
        localRendererRefreshedAt: refresh.refreshedAt,
        localRendererRefresh: refresh,
      }), now()],
    );

    const recovered = recoverQualityReviewAfterLocalRendererRepair(runtime.db, qualityTask.id);
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.noProviderCall, true);
    assert.equal(recovered.externalAction, false);
    assert.equal(recovered.rendererRevision, "truth-aligned-fields-v1-test");
    assert.notEqual(recovered.task.id, qualityTask.id);
    assert.equal(recovered.task.agent, "quality_reviewer");
    assert.equal(
      recovered.task.payload.liveSpendRequest.parameters.pantheonProduction.buildTaskId,
      build.task.id,
    );
    assert.deepEqual(
      recovered.task.payload.liveSpendRequest.parameters.approvedAssetIds,
      [visualId],
    );
    const journey = get(
      runtime.db,
      "SELECT status, completed_at, metadata FROM pantheon_journeys WHERE id = 'journey-quality-renderer-repair'",
    );
    assert.equal(journey.status, "waiting_for_operator");
    assert.equal(journey.completed_at, null);
    assert.equal(fromJson(journey.metadata, {}).blocker, null);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls").count, 0);
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM events WHERE type = 'quality_review.local_renderer_repair_ready'").count,
      1,
    );
  } finally {
    closeRuntime(runtime);
  }
});

test("new package bytes withdraw a completed publish-ready decision until exact recertification passes", () => {
  const runtime = makeRuntime("publish-ready-renderer-recertification");
  try {
    const ts = now();
    const build = prepareCatalogueBuild(runtime.db, {
      roundId: "round-pantheon-production",
      opportunityId: "opp-pantheon-production",
      planId: "plan-pantheon-production",
      operatorChoiceRequired: false,
      revisionNumber: 1,
      revisionFeedback: "Use the accepted corrected package.",
    });
    const generated = insertGeneratedDeliverables(runtime, build.task);
    generated.blueprintHash = "publish-ready-unchanged-blueprint";
    completeTask(runtime.db, build.task.id, {
      ...workerOutput("Product Builder", {
        productFormat: "ZIP catalogue",
        producedFiles: generated.files.map((file) => file.humanName),
        catalogueCoverage: generated.manifest.catalogueItems.map((item) => item.id),
      }),
      generatedFiles: generated,
    });
    const buildProjection = projectCompletedProductionTask(runtime.db, build.task.id);
    const qualityTask = buildProjection.result.next.task;
    completeTask(runtime.db, qualityTask.id, workerOutput("Quality Reviewer", {
      qualityScore: 93,
      riskFindings: [],
      missingEvidence: [],
      claimSafety: "safe",
      operatorRecommendation: "Continue to launch preparation.",
    }));
    const qualityProjection = projectCompletedProductionTask(runtime.db, qualityTask.id);
    const staleCopyTask = qualityProjection.result.next.task;

    const visualId = "deliv-publish-ready-recertification-cover";
    const visualPath = path.join(CONFIG.artifactRoot, "publish-ready-recertification-cover.png");
    fs.mkdirSync(path.dirname(visualPath), { recursive: true });
    fs.writeFileSync(
      visualPath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGP88PUXAymAiSTVDKMaiANMRKqDg1ENxACSQwkA+bAC/1GEth0AAAAASUVORK5CYII=",
        "base64",
      ),
    );
    run(
      runtime.db,
      `INSERT INTO deliverables
       (id, workflow_id, task_id, venture_id, title, human_name, audience, format,
        status, file_path, summary, metadata, content_hash, version, created_at, updated_at)
       VALUES (?, 'wf-pantheon-production', ?, 'venture-digital-products',
        'Storefront cover', 'Storefront cover', 'operator', 'image/png',
        'quality_passed', ?, 'Exact retained cover.',
        '{}', 'recertification-cover-hash', 1, ?, ?)`,
      [
        visualId,
        build.task.id,
        path.relative(CONFIG.rootDir, visualPath).replace(/\\/g, "/"),
        ts,
        ts,
      ],
    );

    const storedBuild = get(runtime.db, "SELECT result FROM tasks WHERE id = ?", [build.task.id]);
    const buildResult = fromJson(storedBuild.result, {});
    const previousFiles = buildResult.output.generatedFiles.files.map((file) => ({
      id: file.id,
      sha256: file.sha256,
      filePath: file.filePath,
    }));
    buildResult.output.generatedFiles.files = buildResult.output.generatedFiles.files.map((file) => ({
      ...file,
      sha256: `${file.sha256}-publish-ready-rerender`,
    }));
    const currentFiles = buildResult.output.generatedFiles.files.map((file) => ({
      id: file.id,
      sha256: file.sha256,
      filePath: file.filePath,
    }));
    run(
      runtime.db,
      "UPDATE tasks SET result = ?, updated_at = ? WHERE id = ?",
      [toJson(buildResult), ts, build.task.id],
    );
    for (const file of currentFiles) {
      run(
        runtime.db,
        "UPDATE deliverables SET content_hash = ?, version = version + 1, updated_at = ? WHERE id = ?",
        [file.sha256, ts, file.id],
      );
    }
    const planRow = get(runtime.db, "SELECT metadata FROM catalogue_plans WHERE id = 'plan-pantheon-production'");
    const planMetadata = fromJson(planRow.metadata, {});
    const refresh = {
      schema: "pantheon.local-renderer-refresh.v1",
      refreshedAt: ts,
      rendererRevision: "setup-guide-layout-v2-test",
      sourceTaskId: build.task.id,
      blueprintHash: "publish-ready-unchanged-blueprint",
      noProviderCall: true,
      externalAction: false,
      previousFiles,
      currentFiles,
    };
    run(
      runtime.db,
      `UPDATE catalogue_plans
       SET status = 'ready_to_publish', metadata = ?, updated_at = ?
       WHERE id = 'plan-pantheon-production'`,
      [toJson({
        ...planMetadata,
        storefrontVisualIds: [visualId],
        launchContextRevision: 0,
        launchDecision: "approve",
        localRendererRefreshedAt: ts,
        localRendererRefresh: refresh,
      }), ts],
    );
    run(
      runtime.db,
      "UPDATE opportunities SET status = 'ready_to_publish', updated_at = ? WHERE id = 'opp-pantheon-production'",
      [ts],
    );
    run(
      runtime.db,
      "UPDATE opportunity_rounds SET status = 'ready_to_publish', updated_at = ? WHERE id = 'round-pantheon-production'",
      [ts],
    );
    run(
      runtime.db,
      "UPDATE workflows SET status = 'ready_for_review', current_step = 'Launch decision ready', updated_at = ? WHERE id = 'wf-pantheon-production'",
      [ts],
    );
    run(
      runtime.db,
      `INSERT INTO pantheon_journeys
       (id, venture_id, mode, status, active_stage, model, model_locked,
        budget_cap_cents, carried_exposure_cents, round_id, workflow_id,
        selected_opportunity_id, metadata, started_at, completed_at, created_at, updated_at)
       VALUES ('journey-publish-ready-recertification', 'venture-digital-products',
        'rehearsal', 'completed', 'ready_to_publish', ?, 1, 3000, 0,
        'round-pantheon-production', 'wf-pantheon-production', 'opp-pantheon-production',
        ?, ?, ?, ?, ?)`,
      [
        CONFIG.lunaModel,
        toJson({ finalDecision: "approve", externalActionCompleted: false }),
        ts,
        ts,
        ts,
        ts,
      ],
    );
    run(
      runtime.db,
      `INSERT INTO messages
       (id, severity, status, subject, body, created_at, metadata)
       VALUES ('msg_publish_plan-pantheon-production', 'approval', 'open',
        'Publish the approved product test', 'The package was ready.', ?, ?)`,
      [ts, toJson({ planId: "plan-pantheon-production" })],
    );

    const recovered = recoverQualityReviewAfterLocalRendererRepair(runtime.db, qualityTask.id);
    assert.equal(recovered.completedAuditRecertification, true);
    assert.equal(recovered.nextContextRevision, 1);
    assert.ok(recovered.supersededLaunchTaskIds.includes(staleCopyTask.id));
    assert.equal(get(runtime.db, "SELECT status FROM tasks WHERE id = ?", [staleCopyTask.id]).status, "cancelled");
    assert.equal(
      get(runtime.db, "SELECT status FROM messages WHERE id = 'msg_publish_plan-pantheon-production'").status,
      "resolved",
    );
    const reopenedJourney = get(
      runtime.db,
      "SELECT status, active_stage, completed_at, metadata FROM pantheon_journeys WHERE id = 'journey-publish-ready-recertification'",
    );
    assert.equal(reopenedJourney.status, "waiting_for_operator");
    assert.equal(reopenedJourney.active_stage, "quality_review");
    assert.equal(reopenedJourney.completed_at, null);
    assert.equal(fromJson(reopenedJourney.metadata, {}).finalDecision, null);
    assert.equal(
      get(runtime.db, "SELECT status FROM opportunity_rounds WHERE id = 'round-pantheon-production'").status,
      "quality_review",
    );
    assert.equal(
      get(runtime.db, "SELECT status FROM opportunities WHERE id = 'opp-pantheon-production'").status,
      "quality_review",
    );
    const reopenedPlan = getProductionState(runtime.db).plans.find(
      (plan) => plan.id === "plan-pantheon-production",
    );
    assert.equal(reopenedPlan.status, "quality_review");
    assert.equal(reopenedPlan.metadata.qualityScore, null);
    assert.equal(reopenedPlan.metadata.qualityDecision, null);
    assert.equal(reopenedPlan.metadata.launchDecision, null);
    assert.equal(reopenedPlan.metadata.launchContextRevision, 1);
    assert.equal(get(runtime.db, "SELECT COUNT(*) AS count FROM model_calls").count, 0);

    completeTask(runtime.db, recovered.task.id, workerOutput("Quality Reviewer", {
      qualityScore: 94,
      riskFindings: [],
      missingEvidence: [],
      claimSafety: "safe",
      operatorRecommendation: "The new exact package is ready for launch preparation.",
    }));
    const reprojected = projectCompletedProductionTask(runtime.db, recovered.task.id);
    assert.equal(reprojected.result.verdict.passed, true);
    assert.equal(
      reprojected.result.next.task.payload.liveSpendRequest.parameters.pantheonProduction.contextRevision,
      1,
    );
    assert.notEqual(reprojected.result.next.task.id, staleCopyTask.id);
  } finally {
    closeRuntime(runtime);
  }
});

test("a quality result cannot be applied to product bytes that changed after review", () => {
  const runtime = makeRuntime("stale-quality-review");
  try {
    const build = prepareBuild(runtime.db);
    const generated = insertGeneratedDeliverables(runtime, build.task);
    completeTask(runtime.db, build.task.id, {
      ...workerOutput("Product Builder", {
        productFormat: "ZIP catalogue",
        producedFiles: generated.files.map((file) => file.humanName),
        catalogueCoverage: generated.manifest.catalogueItems.map((item) => item.id),
      }),
      generatedFiles: generated,
    });
    const buildProjection = projectCompletedProductionTask(runtime.db, build.task.id);
    const reviewedTask = buildProjection.result.next.task;

    generated.files[1] = {
      ...generated.files[1],
      bytes: generated.files[1].bytes + 1,
      sha256: "bundle-fixture-hash-after-local-repair",
    };
    const storedBuild = get(runtime.db, "SELECT result FROM tasks WHERE id = ?", [build.task.id]);
    const buildResult = fromJson(storedBuild.result, {});
    buildResult.output.generatedFiles = generated;
    run(
      runtime.db,
      "UPDATE tasks SET result = ?, updated_at = ? WHERE id = ?",
      [toJson(buildResult), now(), build.task.id],
    );
    run(
      runtime.db,
      "UPDATE deliverables SET content_hash = ?, updated_at = ? WHERE id = ?",
      [generated.files[1].sha256, now(), generated.files[1].id],
    );

    completeTask(runtime.db, reviewedTask.id, workerOutput("Quality Reviewer", {
      qualityScore: 92,
      riskFindings: [],
      missingEvidence: [],
      claimSafety: "safe",
      operatorRecommendation: "Continue to launch preparation.",
    }));
    const projection = projectCompletedProductionTask(runtime.db, reviewedTask.id);
    assert.equal(projection.result.staleReviewSuperseded, true);
    assert.notEqual(projection.result.next.task.id, reviewedTask.id);
    assert.equal(projection.result.next.task.agent, "quality_reviewer");
    assert.equal(projection.plan.status, "quality_review");
    assert.notEqual(
      projection.result.next.task.payload.liveSpendRequest.parameters.pantheonProduction.reviewFingerprint,
      reviewedTask.payload.liveSpendRequest.parameters.pantheonProduction.reviewFingerprint,
    );
    assert.equal(
      get(runtime.db, "SELECT COUNT(*) AS count FROM tasks WHERE agent = 'quality_reviewer'").count,
      2,
    );
  } finally {
    closeRuntime(runtime);
  }
});
