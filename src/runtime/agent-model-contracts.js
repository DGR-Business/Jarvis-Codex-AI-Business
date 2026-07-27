const crypto = require("node:crypto");
const { all, fromJson, get } = require("../db");
const { contextForModel } = require("./agent-context");
const { approvedDeliverableReviewTargets } = require("./deliverable-review-bindings");

const MODEL_PACKET_SCHEMA = "jarvis_worker_model_packet_v1";
const WORKER_OUTPUT_SCHEMA = "jarvis_worker_output_v1";

const FIELD_TYPES = {
  string: { json: { type: "string" } },
  number: { json: { type: "number" } },
  boolean: { json: { type: "boolean" } },
  stringArray: { json: { type: "array", items: { type: "string" }, maxItems: 5 } },
  opportunityArray: {
    json: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          businessModel: { type: "string" },
          buyer: { type: "string" },
          problem: { type: "string" },
          offerDirection: { type: "string" },
          geography: { type: "string" },
          language: { type: "string" },
          channel: { type: "string" },
          demandEvidence: { type: "array", items: { type: "string" }, maxItems: 4 },
          competitionEvidence: { type: "array", items: { type: "string" }, maxItems: 4 },
          economicsHypothesis: { type: "string" },
          smallestValidation: { type: "string" },
          risks: { type: "array", items: { type: "string" }, maxItems: 3 },
          demandScore: { type: "number" },
          supplyGapScore: { type: "number" },
          economicsScore: { type: "number" },
          channelFitScore: { type: "number" },
          executionFitScore: { type: "number" },
          riskScore: { type: "number" },
          score: { type: "number" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: [
          "title",
          "businessModel",
          "buyer",
          "problem",
          "offerDirection",
          "geography",
          "language",
          "channel",
          "demandEvidence",
          "competitionEvidence",
          "economicsHypothesis",
          "smallestValidation",
          "risks",
          "demandScore",
          "supplyGapScore",
          "economicsScore",
          "channelFitScore",
          "executionFitScore",
          "riskScore",
          "score",
          "confidence",
        ],
      },
    },
  },
  catalogueArray: {
    json: {
      type: "array",
      minItems: 3,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          buyerSegment: { type: "string" },
          outcome: { type: "string" },
          format: { type: "string" },
          includedTools: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
          differentiation: { type: "string" },
          priceCents: { type: "number" },
        },
        required: [
          "title",
          "buyerSegment",
          "outcome",
          "format",
          "includedTools",
          "differentiation",
          "priceCents",
        ],
      },
    },
  },
  productBlueprint: {
    json: {
      type: "object",
      additionalProperties: false,
      properties: {
        schema: { type: "string", enum: ["pantheon.product-blueprint.v3"] },
        packageTitle: { type: "string" },
        customerPromise: { type: "string" },
        setupSteps: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 6 },
        disclaimers: { type: "array", items: { type: "string" }, maxItems: 3 },
        catalogueItems: {
          type: "array",
          minItems: 3,
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              purpose: { type: "string" },
              instructions: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
              columns: {
                type: "array",
                minItems: 4,
                maxItems: 12,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    type: {
                      type: "string",
                      enum: ["text", "date", "currency", "number", "percent", "status", "boolean"],
                    },
                    guidance: { type: "string" },
                    options: {
                      type: "array",
                      maxItems: 12,
                      items: { type: "string" },
                      description: "For status fields, list every allowed dropdown value. Use [] for every other field type.",
                    },
                  },
                  required: ["name", "type", "guidance", "options"],
                },
              },
              sampleRows: {
                type: "array",
                minItems: 1,
                maxItems: 3,
                items: {
                  type: "array",
                  minItems: 4,
                  maxItems: 12,
                  items: { type: "string" },
                },
              },
              calculations: {
                type: "array",
                maxItems: 6,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    target: {
                      type: "string",
                      description: "Exact copy of one column.name in this same catalogue item.",
                    },
                    operation: {
                      type: "string",
                      enum: ["multiply", "sum", "subtract", "percent_of"],
                    },
                    inputs: {
                      type: "array",
                      minItems: 2,
                      maxItems: 6,
                      items: {
                        type: "string",
                        description: "Exact copy of one input column.name in this same catalogue item.",
                      },
                      description: "For percent_of, use exactly [numerator column name, denominator column name].",
                    },
                  },
                  required: ["target", "operation", "inputs"],
                },
              },
            },
            required: ["id", "title", "purpose", "instructions", "columns", "sampleRows", "calculations"],
          },
        },
      },
      required: ["schema", "packageTitle", "customerPromise", "setupSteps", "disclaimers", "catalogueItems"],
    },
  },
};

const WORKER_CONTRACTS = {
  chief_of_staff: {
    label: "Chief of Staff",
    focusKeys: ["decision", "commercialPurpose", "expectedMetric"],
    fields: {
      moneyMove: "string",
      whyNow: "string",
      expectedUpside: "string",
      costRisk: "string",
      decisionNeeded: "string",
      successMetric: "string",
      stopRule: "string",
      specialistNeeded: "boolean",
      specialistWorker: "string",
      specialistObjective: "string",
      specialistExpectedOutput: "string",
      specialistMode: "string",
      specialistContextClasses: "stringArray",
      specialistReason: "string",
    },
  },
  opportunity_scout: {
    label: "Opportunity Scout",
    focusKeys: ["businessDirection", "targetMarket", "channel", "subject"],
    fields: {
      opportunities: "opportunityArray",
      marketScope: "string",
      evidenceGaps: "stringArray",
      exclusionNotes: "stringArray",
      recommendedNextTest: "string",
    },
  },
  demand_validator: {
    label: "Demand Validator",
    focusKeys: ["buyer", "problem", "offer", "channel", "subject", "evidenceStandard"],
    fields: {
      demandVerdict: "string",
      sourceSummary: "stringArray",
      counterevidence: "stringArray",
      assumptions: "stringArray",
      priceChannelHypothesis: "string",
      smallestTest: "string",
      successMetric: "string",
      stopRule: "string",
    },
  },
  offer_architect: {
    label: "Offer Architect",
    focusKeys: ["buyer", "problem", "channel", "subject"],
    fields: {
      buyer: "string",
      problem: "string",
      offer: "string",
      price: "string",
      channel: "string",
      promise: "string",
      objections: "stringArray",
      testHypothesis: "string",
      successMetric: "string",
      stopRule: "string",
      catalogueItems: "catalogueArray",
    },
  },
  product_builder: {
    label: "Product Builder",
    focusKeys: ["offer", "productFormat", "qualityBar", "channelRequirements", "subject"],
    fields: {
      productFormat: "string",
      assetPlan: "stringArray",
      productionMethod: "string",
      producedFiles: "stringArray",
      catalogueCoverage: "stringArray",
      qualityChecks: "stringArray",
      limitations: "stringArray",
      approvalNeeded: "string",
      channelFit: "string",
    },
  },
  copy_conversion_agent: {
    label: "Copy and Conversion Agent",
    focusKeys: ["buyer", "problem", "offer", "channel", "desiredAction"],
    fields: {
      productTitle: "string",
      headline: "string",
      description: "string",
      callToAction: "string",
      includedFiles: "stringArray",
      tags: "stringArray",
      faq: "stringArray",
      messageVariants: "stringArray",
      claimChecks: "stringArray",
      trackingNote: "string",
    },
  },
  distribution_operator: {
    label: "Distribution Agent",
    focusKeys: ["offer", "channel", "message", "trackingPlan"],
    fields: {
      audience: "string",
      channelSteps: "stringArray",
      evidenceToCapture: "stringArray",
      successMetric: "string",
      stopRule: "string",
      operatorWorkload: "string",
    },
  },
  finance_analyst: {
    label: "Finance and Unit Economics Agent",
    focusKeys: ["price", "costAssumptions", "channel", "timeRequired"],
    fields: {
      price: "string",
      marginLogic: "string",
      breakEven: "string",
      costCap: "string",
      financialRisk: "string",
      decisionSignal: "string",
    },
  },
  customer_voice_agent: {
    label: "Customer Voice Agent",
    focusKeys: ["feedback", "resultContext", "currentOffer"],
    fields: {
      buyerLanguage: "stringArray",
      objections: "stringArray",
      requestedImprovements: "stringArray",
      recommendedRevision: "string",
      evidenceLimits: "string",
    },
  },
  growth_analyst: {
    label: "Growth Analyst",
    focusKeys: ["hypothesis", "expectedMetric", "actualResult", "feedback"],
    fields: {
      verdict: "string",
      expectedMetric: "string",
      actualResult: "string",
      learning: "string",
      improvement: "string",
      nextExperiment: "string",
    },
  },
  quality_reviewer: {
    label: "Quality Reviewer",
    focusKeys: ["claims", "riskContext", "qualityBar", "subject"],
    fields: {
      qualityScore: "number",
      riskFindings: "stringArray",
      missingEvidence: "stringArray",
      claimSafety: "string",
      operatorRecommendation: "string",
    },
  },
};

const PRODUCT_BUILDER_VISUAL_FIELDS = Object.freeze({
  productFormat: "string",
  productionMethod: "string",
  limitations: "stringArray",
  approvalNeeded: "string",
  channelFit: "string",
});

const PRODUCT_BUILDER_FILE_FIELDS = {
  productFormat: "string",
  productionMethod: "string",
  qualityChecks: "stringArray",
  limitations: "stringArray",
  approvalNeeded: "string",
  channelFit: "string",
  productBlueprint: "productBlueprint",
};

function compactText(value, max = 1200) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function list(value, max = 5) {
  return Array.isArray(value) ? value.filter(Boolean).map((item) => compactText(item, 500)).slice(0, max) : [];
}

function parsed(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  return fromJson(value, fallback);
}

function contractFor(workerId) {
  return WORKER_CONTRACTS[workerId] || WORKER_CONTRACTS.chief_of_staff;
}

function jsonField(type) {
  return { ...(FIELD_TYPES[type] || FIELD_TYPES.string).json };
}

function zodField(z, type, options = {}) {
  if (type === "number") return z.number();
  if (type === "boolean") return z.boolean();
  if (type === "stringArray") return z.array(z.string()).max(5);
  if (type === "opportunityArray") {
    return z.array(z.object({
      title: z.string(),
      businessModel: z.string(),
      buyer: z.string(),
      problem: z.string(),
      offerDirection: z.string(),
      geography: z.string(),
      language: z.string(),
      channel: z.string(),
      demandEvidence: z.array(z.string()).max(4),
      competitionEvidence: z.array(z.string()).max(4),
      economicsHypothesis: z.string(),
      smallestValidation: z.string(),
      risks: z.array(z.string()).max(3),
      demandScore: z.number(),
      supplyGapScore: z.number(),
      economicsScore: z.number(),
      channelFitScore: z.number(),
      executionFitScore: z.number(),
      riskScore: z.number(),
      score: z.number(),
      confidence: z.enum(["low", "medium", "high"]),
    }).strict()).min(3).max(5);
  }
  if (type === "catalogueArray") {
    return z.array(z.object({
      title: z.string(),
      buyerSegment: z.string(),
      outcome: z.string(),
      format: z.string(),
      includedTools: z.array(z.string()).min(1).max(5),
      differentiation: z.string(),
      priceCents: z.number(),
    }).strict()).min(3).max(12);
  }
  if (type === "productBlueprint") {
    const approvedIds = Array.isArray(options.productBuildSpec?.catalogueItems)
      ? options.productBuildSpec.catalogueItems.map((item) => String(item.id || "")).filter(Boolean)
      : [];
    const column = z.object({
      name: z.string(),
      type: z.enum(["text", "date", "currency", "number", "percent", "status", "boolean"]),
      guidance: z.string(),
      options: z.array(z.string()).max(12)
        .describe("For status fields, list every allowed dropdown value. Use [] for every other field type."),
    }).strict();
    const calculation = z.object({
      target: z.string().describe("Exact copy of one column.name in this same catalogue item."),
      operation: z.enum(["multiply", "sum", "subtract", "percent_of"]),
      inputs: z.array(
        z.string().describe("Exact copy of one input column.name in this same catalogue item."),
      ).min(2).max(6).describe("For percent_of, use exactly [numerator column name, denominator column name]."),
    }).strict();
    const item = z.object({
      id: approvedIds.length ? z.enum(approvedIds) : z.string(),
      title: z.string(),
      purpose: z.string(),
      instructions: z.array(z.string()).min(2).max(5),
      columns: z.array(column).min(4).max(12),
      sampleRows: z.array(z.array(z.string()).min(4).max(12)).min(1).max(3),
      calculations: z.array(calculation).max(6),
    }).strict();
    const itemList = z.array(item);
    return z.object({
      schema: z.literal("pantheon.product-blueprint.v3"),
      packageTitle: z.string(),
      customerPromise: z.string(),
      setupSteps: z.array(z.string()).min(3).max(6),
      disclaimers: z.array(z.string()).max(3),
      catalogueItems: approvedIds.length
        ? itemList.min(approvedIds.length).max(approvedIds.length)
        : itemList.min(3).max(6),
    }).strict();
  }
  return z.string();
}

function workerOutputJsonSchema(workerId) {
  const contract = contractFor(workerId);
  return outputJsonSchemaForFields(contract.fields);
}

function outputJsonSchemaForFields(fields) {
  const workProperties = Object.fromEntries(
    Object.entries(fields).map(([name, type]) => [name, jsonField(type)]),
  );
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      recommendation: { type: "string" },
      evidence: { type: "array", items: { type: "string" }, maxItems: 5 },
      risks: { type: "array", items: { type: "string" }, maxItems: 4 },
      nextAction: { type: "string" },
      operatorDecision: { type: "string", enum: ["approve", "revise", "deny", "needs_evidence"] },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      work: {
        type: "object",
        additionalProperties: false,
        properties: workProperties,
        required: Object.keys(workProperties),
      },
    },
    required: ["summary", "recommendation", "evidence", "risks", "nextAction", "operatorDecision", "confidence", "work"],
  };
}

function workerOutputZodSchema(z, workerId) {
  const contract = contractFor(workerId);
  return outputZodSchemaForFields(z, contract.fields);
}

function outputZodSchemaForFields(z, fields, options = {}) {
  const work = Object.fromEntries(
    Object.entries(fields).map(([name, type]) => [name, zodField(z, type, options)]),
  );
  return z.object({
    summary: z.string(),
    recommendation: z.string(),
    evidence: z.array(z.string()).max(5),
    risks: z.array(z.string()).max(4),
    nextAction: z.string(),
    operatorDecision: z.enum(["approve", "revise", "deny", "needs_evidence"]),
    confidence: z.enum(["low", "medium", "high"]),
    work: z.object(work).strict(),
  }).strict();
}

function productBuilderFileOutputJsonSchema(productBuildSpec = null) {
  const schema = structuredClone(outputJsonSchemaForFields(PRODUCT_BUILDER_FILE_FIELDS));
  const approvedIds = Array.isArray(productBuildSpec?.catalogueItems)
    ? productBuildSpec.catalogueItems.map((item) => String(item.id || "")).filter(Boolean)
    : [];
  if (approvedIds.length) {
    const itemList = schema.properties.work.properties.productBlueprint.properties.catalogueItems;
    itemList.minItems = approvedIds.length;
    itemList.maxItems = approvedIds.length;
    itemList.items.properties.id.enum = approvedIds;
  }
  return schema;
}

function productBuilderFileOutputZodSchema(z, productBuildSpec = null) {
  return outputZodSchemaForFields(z, PRODUCT_BUILDER_FILE_FIELDS, { productBuildSpec });
}

function productBuilderVisualOutputJsonSchema() {
  return outputJsonSchemaForFields(PRODUCT_BUILDER_VISUAL_FIELDS);
}

function productBuilderVisualOutputZodSchema(z) {
  return outputZodSchemaForFields(z, PRODUCT_BUILDER_VISUAL_FIELDS);
}

function demandValidatorPilotOutputSchema(z) {
  return z.object({
    summary: z.string(),
    moneyMove: z.string(),
    evidence: z.array(z.string()).max(2),
    counterevidence: z.array(z.string()).max(2),
    assumptions: z.array(z.string()).max(2),
    priceChannelHypothesis: z.string(),
    smallestTest: z.string(),
    metric: z.string(),
    killRule: z.string(),
    risks: z.array(z.string()).max(2),
    nextAction: z.string(),
    operatorDecision: z.enum(["approve", "revise", "deny", "needs_evidence"]),
    confidence: z.enum(["low", "medium", "high"]),
  }).strict();
}

function outputSchemaName(workerId) {
  return `jarvis_${String(workerId || "worker").replace(/[^a-z0-9_]/gi, "_")}_result`;
}

function safeTaskResult(row) {
  const result = parsed(row.result, {});
  const output = result.output && typeof result.output === "object" ? result.output : result;
  return {
    title: compactText(row.title, 180),
    worker: row.agent || null,
    status: row.status,
    summary: compactText(output.summary || output.note || result.note, 600),
    evidence: list(output.evidence, 3),
    risks: list(output.risks, 3),
    nextAction: compactText(output.nextAction || output.next_action, 400),
  };
}

function focusPayload(payload, keys) {
  const focus = {};
  for (const key of keys) {
    const value = payload[key] ?? payload[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
    if (value === undefined || value === null || value === "") continue;
    focus[key] = Array.isArray(value) ? list(value) : compactText(value, 800);
  }
  return focus;
}

function assignmentBrief(payload) {
  const brief = payload.workBrief;
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) return null;
  return {
    objective: compactText(brief.objective, 800),
    deliverable: compactText(brief.deliverable, 800),
    assetPrompt: compactText(brief.assetPrompt, 12000),
    requiredCorrections: list(brief.requiredCorrections, 6),
    constraints: list(brief.constraints, 6),
    acceptanceCriteria: list(brief.acceptanceCriteria, 6),
  };
}

function approvedAssetDescriptors(db, task, payload, workerId) {
  if (!new Set(["product_builder", "quality_reviewer"]).has(workerId)) return [];
  const supplied = Array.isArray(payload.approvedAssets) ? payload.approvedAssets : [];
  const approvedIds = [
    ...(Array.isArray(payload.liveSpendRequest?.parameters?.approvedAssetIds) ? payload.liveSpendRequest.parameters.approvedAssetIds : []),
    ...(Array.isArray(payload.liveSpendRequest?.toolArguments?.visual_asset_review?.assetIds) ? payload.liveSpendRequest.toolArguments.visual_asset_review.assetIds : []),
  ].filter(Boolean).map(String);
  const suppliedById = new Map(supplied.filter((asset) => asset?.id).map((asset) => [String(asset.id), asset]));
  const assets = [...new Set([...suppliedById.keys(), ...approvedIds])].slice(0, 4).map((id) => {
    const suppliedAsset = suppliedById.get(id);
    if (suppliedAsset) return suppliedAsset;
    const deliverable = get(
      db,
      "SELECT id, human_name, format FROM deliverables WHERE id = ? AND workflow_id = ?",
      [id, task.workflow_id],
    );
    return deliverable ? {
      id: deliverable.id,
      name: deliverable.human_name,
      mediaType: deliverable.format,
      purpose: "Approved visual input for this quality review.",
    } : { id, purpose: "Approved visual input awaiting runtime validation." };
  });
  return assets.map((asset) => ({
    id: compactText(asset.id, 160),
    name: compactText(asset.name || asset.humanName, 240),
    mediaType: compactText(asset.mediaType || asset.mimeType, 100),
    purpose: compactText(asset.purpose, 400),
  }));
}

function buildWorkerModelPacket(db, task, agentDefinition) {
  const workerId = agentDefinition.id;
  const contract = contractFor(workerId);
  const payload = parsed(task.payload, {});
  const requestedAt = Number.isFinite(Date.parse(payload.requestedAt))
    ? new Date(payload.requestedAt).toISOString()
    : null;
  const workflow = get(db, "SELECT * FROM workflows WHERE id = ?", [task.workflow_id]);
  const command = get(db, "SELECT * FROM commands WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1", [task.workflow_id]);
  const scorecard = get(db, "SELECT * FROM venture_scorecards WHERE workflow_id = ?", [task.workflow_id]);
  const ventureId = task.venture_id || workflow?.venture_id || null;
  const venture = ventureId ? get(db, "SELECT * FROM ventures WHERE id = ?", [ventureId]) : null;
  const currentTruthOnly = payload.liveSpendRequest?.parameters?.pantheonProduction?.currentTruthOnly === true;
  const recentWork = currentTruthOnly ? [] : all(
    db,
    `SELECT title, agent, status, result
     FROM tasks
     WHERE workflow_id = ? AND id <> ? AND kind <> 'live_ai_worker_execution'
       AND status = 'completed'
       AND (? IS NULL OR updated_at <= ?)
     ORDER BY updated_at DESC LIMIT 4`,
    [task.workflow_id, task.id, requestedAt, requestedAt],
  ).map(safeTaskResult);

  const packet = {
    schema: MODEL_PACKET_SCHEMA,
    worker: {
      id: workerId,
      name: agentDefinition.name,
      role: agentDefinition.role,
      assignment: compactText(task.title, 300),
      expectedOutput: compactText(payload.expectedOutput || agentDefinition.outputContract?.required?.join(", "), 600),
    },
    date: new Date().toISOString().slice(0, 10),
    venture: venture ? {
      id: venture.id,
      name: compactText(venture.name, 240),
      stage: venture.stage,
      status: venture.status,
    } : null,
    workflow: workflow ? {
      id: workflow.id,
      title: compactText(workflow.title, 300),
      status: workflow.status,
      currentStep: compactText(workflow.current_step, 300),
    } : null,
    operatorInstruction: command ? {
      instruction: compactText(command.raw_text, 1800),
      summary: compactText(command.summary, 600),
    } : null,
    commercialScore: scorecard ? {
      total: Number(scorecard.total_score || 0),
      verdict: compactText(scorecard.verdict, 240),
      confidence: compactText(scorecard.confidence, 160),
      recommendation: compactText(scorecard.recommendation, 700),
      risks: list(parsed(scorecard.risks, []), 4),
      nextActions: list(parsed(scorecard.next_actions, []), 4),
    } : null,
    focus: focusPayload(payload, contract.focusKeys),
    assignmentBrief: assignmentBrief(payload),
    suppliedEvidenceFixture: payload.pilotFixture || null,
    approvedAssetInputs: approvedAssetDescriptors(db, task, payload, workerId),
    approvedProductBuildSpec: workerId === "product_builder"
      ? parsed(payload.liveSpendRequest?.parameters?.productBuildSpec, null)
      : null,
    qualityReviewTargets: approvedDeliverableReviewTargets(db, task, payload, workerId),
    qualityReviewPacket: workerId === "quality_reviewer"
      ? parsed(payload.liveSpendRequest?.parameters?.qualityReviewPacket, null)
      : null,
    relevantCompletedWork: recentWork,
    evidenceRules: {
      liveEvidenceOnlyWhenSupplied: true,
      distinguishFactsFromAssumptions: true,
      externalActionsAllowed: false,
    },
  };
  if (payload.contextSnapshot) {
    packet.ventureContext = contextForModel(payload.contextSnapshot);
  }
  packet.packetHash = crypto.createHash("sha256").update(JSON.stringify(packet)).digest("hex");
  return packet;
}

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || "Not stated.";
}

function normalizeWorkerOutput(workerId, raw, agentName = null) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.heading || raw.businessDecision || raw.moneyMove) {
    return {
      ...raw,
      roleOutput: raw.work || null,
      schema: WORKER_OUTPUT_SCHEMA,
    };
  }

  const work = raw.work || {};
  const topOpportunity = Array.isArray(work.opportunities) ? work.opportunities[0] || {} : {};
  const evidence = list(raw.evidence, 5);
  const risks = list(raw.risks, 4);
  const counterevidence = list(work.counterevidence || work.evidenceGaps || work.missingEvidence, 5);
  const assumptions = list(work.assumptions, 5);
  const moneyMove = firstText(
    work.moneyMove,
    work.recommendedNextTest,
    work.smallestTest,
    work.testHypothesis,
    work.nextExperiment,
    topOpportunity.smallestValidation,
    raw.recommendation,
  );
  const metric = firstText(work.successMetric, work.expectedMetric, work.trackingNote);
  const stopRule = firstText(work.stopRule, work.killRule, "Stop or revise when the declared evidence threshold is not met.");
  const buyer = firstText(work.buyer, work.audience, topOpportunity.buyer);
  const problem = firstText(work.problem, work.objections?.[0], topOpportunity.problem);
  const offer = firstText(work.offer, work.productFormat, topOpportunity.offerDirection, topOpportunity.title, raw.recommendation);
  const channel = firstText(work.channel, work.channelFit, topOpportunity.channel);
  const actualResult = firstText(work.actualResult, "No real-world result was supplied to this run.");
  const learning = firstText(work.learning, "Use the next measured result to confirm or revise this recommendation.");
  const improvement = firstText(work.improvement, work.recommendedRevision, raw.nextAction);

  return {
    schema: WORKER_OUTPUT_SCHEMA,
    heading: `${agentName || contractFor(workerId).label} recommendation`,
    summary: firstText(raw.summary),
    moneyMove,
    evidence,
    counterevidence,
    priceChannelHypothesis: firstText(work.priceChannelHypothesis, work.price, work.channelFit, topOpportunity.economicsHypothesis),
    smallestTest: firstText(work.smallestTest, work.recommendedNextTest, work.testHypothesis, work.nextExperiment, topOpportunity.smallestValidation, raw.nextAction),
    metric,
    killRule: stopRule,
    risks,
    nextAction: firstText(raw.nextAction),
    operatorDecision: raw.operatorDecision || "needs_evidence",
    confidence: raw.confidence || "low",
    expectedUpside: firstText(work.expectedUpside, work.decisionSignal, raw.recommendation),
    costRisk: firstText(work.costRisk, work.financialRisk, work.costCap),
    assumptions,
    roleOutput: work,
    recommendation: firstText(raw.recommendation),
    businessDecision: {
      buyer,
      problem,
      offer,
      channel,
      moneyMove,
      evidenceSummary: evidence.join(" ") || "No supporting evidence was returned.",
      risk: risks.length ? "medium" : "low",
      nextAction: firstText(raw.nextAction),
      successMetric: metric,
      killCriteria: stopRule,
      approvalRequired: raw.operatorDecision !== "deny",
      externalActionsAllowed: false,
      hardStops: ["publishing", "customer contact", "account actions", "legal decisions", "money movement"],
      continuousImprovement: {
        hypothesis: firstText(work.testHypothesis, work.hypothesis, raw.recommendation),
        smallestUsefulAction: firstText(work.smallestTest, work.recommendedNextTest, work.nextExperiment, raw.nextAction),
        expectedMetric: metric,
        actualResult,
        learning,
        improvement,
      },
    },
  };
}

module.exports = {
  MODEL_PACKET_SCHEMA,
  WORKER_CONTRACTS,
  WORKER_OUTPUT_SCHEMA,
  buildWorkerModelPacket,
  demandValidatorPilotOutputSchema,
  normalizeWorkerOutput,
  outputSchemaName,
  productBuilderFileOutputJsonSchema,
  productBuilderFileOutputZodSchema,
  productBuilderVisualOutputJsonSchema,
  productBuilderVisualOutputZodSchema,
  workerOutputJsonSchema,
  workerOutputZodSchema,
};
