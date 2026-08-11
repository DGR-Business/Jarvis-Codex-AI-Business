const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, run, toJson } = require("../db");
const { getWorkflowScorecard } = require("./scorecard");

function safeFileName(value) {
  return String(value || "Approval Pack")
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function slugForId(value) {
  return String(value || "approval-pack")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "approval-pack";
}

function parseRows(rows, fields = ["metadata", "payload", "result"]) {
  return rows.map((row) => {
    const copy = { ...row };
    for (const field of fields) {
      if (field in copy) copy[field] = fromJson(copy[field]);
    }
    return copy;
  });
}

function readExcerpt(filePath) {
  if (!filePath) return "";
  const absolute = path.resolve(CONFIG.rootDir, filePath);
  const relative = path.relative(path.resolve(CONFIG.rootDir), absolute);
  const extension = path.extname(absolute).toLowerCase();
  if (
    relative.startsWith("..")
    || path.isAbsolute(relative)
    || !new Set([".csv", ".html", ".json", ".md", ".txt"]).has(extension)
    || !fs.existsSync(absolute)
    || !fs.statSync(absolute).isFile()
  ) return "";
  const handle = fs.openSync(absolute, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").replace(/\s+/g, " ").trim().slice(0, 1800);
  } finally {
    fs.closeSync(handle);
  }
}

function approvalPackName(workflow, deliverables) {
  const decisionPack = deliverables.find((item) => /Decision Pack/i.test(item.title || item.human_name));
  if (decisionPack) {
    return decisionPack.human_name.replace(/Decision Pack/i, "Decision Brief").replace(/\s*\(for approval\)\s*/i, "");
  }
  return `${workflow.title} Decision Brief`;
}

function compact(value, max = 800) {
  const text = String(value || "")
    .replace(/\bdemand_validator\b/gi, "Demand Validator")
    .replace(/\bchief_of_staff\b/gi, "Chief of Staff")
    .replace(/\bquality_reviewer\b/gi, "Quality Reviewer")
    .replace(/\bproduct_builder\b/gi, "Product Builder")
    .replace(/\bdry[- ]run\b/gi, "protected practice")
    .replace(/\bapproval pack\b/gi, "decision brief")
    .replace(/\boperator pack\b/gi, "decision brief")
    .replace(/\blive research\/tool integration\b/gi, "current market research")
    .replace(/\bpaid model\/tool execution\b/gi, "paid AI work")
    .replace(/\bmodel call\b/gi, "AI analysis")
    .replace(/\bprocess proof\b/gi, "system readiness evidence")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function humanChannel(value) {
  const channel = compact(value, 300);
  if (!channel || /agent.?sdk|fixture|controlled.?test|pilot/i.test(channel)) return "Not selected yet";
  return channel.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function items(value, max = 6) {
  return Array.isArray(value) ? value.filter(Boolean).map((item) => compact(item, 500)).slice(0, max) : [];
}

function canonicalOperatorDeliverables(deliverables) {
  const newest = [...deliverables]
    .filter((item) => item.format !== "pdf")
    .sort((left, right) => {
      const leftTime = Date.parse(left.updated_at || left.created_at || "") || 0;
      const rightTime = Date.parse(right.updated_at || right.created_at || "") || 0;
      return rightTime - leftTime;
    });
  const distinct = new Map();
  for (const item of newest) {
    const key = `${item.human_name || item.title || item.id}:${item.format || ""}`.toLowerCase();
    if (!distinct.has(key)) distinct.set(key, item);
  }
  const formatPriority = new Map([
    ["application/zip", 0],
    ["text/markdown", 1],
    ["image/png", 2],
    ["image/jpeg", 2],
    ["application/json", 3],
  ]);
  return [...distinct.values()].sort((left, right) => {
    const leftPriority = formatPriority.get(left.format) ?? 4;
    const rightPriority = formatPriority.get(right.format) ?? 4;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    const leftTime = Date.parse(left.updated_at || left.created_at || "") || 0;
    const rightTime = Date.parse(right.updated_at || right.created_at || "") || 0;
    return rightTime - leftTime;
  });
}

function taskOutput(task) {
  const result = task.result || {};
  return result.output && typeof result.output === "object" ? result.output : result;
}

function decisionTask(tasks) {
  const newestFirst = [...tasks].sort((left, right) => {
    const leftTime = Date.parse(left.completed_at || left.updated_at || left.created_at || "") || 0;
    const rightTime = Date.parse(right.completed_at || right.updated_at || right.created_at || "") || 0;
    return rightTime - leftTime;
  });
  return newestFirst.find((task) => task.kind === "live_ai_worker_execution" && task.status === "completed")
    || newestFirst.find((task) => task.status === "completed" && taskOutput(task).summary)
    || newestFirst.at(-1)
    || null;
}

function humanWorker(value) {
  const labels = {
    chief_of_staff: "Chief of Staff",
    opportunity_scout: "Opportunity Scout",
    demand_validator: "Demand Validator",
    offer_architect: "Offer Architect",
    product_builder: "Product Builder",
    copy_conversion_agent: "Copy and Conversion Agent",
    distribution_operator: "Distribution Agent",
    finance_analyst: "Finance and Unit Economics Agent",
    customer_voice_agent: "Customer Voice Agent",
    growth_analyst: "Growth Analyst",
    quality_reviewer: "Quality Reviewer",
    "quality-checker": "Quality Reviewer",
    researcher: "Demand Validator",
  };
  return labels[value] || compact(String(value || "AI Team").replaceAll("_", " "), 80).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function packMode(tasks) {
  const liveOutput = tasks.some((task) => {
    const output = taskOutput(task);
    return output.modelGenerated === true || output.liveEvidence === true || task.kind === "live_market_research" && task.status === "completed";
  });
  return liveOutput
    ? "This brief includes approved live AI analysis or current external evidence. Publishing, customer contact, account changes, and money movement remain blocked."
    : "Prepared locally for your review. No publishing, customer contact, account changes, or money movement occurred.";
}

function transformPresentationStrings(value, transform) {
  if (typeof transform !== "function") return value;
  if (typeof value === "string") return transform(value);
  if (Array.isArray(value)) return value.map((item) => transformPresentationStrings(item, transform));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, transformPresentationStrings(item, transform)]),
    );
  }
  return value;
}

function buildOperatorPackPayload({
  approvalPackId,
  humanName,
  generatedAt,
  workflow,
  command,
  scorecard,
  tasks,
  deliverables,
  costs = [],
  authoritativeExposureCents = null,
  decisionOverride = {},
  commercialCaseOverride = {},
  actionsOverride = null,
  workTaskIdsOverride = null,
  presentationTransform = null,
}) {
  const leadTask = decisionTask(tasks);
  const output = leadTask ? taskOutput(leadTask) : {};
  const business = output.businessDecision || output.business_decision || {};
  const recommendation = compact(output.summary || scorecard?.recommendation || "Review the evidence before choosing the next commercial step.", 1200);
  const moneyMove = compact(output.details?.["Money move"] || output.moneyMove || business.moneyMove || output.nextAction || scorecard?.next_actions?.[0] || "Gather the smallest missing piece of buyer evidence.", 700);
  const evidence = items(output.pilotRecommendation?.evidence || output.evidence, 6);
  const counterevidence = items(output.pilotRecommendation?.counterevidence || output.counterevidence, 5);
  const assumptions = items(output.pilotRecommendation?.assumptions || output.assumptions, 5);
  const scoreRisks = items(scorecard?.risks, 5);
  const risks = [...new Set([...items(output.risks, 5), ...scoreRisks])].slice(0, 6);
  const nextActions = [...new Set([
    compact(output.nextAction || business.nextAction, 500),
    ...items(scorecard?.next_actions, 4),
  ].filter(Boolean))].slice(0, 5);
  const totalEstimatedCents = costs
    .filter((cost) => ["reserved", "incurred_estimate", "unknown"].includes(cost.status))
    .reduce((sum, cost) => sum + Number(cost.amount_cents || 0), 0);
  const totalReconciledCents = costs
    .filter((cost) => cost.status === "reconciled")
    .reduce((sum, cost) => sum + Number(cost.amount_cents || 0), 0);
  const trackedExposureCents = Number.isInteger(authoritativeExposureCents)
    ? Math.max(0, authoritativeExposureCents)
    : totalEstimatedCents;
  const costRisk = Number.isInteger(authoritativeExposureCents)
    ? `Current tracked pre-publication AI and tool exposure is A$${(trackedExposureCents / 100).toFixed(2)} estimated or committed. Exact provider billing remains pending. No new external spend is authorized by this brief.`
    : compact(output.details?.["Cost/risk"] || output.costRisk || (totalEstimatedCents ? "Provider cost is still an estimate pending reconciliation." : "No new paid execution is proposed in this brief."), 500);

  const eligibleWork = tasks
    .filter((item) => item.status === "completed" || item.status === "needs_attention")
    .filter((item) => item.agent !== "jarvis");
  const requestedWork = Array.isArray(workTaskIdsOverride) && workTaskIdsOverride.length
    ? workTaskIdsOverride
      .map((id) => eligibleWork.find((task) => task.id === id))
      .filter(Boolean)
    : [...eligibleWork]
      .sort((left, right) => {
        const leftTime = Date.parse(left.completed_at || left.updated_at || left.created_at || "") || 0;
        const rightTime = Date.parse(right.completed_at || right.updated_at || right.created_at || "") || 0;
        return rightTime - leftTime;
      });
  const distinctWork = new Map();
  for (const task of requestedWork) {
    const key = task.agent || task.kind || task.id;
    if (!distinctWork.has(key)) distinctWork.set(key, task);
  }
  const selectedWork = [...distinctWork.values()].slice(0, 9);
  const work = (Array.isArray(workTaskIdsOverride) && workTaskIdsOverride.length
    ? selectedWork
    : selectedWork.reverse())
    .map((task) => {
      const taskResult = taskOutput(task);
      return {
        worker: humanWorker(task.agent),
        assignment: compact(task.title, 260),
        status: task.status,
        result: compact(taskResult.summary || taskResult.note || task.error || "Work recorded without a separate summary.", 650),
      };
    });

  const outputs = canonicalOperatorDeliverables(deliverables)
    .filter((item) => item.id !== approvalPackId && item.format !== "pdf")
    .slice(0, 6)
    .map((item) => ({
      name: compact(item.human_name || item.title, 260).replace(/\s*\(for (?:approval|review)\)\s*/i, ""),
      status: item.status,
      format: item.format,
      summary: compact(item.summary || item.excerpt, 700),
    }));

  const payload = {
    schema: "jarvis_operator_decision_brief_v2",
    approvalPackId,
    humanName,
    generatedAt,
    header: {
      venture: compact(workflow.metadata?.subject || workflow.title, 260),
      workflow: compact(workflow.title, 300),
      status: workflow.status,
      mode: packMode(tasks),
      preparedBy: leadTask ? humanWorker(leadTask.agent) : "Pantheon AI Team",
    },
    decision: {
      headline: compact(decisionOverride.headline || moneyMove, 1200),
      recommendation: compact(decisionOverride.recommendation || recommendation, 1200),
      verdict: decisionOverride.verdict || output.operatorDecision || scorecard?.verdict || "needs_evidence",
      confidence: decisionOverride.confidence || output.confidence || scorecard?.confidence || "low",
      whyNow: compact(decisionOverride.whyNow || output.details?.["Expected upside"] || business.evidenceSummary || scorecard?.recommendation, 700),
      expectedUpside: compact(decisionOverride.expectedUpside || output.details?.["Expected upside"] || output.expectedUpside || "Upside is not yet quantified.", 500),
      costRisk,
      approvalQuestion: compact(decisionOverride.approvalQuestion || "Should Pantheon proceed with this exact next step?", 500),
    },
    commercialCase: {
      buyer: compact(commercialCaseOverride.buyer || business.buyer || workflow.metadata?.buyer || "Buyer still needs confirmation.", 500),
      problem: compact(commercialCaseOverride.problem || business.problem || workflow.metadata?.problem || "Problem evidence is still being established.", 500),
      offer: compact(commercialCaseOverride.offer || business.offer || workflow.metadata?.offer || workflow.metadata?.subject || workflow.title, 500),
      channel: commercialCaseOverride.channel
        ? compact(commercialCaseOverride.channel, 500)
        : humanChannel(business.channel || workflow.metadata?.channel || ""),
      priceChannelHypothesis: compact(commercialCaseOverride.priceChannelHypothesis || output.pilotRecommendation?.priceChannelHypothesis || output.priceChannelHypothesis || "Price and channel need a bounded market test.", 600),
      smallestTest: compact(commercialCaseOverride.smallestTest || output.pilotRecommendation?.smallestTest || output.smallestTest || moneyMove, 600),
      successMetric: compact(commercialCaseOverride.successMetric || output.pilotRecommendation?.metric || output.metric || business.successMetric || "Record a measurable buyer signal.", 500),
      stopRule: compact(commercialCaseOverride.stopRule || output.pilotRecommendation?.killRule || output.killRule || business.killCriteria || "Stop or revise when the declared evidence threshold is not met.", 500),
    },
    evidence: {
      for: evidence.length ? evidence : ["No supporting evidence was summarised yet."],
      against: counterevidence.length ? counterevidence : ["Independent buyer evidence remains limited."],
      assumptions,
      risks: risks.length ? risks : ["No material risk was recorded, but evidence quality should still be checked."],
    },
    score: scorecard ? {
      total: Number(scorecard.total_score || 0),
      verdict: scorecard.verdict,
      confidence: scorecard.confidence,
      dimensions: Object.entries(scorecard.dimensions || {}).map(([key, value]) => ({
        name: value.label || key.replaceAll("_", " "),
        score: Number(value.score || 0),
        note: compact(value.note, 450),
      })),
    } : null,
    economics: {
      expectedProfitCents: Number(workflow.expected_profit_cents || 0),
      estimatedCostCents: trackedExposureCents,
      reconciledCostCents: totalReconciledCents,
      currency: "AUD",
    },
    work,
    outputs,
    nextActions,
    originalInstruction: compact(command.raw_text || workflow.metadata?.originalInstruction || "", 1800),
    actions: actionsOverride || [
      { id: "approve", label: "Approve this next step", effect: "Pantheon may queue only the exact safe step described in this brief." },
      { id: "changes", label: "Request changes", effect: "Return the work with your direction; no outside action occurs." },
      { id: "deny", label: "Stop this direction", effect: "Pause or close this direction without external action." },
    ],
  };
  return transformPresentationStrings(payload, presentationTransform);
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

function outputDirectory(options = {}) {
  return options.outputDir
    || process.env.PANTHEON_APPROVAL_PACK_DIR
    || process.env.JARVIS_APPROVAL_PACK_DIR
    || path.join(CONFIG.rootDir, "output", "pdf");
}

function relativeToRootOrAbsolute(filePath) {
  const rel = path.relative(CONFIG.rootDir, filePath);
  return rel.startsWith("..") ? filePath : rel.replace(/\\/g, "/");
}

function generateApprovalPack(db, workflowId, options = {}) {
  if (options.requireOutsideTransaction === true && db.isTransaction) {
    const error = new Error(
      "Approval-pack rendering must run outside a SQLite transaction so emergency control is never held behind file generation.",
    );
    error.code = "approval_pack_transaction_unsafe";
    throw error;
  }
  const workflowRow = get(db, "SELECT * FROM workflows WHERE id = ?", [workflowId]);
  if (!workflowRow) throw new Error(`Workflow not found: ${workflowId}`);

  const workflow = { ...workflowRow, metadata: fromJson(workflowRow.metadata) };
  const command = get(db, "SELECT * FROM commands WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1", [workflowId]) || {};
  const tasks = parseRows(all(db, "SELECT * FROM tasks WHERE workflow_id = ? ORDER BY priority ASC, created_at ASC", [workflowId]));
  const deliverables = parseRows(all(db, "SELECT * FROM deliverables WHERE workflow_id = ? ORDER BY created_at ASC", [workflowId]));
  const scorecard = Object.prototype.hasOwnProperty.call(options, "scorecardOverride")
    ? options.scorecardOverride
    : getWorkflowScorecard(db, workflowId);
  const costs = parseRows(all(db, "SELECT * FROM costs WHERE workflow_id = ? ORDER BY occurred_at ASC", [workflowId]), ["metadata"]);
  const ts = now();
  const humanName = options.humanName || approvalPackName(workflow, deliverables);
  const approvalPackId = `deliv_pdf_${slugForId(workflowId)}`;
  const outDir = outputDirectory(options);
  fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, `${safeFileName(humanName)}.pdf`);
  const tempDir = path.join(CONFIG.rootDir, "tmp", "pdfs");
  fs.mkdirSync(tempDir, { recursive: true });
  const payloadPath = path.join(tempDir, `${approvalPackId}.json`);

  const operatorDeliverables = deliverables.map((item) => ({ ...item, excerpt: readExcerpt(item.file_path) }));
  const payload = buildOperatorPackPayload({
    approvalPackId,
    humanName,
    generatedAt: ts,
    workflow: options.workflowStatus ? { ...workflow, status: options.workflowStatus } : workflow,
    command,
    scorecard,
    tasks,
    deliverables: operatorDeliverables,
    costs,
    authoritativeExposureCents: Number.isInteger(options.authoritativeExposureCents)
      ? options.authoritativeExposureCents
      : null,
    decisionOverride: options.decisionOverride || {},
    commercialCaseOverride: options.commercialCaseOverride || {},
    actionsOverride: Array.isArray(options.actionsOverride) ? options.actionsOverride : null,
    workTaskIdsOverride: Array.isArray(options.workTaskIdsOverride) ? options.workTaskIdsOverride : null,
    presentationTransform: typeof options.presentationTransform === "function"
      ? options.presentationTransform
      : null,
  });
  fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), "utf8");

  const renderer = path.join(CONFIG.rootDir, "scripts", "render-approval-pack.py");
  const rendered = spawnSync(resolvePython(), [renderer, payloadPath, outputPath], {
    cwd: CONFIG.rootDir,
    encoding: "utf8",
    timeout: 90_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (rendered.error?.code === "ETIMEDOUT") {
    throw new Error("Approval pack PDF rendering exceeded its 90-second deadline.");
  }
  if (rendered.error) throw rendered.error;
  if (rendered.status !== 0) {
    throw new Error(`Approval pack PDF render failed: ${rendered.stderr || rendered.stdout || "unknown error"}`);
  }
  const stats = fs.statSync(outputPath);
  if (stats.size < 1000) throw new Error("Approval pack PDF render produced an unexpectedly small file.");

  if (typeof options.prePersistValidation === "function") {
    options.prePersistValidation({
      workflowId,
      taskId: options.taskId || null,
      outputPath,
      bytes: stats.size,
    });
  }

  const relPath = relativeToRootOrAbsolute(outputPath);
  const sourcePaths = deliverables.map((item) => item.file_path).filter(Boolean);
  run(
    db,
    `INSERT INTO deliverables (id, workflow_id, command_id, task_id, title, human_name, audience, format, status, file_path, summary, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       task_id = excluded.task_id,
       human_name = excluded.human_name,
       status = excluded.status,
       file_path = excluded.file_path,
       summary = excluded.summary,
       metadata = excluded.metadata,
       updated_at = excluded.updated_at`,
    [
      approvalPackId,
      workflowId,
      command.id || null,
      options.taskId || null,
      "Approval Pack",
      humanName,
      "operator",
      "pdf",
      "ready_for_review",
      relPath,
      "Executive decision brief with the recommendation, commercial case, evidence, risks, team work, and next action.",
      toJson({ packSchema: payload.schema, generatedAt: ts, sourceDeliverables: deliverables.map((item) => item.id), sourcePaths, bytes: stats.size }),
      ts,
      ts,
    ],
  );

  insertEvent(db, {
    actor: "approval-pack-generator",
    type: "approval_pack.generated",
    entityType: "workflow",
    entityId: workflowId,
    message: `Generated PDF approval pack: ${humanName}.`,
    metadata: { deliverableId: approvalPackId, filePath: relPath, bytes: stats.size },
  });

  return {
    id: approvalPackId,
    humanName,
    filePath: relPath,
    bytes: stats.size,
  };
}

module.exports = {
  approvalPackName,
  buildOperatorPackPayload,
  generateApprovalPack,
};
