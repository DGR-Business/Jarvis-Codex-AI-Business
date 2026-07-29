const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const AdmZip = require("adm-zip");

const CONFIG = require("../src/config");
const { get, openDatabase, seedDatabase } = require("../src/db");
const { decideApproval } = require("../src/runtime/approvals");
const {
  __setAgentRuntimeSdkRunnerForTests,
  __setDigitalProductFactoryForTests,
} = require("../src/runtime/agent-runtime");
const { startOpportunityRound } = require("../src/runtime/pantheon-opportunities");
const { prepareRetentionPolicyDecision } = require("../src/runtime/retention-policy");
const { runOnce } = require("../src/runtime/orchestrator");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGP88PUXAymAiSTVDKMaiANMRKqDg1ENxACSQwkA+bAC/1GEth0AAAAASUVORK5CYII=",
  "base64",
);

function runtimeDb(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-full-journey-${name}-`));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  return { root, db };
}

function closeRuntime(runtime) {
  runtime.db.close();
  fs.rmSync(runtime.root, { recursive: true, force: true });
}

function workerOutput(workerName, work, overrides = {}) {
  return {
    heading: `${workerName} result`,
    summary: `${workerName} completed a substantive bounded commercial assignment using only the supplied records and approved tools.`,
    recommendation: "Continue to the next verified internal stage while every outside business action remains locked.",
    moneyMove: "Advance the strongest verified product opportunity through the next bounded internal stage.",
    evidence: [
      "The exact journey records and specialist input were used.",
      "No publication, customer contact, account action, advertising activation, or money movement occurred.",
    ],
    risks: ["Real buyer conversion remains unproven until a measured public market test begins."],
    nextAction: "Complete the next exact internal stage or stop at Daniel's decision.",
    operatorDecision: "approve",
    confidence: "medium",
    expectedUpside: "A complete, quality-checked offer can reach a real publication decision with uncertainty still visible.",
    costRisk: "Only the capped model and approved internal tool calls are exposed.",
    assumptions: ["Public sources and current internal records are representative enough for this pre-publication proof."],
    work,
    ...overrides,
  };
}

function researchItem(sequence, subject) {
  return {
    id: `search-${sequence}`,
    type: "web_search_call",
    status: "completed",
    action: {
      type: "search",
      queries: [`${subject} buyer demand and competitor pricing`],
      sources: [{
        title: `${subject} public market evidence`,
        url: `https://example.com/research/${sequence}`,
        publisher: "Example Research",
      }],
    },
  };
}

function sdkResult(finalOutput, sequence, agentName, output = []) {
  return {
    finalOutput,
    lastResponseId: `resp-full-journey-${sequence}`,
    rawResponses: [{
      responseId: `resp-full-journey-${sequence}`,
      usage: { input_tokens: 360, output_tokens: 220, total_tokens: 580 },
      output,
    }],
    runContext: { usage: { inputTokens: 360, outputTokens: 220, totalTokens: 580 } },
    lastAgent: { name: agentName },
    interruptions: [],
  };
}

function taskStage(task) {
  const parameters = task.payload.liveSpendRequest.parameters;
  return parameters.pantheonCommercial?.step || parameters.pantheonProduction?.stage;
}

test("a historical broad journey cannot reach a model or product without exact commercial authority", async () => {
  const previous = {
    key: process.env.OPENAI_API_KEY,
    liveModels: process.env.PANTHEON_ENABLE_LIVE_MODELS,
    liveResearch: process.env.PANTHEON_ENABLE_LIVE_RESEARCH,
    imageGeneration: process.env.PANTHEON_ENABLE_IMAGE_GENERATION,
    disabledAdapter: process.env.PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER,
    disabledSdk: process.env.PANTHEON_DISABLE_OPENAI_AGENTS_SDK,
    rate: process.env.PANTHEON_API_CREDIT_AUD_PER_USD,
  };
  process.env.OPENAI_API_KEY = "test-full-journey-key";
  process.env.PANTHEON_ENABLE_LIVE_MODELS = "1";
  process.env.PANTHEON_ENABLE_LIVE_RESEARCH = "1";
  process.env.PANTHEON_ENABLE_IMAGE_GENERATION = "1";
  process.env.PANTHEON_API_CREDIT_AUD_PER_USD = "2";
  delete process.env.PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.PANTHEON_DISABLE_OPENAI_AGENTS_SDK;

  const runtime = runtimeDb("complete");
  const calls = [];
  let productFactoryCalls = 0;
  let sequence = 0;
  __setDigitalProductFactoryForTests(async (task, blueprint) => {
    productFactoryCalls += 1;
    const spec = task.payload.liveSpendRequest.parameters.productBuildSpec;
    const archiveFiles = [];
    for (const [index, item] of blueprint.catalogueItems.entries()) {
      archiveFiles.push({
        path: `customer-files/${index + 1}-${item.id}.csv`,
        bytes: Buffer.from(`${item.columns.map((column) => column.name).join(",")}\n${item.sampleRows[0].join(",")}\n`),
      });
    }
    archiveFiles.push({
      path: "README.txt",
      bytes: Buffer.from("Open the included files in Excel or Google Sheets and replace the realistic sample values with your own records."),
    });
    archiveFiles.push({ path: "storefront-previews/dashboard-preview.png", bytes: ONE_PIXEL_PNG });
    archiveFiles.push({ path: "storefront-previews/workflow-preview.png", bytes: ONE_PIXEL_PNG });
    const manifest = {
      schema: "pantheon.product-manifest.v1",
      version: 1,
      planId: spec.planId,
      opportunityId: spec.opportunityId,
      catalogueItems: blueprint.catalogueItems.map((item, index) => ({
        id: item.id,
        files: [`customer-files/${index + 1}-${item.id}.csv`],
        validation: {
          sheets: ["Dashboard", "Read Me", "Tracker"],
          columns: item.columns.length,
          sampleRows: item.sampleRows.length,
          formulaCells: 0,
          reopened: true,
          instructions: item.instructions.map((text, instructionIndex) => ({
            cell: `Read Me!C${instructionIndex + 6}`,
            text: `${instructionIndex + 1}. ${text}`,
          })),
          fields: item.columns.map((column) => ({
            ...column,
            trackerHeader: column.name,
            readMeCell: "Read Me",
            readMeText: `${column.name}: ${column.guidance}`,
          })),
          sampleData: {
            headers: item.columns.map((column) => column.name),
            rows: item.sampleRows,
          },
          formulas: [],
          dataValidations: [],
          sheetSummary: {
            Dashboard: "Summary",
            Tracker: "Customer records",
            "Read Me": "Instructions",
          },
        },
      })),
      storefrontPreviews: [
        "storefront-previews/dashboard-preview.png",
        "storefront-previews/workflow-preview.png",
      ],
      files: archiveFiles.map((file) => ({
        path: file.path,
        bytes: file.bytes.length,
        sha256: crypto.createHash("sha256").update(file.bytes).digest("hex"),
      })),
      bundle: {
        filename: spec.bundleFilename,
        canonicalManifestInsideBundle: true,
      },
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
    const zip = new AdmZip();
    for (const file of archiveFiles) zip.addFile(file.path, file.bytes);
    zip.addFile(spec.manifestFilename, manifestBytes);
    return {
      renderer: "pantheon-local-digital-product-factory-v1",
      files: [
        { filename: spec.manifestFilename, bytes: manifestBytes },
        { filename: spec.bundleFilename, bytes: zip.toBuffer() },
      ],
    };
  });
  __setAgentRuntimeSdkRunnerForTests(async ({ task, agentDefinition }) => {
    sequence += 1;
    const stage = taskStage(task);
    calls.push({
      stage,
      agent: agentDefinition.id,
      model: task.payload.liveSpendRequest.model,
      modelLocked: task.payload.liveSpendRequest.parameters.modelRoute?.modelLocked === true,
      journeyId: task.payload.liveSpendRequest.parameters.pantheonJourney?.journeyId,
    });
    if (stage === "demand_validator" && calls.filter((call) => call.stage === "demand_validator").length === 1) {
      const journeyId = task.payload.liveSpendRequest.parameters.pantheonJourney.journeyId;
      assert.equal(
        get(runtime.db, "SELECT selected_opportunity_id FROM pantheon_journeys WHERE id = ?", [journeyId]).selected_opportunity_id,
        null,
        "A candidate being validated must not be presented as the selected winner.",
      );
    }
    if (stage === "opportunity_scout") {
      return sdkResult(workerOutput("Opportunity Scout", {
        opportunities: [
          {
            title: "Freelancer Cash-Flow Control Toolkit",
            businessModel: "Digital spreadsheet template bundle",
            buyer: "English-speaking freelancers with irregular income",
            problem: "Irregular income makes weekly spending, tax reserves, and runway decisions difficult.",
            offerDirection: "A five-part cash-flow spreadsheet toolkit with setup guide and realistic examples.",
            geography: "Global English",
            language: "English",
            channel: "Gumroad",
            demandEvidence: ["Freelancer cash-flow and tax-reserve tools are visibly offered across current creator marketplaces."],
            competitionEvidence: ["Existing templates show competition, but many lack an integrated weekly decision workflow."],
            economicsHypothesis: "A$29-A$39 digital bundle can retain strong gross contribution before acquisition costs.",
            smallestValidation: "Show a finished listing to 50 qualified freelancer visitors.",
            risks: ["Financial templates must avoid personalised financial advice and work reliably."],
            demandScore: 8.4,
            supplyGapScore: 7.8,
            economicsScore: 8.8,
            channelFitScore: 9.2,
            executionFitScore: 9.4,
            riskScore: 2.5,
            score: 8.8,
            confidence: "medium",
          },
          {
            title: "Solo Creator Content Planning System",
            businessModel: "Digital workbook and spreadsheet bundle",
            buyer: "Solo creators publishing across two or more channels",
            problem: "Creators lose time translating ideas into a consistent, measurable publishing schedule.",
            offerDirection: "A planning workbook, content calendar, reuse matrix, and performance tracker bundle.",
            geography: "Global English",
            language: "English",
            channel: "Gumroad",
            demandEvidence: ["Content calendar and creator workflow products are common paid digital offers."],
            competitionEvidence: ["The category is crowded and requires clearer workflow differentiation."],
            economicsHypothesis: "A$25-A$35 bundle has low fulfilment cost but meaningful positioning pressure.",
            smallestValidation: "Test a complete bundle page with 50 qualified creator visitors.",
            risks: ["Crowded competition may increase distribution cost."],
            demandScore: 80,
            supplyGapScore: 68,
            economicsScore: 85,
            channelFitScore: 88,
            executionFitScore: 92,
            riskScore: 35,
            score: 82,
            confidence: "medium",
          },
          {
            title: "Etsy Seller Pricing Calculator Pack",
            businessModel: "Digital calculator and spreadsheet toolkit",
            buyer: "Small handmade-product sellers",
            problem: "Sellers struggle to include fees, labour, materials, discounts, and target margin consistently.",
            offerDirection: "A multi-scenario pricing calculator, fee sheet, margin checker, and setup guide.",
            geography: "Global English",
            language: "English",
            channel: "Gumroad",
            demandEvidence: ["Pricing calculators and seller spreadsheets are established digital product formats."],
            competitionEvidence: ["Existing alternatives create price pressure and require current fee assumptions."],
            economicsHypothesis: "A$19-A$29 pack can be profitable if support and update costs stay low.",
            smallestValidation: "Measure qualified listing views, checkout starts, and paid buyers.",
            risks: ["Marketplace fees change and must be labelled as editable assumptions."],
            demandScore: 76,
            supplyGapScore: 72,
            economicsScore: 82,
            channelFitScore: 84,
            executionFitScore: 90,
            riskScore: 32,
            score: 79,
            confidence: "medium",
          },
          {
            title: "Seasonal Print-on-Demand Collection",
            businessModel: "Print on demand apparel",
            buyer: "Seasonal gift buyers",
            problem: "Buyers want distinctive occasion-specific apparel.",
            offerDirection: "A coordinated seasonal apparel collection.",
            geography: "United States",
            language: "English",
            channel: "Etsy and Gelato",
            demandEvidence: ["Seasonal apparel attracts recurring marketplace activity."],
            competitionEvidence: ["The category is highly saturated."],
            economicsHypothesis: "Margins depend on fulfilment, returns, and paid acquisition.",
            smallestValidation: "Validate designs and landed economics before any listing.",
            risks: ["The current Digital Product Kit cannot fulfil physical products."],
            demandScore: 72,
            supplyGapScore: 50,
            economicsScore: 55,
            channelFitScore: 62,
            executionFitScore: 30,
            riskScore: 65,
            score: 57,
            confidence: "low",
          },
        ],
        marketScope: "Broad lawful online commerce scan with a buildable digital-product first-journey filter.",
        evidenceGaps: ["Marketplace unit sales and conversion rates remain estimates without platform-owned data."],
        exclusionNotes: ["Physical-product findings are retained but not eligible for the first Digital Product Kit."],
        recommendedNextTest: "Run comparable source-backed demand checks on the three eligible digital products.",
      }), sequence, agentDefinition.name, [researchItem(sequence, "digital product opportunities")]);
    }
    if (stage === "demand_validator") {
      const subject = task.payload.subject;
      return sdkResult(workerOutput("Demand Validator", {
        demandVerdict: `${subject} has plausible category demand, visible alternatives, and a testable gap; paid conversion is not yet proven.`,
        sourceSummary: ["Current public marketplace and workflow evidence supports a recurring buyer problem and paid alternatives."],
        counterevidence: ["Public listings do not reveal verified unit sales or conversion rates."],
        assumptions: ["The selected public sources are directionally representative of the intended English-speaking buyer."],
        priceChannelHypothesis: "Test a complete Gumroad bundle between A$25 and A$39 with a clearly defined buyer workflow.",
        smallestTest: "Measure 50 qualified Gumroad product views against checkout starts and independent paid buyers.",
        successMetric: "At least three independent buyers and positive net cash contribution.",
        stopRule: "Revise or stop after 50 qualified views with zero sales unless stronger buyer evidence explains the gap.",
      }, {
        operatorDecision: "needs_evidence",
      }), sequence, agentDefinition.name, [researchItem(sequence, subject)]);
    }
    if (stage === "finance_analysis") {
      assert.equal(task.payload.liveSpendRequest.deadlineMs, 120000);
      assert.equal(task.payload.liveSpendRequest.maxOutputTokens, 4000);
      return sdkResult(workerOutput("Finance Agent", {
        price: "Test A$29 initially, with a justified A$39 complete-bundle ceiling.",
        marginLogic: "Revenue less Gumroad fees, refunds, model usage, allocated tools, and any approved advertising must remain positive in AUD.",
        breakEven: "At A$29, the first few buyers should recover the capped pre-publication model and image costs before paid acquisition.",
        costCap: "Keep the first organic test at no external spend; a later paid test requires a separate A$25 approval.",
        financialRisk: "Low fulfilment cost helps, but support, refunds, stale assumptions, and weak conversion can erase contribution.",
        decisionSignal: "Continue only while the conservative case retains positive per-sale contribution and measurable conversion criteria.",
      }), sequence, agentDefinition.name);
    }
    if (stage === "offer_architecture") {
      return sdkResult(workerOutput("Offer Architect", {
        buyer: "English-speaking freelancers who need one reliable weekly cash-control workflow.",
        problem: "Irregular income makes spending, tax reserves, invoice timing, and runway difficult to see together.",
        offer: "A five-part Freelancer Cash-Flow Control Toolkit with usable spreadsheets, examples, previews, and setup guidance.",
        price: "Launch hypothesis A$29, with a later A$39 bundle test only if buyer evidence supports it.",
        channel: "Gumroad direct digital download.",
        promise: "Turn irregular income records into a clearer weekly cash, reserve, and runway decision routine without personalised advice.",
        objections: ["Already uses a generic spreadsheet", "Worries setup will take too long", "Needs editable assumptions"],
        testHypothesis: "A complete five-part workflow will convert better than an isolated calculator because it solves the recurring decision sequence.",
        successMetric: "Three independent buyers and positive net cash contribution within 14 days or 50 qualified views.",
        stopRule: "Diagnose reach, listing, value, pricing, checkout, and product quality before revising or stopping at the qualified-view limit.",
        catalogueItems: [
          {
            title: "Weekly Cash Control Dashboard",
            buyerSegment: "Freelancers who need one weekly money review",
            outcome: "See cash in, cash out, reserves, and runway in one weekly view.",
            format: "XLSX workbook",
            includedTools: ["weekly dashboard", "cash log", "runway view"],
            differentiation: "Combines weekly decisions rather than only recording transactions.",
            priceCents: 2900,
          },
          {
            title: "Invoice and Follow-up Tracker",
            buyerSegment: "Freelancers managing several active clients",
            outcome: "Track invoice status, due dates, and the next follow-up without personalised collections advice.",
            format: "XLSX workbook",
            includedTools: ["invoice log", "due-date view", "follow-up queue"],
            differentiation: "Connects invoice status to an explicit next action.",
            priceCents: 1500,
          },
          {
            title: "Tax Reserve Planner",
            buyerSegment: "Freelancers setting aside editable tax assumptions",
            outcome: "Apply an editable reserve percentage to irregular receipts and compare the reserve with cash held.",
            format: "XLSX workbook",
            includedTools: ["receipt log", "editable reserve rate", "reserve comparison"],
            differentiation: "Keeps assumptions visible and avoids personalised tax recommendations.",
            priceCents: 1500,
          },
          {
            title: "Project Profitability Log",
            buyerSegment: "Freelancers comparing project revenue, direct costs, and time",
            outcome: "Review contribution and time assumptions across completed projects.",
            format: "XLSX workbook",
            includedTools: ["project log", "cost fields", "time comparison"],
            differentiation: "Separates actual entries from assumptions without promising future profit.",
            priceCents: 1900,
          },
          {
            title: "Freelancer Cash Control Complete Bundle",
            buyerSegment: "Freelancers who want the connected five-step operating workflow",
            outcome: "Use one setup guide and connected weekly routine across all four focused tools.",
            format: "ZIP bundle",
            includedTools: ["all four workbooks", "setup guide", "weekly checklist"],
            differentiation: "A complete operating sequence rather than five renamed copies.",
            priceCents: 2900,
          },
        ],
      }), sequence, agentDefinition.name);
    }
    if (stage === "product_build") {
      const spec = task.payload.liveSpendRequest.parameters.productBuildSpec;
      return sdkResult(workerOutput("Product Builder", {
        productFormat: "Five focused XLSX/CSV products with a shared customer guide and ZIP bundle.",
        productionMethod: "Define the exact blueprint once, then let Pantheon render and validate the customer files locally.",
        qualityChecks: ["Every exact catalogue ID is covered", "Every tracker has practical fields and realistic sample data", "No unsupported financial claims"],
        limitations: ["Buyer conversion and long-term customer usability remain unproven until a measured launch."],
        approvalNeeded: "Independent product and visual quality review.",
        channelFit: "Gumroad-ready local digital download bundle.",
        productBlueprint: {
          schema: "pantheon.product-blueprint.v3",
          packageTitle: "Freelancer Cash-Flow Control Toolkit",
          customerPromise: "A practical weekly workflow for clearer cash, reserve, invoice, and project decisions without personalised advice.",
          setupSteps: ["Download the bundle.", "Open each workbook in Excel.", "Review the sample row.", "Replace samples with your own records.", "Complete the weekly review."],
          disclaimers: ["This is an organisational template, not financial or tax advice."],
          catalogueItems: spec.catalogueItems.map((item, index) => ({
            id: item.id,
            title: item.title,
            purpose: item.offer,
            instructions: ["Review the field guide.", "Replace the sample record.", "Update the tracker during the weekly review."],
            columns: [
              { name: "Record", type: "text", guidance: "A clear name for the entry.", options: [] },
              { name: "Client", type: "text", guidance: "The related client or account.", options: [] },
              { name: "Due Date", type: "date", guidance: "The next relevant date.", options: [] },
              { name: "Amount", type: "currency", guidance: "An editable recorded amount in AUD.", options: [] },
              { name: "Status", type: "status", guidance: "The current workflow status.", options: ["Not started", "In progress", "Complete"] },
            ],
            sampleRows: [[`Example ${index + 1}`, "Sample Client", "31 Jul 2026", "1200", "In progress"]],
            calculations: [],
          })),
        },
      }), sequence, agentDefinition.name);
    }
    if (stage === "storefront_visuals") {
      return sdkResult(workerOutput("Product Builder", {
        productFormat: "Square PNG storefront cover for the finished digital toolkit.",
        assetPlan: ["One restrained, text-free cash-flow workflow cover"],
        productionMethod: "One approved low-quality GPT Image generation call.",
        producedFiles: ["storefront-cover.png"],
        catalogueCoverage: ["The cover represents the full finished toolkit without depicting unsupported features."],
        qualityChecks: ["No readable text", "No people or brands", "No guarantees or invented screenshots"],
        limitations: ["Final title typography must be applied during Gumroad listing setup."],
        approvalNeeded: "Independent visual and product quality review.",
        channelFit: "Square Gumroad product-card cover.",
      }), sequence, agentDefinition.name, [{
        type: "image_generation_call",
        id: `image-${sequence}`,
        status: "completed",
        revised_prompt: "A restrained abstract cash-flow workflow cover with no text, people, logos, or promises.",
        result: ONE_PIXEL_PNG.toString("base64"),
      }]);
    }
    if (stage === "quality_review") {
      return sdkResult(workerOutput("Quality Reviewer", {
        qualityScore: 92,
        riskFindings: ["Editable financial assumptions must remain clearly labelled and no personalised advice claim may be made."],
        missingEvidence: ["Real buyer conversion and support burden remain untested until publication."],
        claimSafety: "safe",
        operatorRecommendation: "Approve the exact package for listing and launch preparation; keep publishing and any spend behind Daniel's later decision.",
      }), sequence, agentDefinition.name);
    }
    if (stage === "conversion_copy") {
      const expectedIncludedFiles = task.payload.liveSpendRequest.parameters
        .pantheonProduction.verifiedLaunchState.expectedIncludedFiles;
      return sdkResult(workerOutput("Copy and Conversion Agent", {
        productTitle: "Freelancer Cash-Flow Control Toolkit",
        headline: "A practical weekly system for seeing cash, reserves, invoices, and runway in one place.",
        description: "Built for freelancers with irregular income, this five-part toolkit turns scattered cash records into a repeatable weekly review. It includes editable customer files, realistic examples, setup guidance, and two previews derived from the real package. It is an organisational resource, not personalised financial or tax advice.",
        callToAction: "Download the toolkit for $29 and run your first weekly cash-control review.",
        includedFiles: expectedIncludedFiles,
        tags: ["freelancer finance", "cash flow spreadsheet", "tax reserve tracker", "runway planner"],
        faq: [
          "Does this provide financial advice? No; it is an editable organisational toolkit.",
          "Can I use it in Excel or Google Sheets? The CSV files can be opened and adapted in either.",
        ],
        messageVariants: [
          "See irregular freelance income more clearly with one weekly cash-control routine. Available for $29.",
          "Bring invoices, reserves, expenses, and runway into one practical review.",
        ],
        claimChecks: ["No income guarantee", "No personalised advice claim", "Every included file exists in the retained package"],
        trackingNote: "Track qualified Gumroad views, checkout starts, paid buyers, refunds, fees, and net cash contribution in AUD.",
      }), sequence, agentDefinition.name);
    }
    if (stage === "distribution_plan") {
      assert.equal(task.payload.liveSpendRequest.maxOutputTokens, 4000);
      return sdkResult(workerOutput("Distribution Agent", {
        audience: "English-speaking freelancers already seeking cash-flow, tax-reserve, or irregular-income workflow help.",
        channelSteps: [
          "Pre-launch: confirm the final files, preview images, and listing claims.",
          "Prepare the reviewed Gumroad product page without publishing it.",
          "Day 1: publish one educational LinkedIn post only after Daniel approves it.",
          "Day 5: share one evidence-led Pinterest pin using a real product preview.",
          "Day 10: publish one follow-up post to answer the strongest observed objection.",
        ],
        evidenceToCapture: ["Qualified Gumroad product views", "Checkout starts", "Paid buyers", "Refunds and fees", "Net cash contribution in AUD"],
        successMetric: "Three independent paid buyers and positive net cash contribution within 14 days or 50 qualified product views.",
        stopRule: "If 50 qualified views produce zero sales, diagnose reach, audience, creative, listing, value, price, checkout, and product quality before revising or stopping.",
        operatorWorkload: "Daniel creates or signs in to Gumroad, completes any private KYC, checks the exact files and listing, then presses Publish; each initial post remains separately approved.",
      }), sequence, agentDefinition.name);
    }
    if (stage === "chief_brief") {
      assert.equal(task.payload.liveSpendRequest.maxOutputTokens, 4000);
      return sdkResult(workerOutput("Chief of Staff", {
        moneyMove: "Mark the exact Freelancer Cash-Flow Control Toolkit package ready to publish, then complete the separate protected Gumroad setup and upload.",
        whyNow: "Three comparable candidates were checked, this opportunity ranked highest, the economics remained viable, and the exact five-product package passed independent review.",
        expectedUpside: "A finished US$29 digital bundle can test real willingness to pay with low fulfilment cost and a clear first-revenue threshold.",
        costRisk: "Pre-publication model and image exposure remains capped; buyer conversion, support burden, refunds, and channel reach remain unproven.",
        decisionNeeded: "Approve, request changes, or stop this exact ready-to-publish package before any Gumroad or public action.",
        successMetric: "Three independent paid buyers and positive net cash contribution within 14 days or 50 qualified views.",
        stopRule: "Do not scale; investigate the full commercial funnel if 50 qualified views produce zero sales.",
        specialistNeeded: false,
        specialistWorker: "",
        specialistObjective: "",
        specialistExpectedOutput: "",
        specialistMode: "",
        specialistContextClasses: [],
        specialistReason: "Every required pre-publication specialist has completed the fixed proof journey.",
      }), sequence, agentDefinition.name);
    }
    throw new Error(`Unexpected full-journey stage: ${stage}`);
  });

  try {
    const protection = prepareRetentionPolicyDecision(runtime.db);
    assert.equal(protection.prepared, true);
    const protectionApproval = get(runtime.db, "SELECT * FROM approvals WHERE id = ?", [protection.state.approvalId]);
    decideApproval(runtime.db, protectionApproval.id, "approved", "Activate the exact isolated data protection plan.", {
      expectedScopeHash: protectionApproval.scope_hash,
    });
    const protectionRun = await runOnce(runtime.db, { taskId: protectionApproval.task_id });
    assert.equal(protectionRun.status, "completed");

    const writesBeforeRetiredStart = get(
      runtime.db,
      "SELECT total_changes() AS count",
    ).count;
    assert.throws(
      () => startOpportunityRound(runtime.db, {
        prompt: "Research broad lawful online opportunities and build the strongest currently executable digital-product range.",
        source: "historical-full-journey-test",
        journeyId: "historical-broad-journey",
        model: CONFIG.lunaModel,
        modelLocked: true,
      }),
      (error) => (
        error.statusCode === 410
        && error.code === "legacy_commercial_path_retired"
        && error.details?.path === "pantheon_opportunity_round_start"
        && error.details?.replacement
          === "bounded_preventure_research_authority_pending"
      ),
    );
    assert.equal(
      get(runtime.db, "SELECT total_changes() AS count").count,
      writesBeforeRetiredStart,
      "The retired broad-journey path must fail before any database write.",
    );
    assert.equal(calls.length, 0, "The model adapter must not be called.");
    assert.equal(
      productFactoryCalls,
      0,
      "The product factory must not be called.",
    );
    assert.equal(
      get(
        runtime.db,
        `SELECT COUNT(*) AS count
         FROM agent_runs
         WHERE status = 'completed'`,
      ).count,
      0,
    );
    assert.equal(
      get(
        runtime.db,
        `SELECT COUNT(*) AS count
         FROM deliverables`,
      ).count,
      0,
    );
    assert.equal(
      get(
        runtime.db,
        `SELECT COUNT(*) AS count
         FROM catalogue_plans`,
      ).count,
      0,
    );
  } finally {
    closeRuntime(runtime);
    __setAgentRuntimeSdkRunnerForTests(null);
    __setDigitalProductFactoryForTests(null);
    for (const [name, value] of Object.entries({
      OPENAI_API_KEY: previous.key,
      PANTHEON_ENABLE_LIVE_MODELS: previous.liveModels,
      PANTHEON_ENABLE_LIVE_RESEARCH: previous.liveResearch,
      PANTHEON_ENABLE_IMAGE_GENERATION: previous.imageGeneration,
      PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER: previous.disabledAdapter,
      PANTHEON_DISABLE_OPENAI_AGENTS_SDK: previous.disabledSdk,
      PANTHEON_API_CREDIT_AUD_PER_USD: previous.rate,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
