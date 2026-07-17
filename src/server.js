const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const { WebSocketServer } = require("ws");
const CONFIG = require("./config");
const { decideApproval } = require("./runtime/approvals");
const { refreshIntegrationHealth } = require("./adapters/registry");
const { getDashboardState } = require("./runtime/state");
const { all, get, insertEvent, now, openDatabase, run, seedDatabase, toJson } = require("./db");
const { createCommandPlan } = require("./runtime/planner");
const { runOnce, runUntilBlocked } = require("./runtime/orchestrator");
const { generateApprovalPack } = require("./runtime/approval-pack");
const { runMonitorCycle } = require("./runtime/monitor");
const { createLiveAiWorkerSmokeTest, requestLiveAiWorker } = require("./runtime/live-ai-workers");
const { createLiveResearchSmokeTest, requestLiveResearch } = require("./runtime/live-research");
const { decideAgentHandoff, ensureAiTeam } = require("./runtime/ai-team");
const { ensureWorkflowScorecards, upsertWorkflowScorecard } = require("./runtime/scorecard");
const { createCommercialExperiment, recordCommercialFeedback, recordCommercialResult } = require("./runtime/commercial-results");
const { createResearchToExperimentPlan, createRevisionPlanFromLearning, promoteCandidateToExperiment } = require("./runtime/research-to-experiment");
const { generateExecutionPack, recordExecutionPackOutcome } = require("./runtime/test-execution-pack");
const { getLiveAiWorkerReadiness } = require("./runtime/live-ai-worker-readiness");
const { getLiveResearchReadiness } = require("./runtime/live-research-readiness");
const {
  ensureAgentWorkbench,
  getAgentWorkbenchState,
  queueAgentWorkbenchProof,
  queueAgentWorkbenchProofSuite,
  requestAgentWorkbenchLiveComparison,
} = require("./runtime/agent-workbench");
const { getAgentToolGateState } = require("./runtime/agent-tool-gate");
const { ensureAgentTools, getAgentToolPolicyState } = require("./runtime/agent-tools");
const { getAgentOperatingBriefsState } = require("./runtime/agent-operating-briefs");
const { getAgentPlaybooksState, queueAgentPlaybookRehearsal, queueAgentPlaybookRehearsalSuite } = require("./runtime/agent-playbooks");
const { getAgentModelReadinessState, queueAgentModelComparisonPacket, storedComparisonPackets } = require("./runtime/agent-model-readiness");
const { recordAiPilotReviewDecision } = require("./runtime/ai-pilot-review");
const { createLocalSecurity } = require("./runtime/local-security");
const { recoverSetupBlockedTasks } = require("./runtime/spend-gate");
const { ensureWeeklyDigest, generateWeeklyDigest, getLatestDigest } = require("./runtime/executive-digest");
const { ensureActiveVentureCase } = require("./runtime/venture-case");
const { ensureCapabilityAutonomy } = require("./runtime/capability-autonomy");
const { getGumroadSalesState, importGumroadCsv } = require("./runtime/gumroad-import");
const { reconcileProviderUsageBatch } = require("./runtime/cost-ledger");
const {
  createPilotFixture,
  getPilotState,
  prepareDemandValidatorPilot,
  prepareDemandValidatorPilotRetry,
  reviewPilotRun,
} = require("./runtime/agent-pilot");
const {
  getAgentDetail,
  getAgentRunDetail,
  getAgentRunsState,
  getAiTeamState,
  getBusinessTestsState,
  getCockpitState,
  getDecisionsState,
  getSystemState,
  getTestDetail,
} = require("./runtime/cockpit-state");
const {
  ensureSchedulerJobs,
  runDueSchedulerJobs,
  runSchedulerJob,
  setSchedulerJobStatus,
  startSchedulerLoop,
} = require("./runtime/scheduler");

const PUBLIC_DIR = path.join(CONFIG.rootDir, "public");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const MAX_REQUEST_BODY_BYTES = 1_000_000;

function clientRequestError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function notFound(res) {
  jsonResponse(res, 404, { error: "Not found" });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(req.headers["content-length"] || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
      reject(clientRequestError("Request body too large", 413));
      return;
    }

    const chunks = [];
    let bytes = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BODY_BYTES) {
        settled = true;
        reject(clientRequestError("Request body too large", 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const body = Buffer.concat(chunks).toString("utf8");
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(clientRequestError("Invalid JSON body", 400));
      }
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/vendor/lucide.js") {
    const vendorPath = path.join(CONFIG.rootDir, "node_modules", "lucide", "dist", "umd", "lucide.min.js");
    if (!fs.existsSync(vendorPath)) {
      notFound(res);
      return;
    }
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=86400" });
    fs.createReadStream(vendorPath).pipe(res);
    return;
  }
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const decoded = decodeURIComponent(pathname);
  const safePath = path.normalize(decoded).replace(/^([/\\])+/, "");
  const filePath = path.resolve(PUBLIC_DIR, safePath);
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    notFound(res);
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[ext] || "application/octet-stream",
    "cache-control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
}

function resolveWorkspaceFile(filePath) {
  if (!filePath) return null;
  const root = path.resolve(CONFIG.rootDir);
  const candidate = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const resolved = path.resolve(candidate);
  const allowedRoots = [path.resolve(CONFIG.artifactRoot), path.resolve(CONFIG.rootDir, "output", "pdf")];
  return allowedRoots.some((allowedRoot) => {
    const relative = path.relative(allowedRoot, resolved);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  }) ? resolved : null;
}

function serveDeliverableFile(db, res, id) {
  const deliverable = get(db, "SELECT id, human_name, format, file_path FROM deliverables WHERE id = ?", [id]);
  if (!deliverable) {
    notFound(res);
    return;
  }
  if (String(deliverable.format || "").toLowerCase() !== "pdf") {
    jsonResponse(res, 415, { error: "Preview is available for PDF review outputs only." });
    return;
  }
  const filePath = resolveWorkspaceFile(deliverable.file_path);
  if (!filePath) {
    jsonResponse(res, 403, { error: "Review output is outside the workspace and cannot be previewed." });
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    notFound(res);
    return;
  }
  const stats = fs.statSync(filePath);
  const filename = path.basename(filePath).replace(/["\r\n]/g, "");
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
    "content-length": stats.size,
    "content-disposition": `inline; filename="${filename}"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  fs.createReadStream(filePath).pipe(res);
}

function ensureRuntimeFoundation(db) {
  refreshIntegrationHealth(db);
  ensureAiTeam(db);
  ensureAgentTools(db);
  ensureAgentWorkbench(db);
  ensureSchedulerJobs(db);
  ensureWorkflowScorecards(db);
  ensureActiveVentureCase(db);
  ensureCapabilityAutonomy(db);
  ensureWeeklyDigest(db);
}

function createRuntime(options = {}) {
  const db = openDatabase(options.dbPath || CONFIG.dbPath);
  const seeded = seedDatabase(db, { includeDemoProof: options.includeDemoProof === true });
  ensureRuntimeFoundation(db);
  if (seeded) {
    insertEvent(db, {
      actor: "server",
      type: "server.seeded",
      entityType: "runtime",
      entityId: "v2",
      message: "Runtime database initialized on first server start.",
    });
  }
  return db;
}

function routeMatch(pathname, pattern) {
  const pathParts = pathname.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
    const actual = pathParts[index];
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = actual;
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

function createApp(options = {}) {
  const db = options.db || createRuntime(options);
  if (options.db) ensureRuntimeFoundation(db);
  const instanceId = String(options.instanceId || process.env.JARVIS_RUNTIME_INSTANCE_ID || crypto.randomUUID());
  const workspaceId = crypto.createHash("sha256").update(path.resolve(CONFIG.rootDir)).digest("hex").slice(0, 20);
  const controlToken = String(options.controlToken || process.env.JARVIS_CONTROL_TOKEN || crypto.randomBytes(32).toString("base64url"));
  const security = createLocalSecurity({
    enabled: options.security !== false,
    secret: options.sessionSecret,
    bootstrapSecret: options.bootstrapSecret,
    sessionTtlMs: options.sessionTtlMs,
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("content-security-policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; frame-src 'self'; form-action 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*");
    try {
      try {
        security.assertRequestHost(req);
      } catch (error) {
        jsonResponse(res, 403, { error: error.message });
        return;
      }

      if (req.method === "OPTIONS") {
        jsonResponse(res, 403, { error: "Cross-origin API access is not enabled." });
        return;
      }

      if (!url.pathname.startsWith("/api/")) {
        serveStatic(req, res);
        return;
      }

      const broadcastState = () => {
        if (server.broadcastState) server.broadcastState();
      };

      if (req.method === "POST" && url.pathname === "/api/session") {
        try {
          const session = security.createSession(req, res);
          jsonResponse(res, 201, { ok: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
        } catch (error) {
          jsonResponse(res, 401, { error: error.message });
        }
        return;
      }

      let session = null;
      if (req.method === "GET" && url.pathname === "/api/session") {
        try {
          session = security.requireSession(req);
          jsonResponse(res, 200, { ok: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
        } catch (error) {
          jsonResponse(res, 401, { error: error.message });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/health") {
        const authenticated = Boolean(security.sessionForRequest(req));
        const liveResearch = getLiveResearchReadiness(db);
        const liveAiWorkers = getLiveAiWorkerReadiness(db);
        const providerProof = get(
          db,
          `SELECT
             SUM(CASE WHEN mode = 'live' AND status = 'completed' AND provider_request_id IS NOT NULL THEN 1 ELSE 0 END) AS completed_calls,
             SUM(CASE WHEN mode = 'live' AND status = 'failed' THEN 1 ELSE 0 END) AS failed_calls
           FROM model_calls`,
        ) || {};
        const payload = {
          ok: true,
          instanceId,
          workspaceId,
          time: now(),
          externalActionsMode: CONFIG.dryRun ? "locked" : "enabled",
          paidAiArmed: Boolean(process.env.OPENAI_API_KEY)
            && (process.env.JARVIS_ENABLE_LIVE_MODELS === "1" || process.env.JARVIS_ENABLE_LIVE_RESEARCH === "1"),
          providerProof: {
            completedCalls: Number(providerProof.completed_calls || 0),
            failedCalls: Number(providerProof.failed_calls || 0),
            verifiedByPriorCall: Number(providerProof.completed_calls || 0) > 0,
          },
        };
        if (authenticated || !security.enabled) {
          payload.dbPath = options.dbPath || CONFIG.dbPath;
          payload.liveResearch = liveResearch;
          payload.liveAiWorkers = liveAiWorkers;
        }
        jsonResponse(res, 200, payload);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/shutdown") {
        const providedControlToken = String(req.headers["x-jarvis-control"] || "");
        if (
          !controlToken
          || providedControlToken.length !== controlToken.length
          || !crypto.timingSafeEqual(Buffer.from(providedControlToken), Buffer.from(controlToken))
        ) {
          jsonResponse(res, 403, { error: "Runtime control token rejected." });
          return;
        }
        jsonResponse(res, 202, { ok: true, instanceId });
        setImmediate(() => server.shutdown?.());
        return;
      }

      try {
        session = security.requireSession(req);
      } catch (error) {
        jsonResponse(res, 401, { error: error.message });
        return;
      }

      try {
        security.assertMutation(req, session);
      } catch (error) {
        jsonResponse(res, 403, { error: error.message });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/cockpit") {
        jsonResponse(res, 200, getCockpitState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/ventures") {
        jsonResponse(res, 200, {
          ventures: all(
            db,
            `SELECT id, name, lifecycle_stage, is_active, business_model
             FROM ventures ORDER BY is_active DESC, name ASC`,
          ),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/executive-digest") {
        jsonResponse(res, 200, { digest: getLatestDigest(db) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/system/weekly-digest") {
        const digest = generateWeeklyDigest(db);
        broadcastState();
        jsonResponse(res, 200, { digest });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/decisions") {
        jsonResponse(res, 200, getDecisionsState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/tests") {
        jsonResponse(res, 200, getBusinessTestsState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/gumroad/sales") {
        jsonResponse(res, 200, getGumroadSalesState(db, url.searchParams.get("venture_id") || "venture-digital-products"));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/gumroad/import") {
        const body = await readBody(req);
        const result = importGumroadCsv(db, body || {});
        broadcastState();
        jsonResponse(res, 200, { result, tests: getBusinessTestsState(db) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/ai-team") {
        jsonResponse(res, 200, getAiTeamState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-runs") {
        const allowedExecution = new Set(["all", "live", "model_backed", "provider_outcome_unknown", "protected_rehearsal"]);
        const allowedState = new Set(["all", "active", "history"]);
        const execution = url.searchParams.get("execution") || "all";
        const state = url.searchParams.get("state") || "all";
        const status = url.searchParams.get("status") || "all";
        const worker = url.searchParams.get("worker") || "all";
        jsonResponse(res, 200, getAgentRunsState(db, {
          execution: allowedExecution.has(execution) ? execution : "all",
          state: allowedState.has(state) ? state : "all",
          status: /^[a-z_]{1,40}$/i.test(status) ? status : "all",
          worker: /^[a-z0-9_-]{1,80}$/i.test(worker) ? worker : "all",
          limit: url.searchParams.get("limit") || 50,
        }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/system") {
        jsonResponse(res, 200, getSystemState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/system/health") {
        jsonResponse(res, 200, getSystemState(db).health);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/system/spend/reconcile-provider-usage") {
        const body = await readBody(req);
        const result = reconcileProviderUsageBatch(db, body || {});
        broadcastState();
        jsonResponse(res, 200, { result, system: getSystemState(db) });
        return;
      }

      const testDetail = routeMatch(url.pathname, "/api/tests/:id");
      if (req.method === "GET" && testDetail) {
        const result = getTestDetail(db, testDetail.id);
        if (!result) notFound(res);
        else jsonResponse(res, 200, result);
        return;
      }

      const agentDetail = routeMatch(url.pathname, "/api/agents/:id");
      if (req.method === "GET" && agentDetail) {
        const result = getAgentDetail(db, agentDetail.id);
        if (!result) notFound(res);
        else jsonResponse(res, 200, result);
        return;
      }

      const agentRunDetail = routeMatch(url.pathname, "/api/agent-runs/:id");
      if (req.method === "GET" && agentRunDetail) {
        const result = getAgentRunDetail(db, agentRunDetail.id);
        if (!result) notFound(res);
        else jsonResponse(res, 200, result);
        return;
      }

      const decisionDetail = routeMatch(url.pathname, "/api/decisions/:id");
      if (req.method === "GET" && decisionDetail) {
        const decisions = getDecisionsState(db);
        const result = [...decisions.approvals, ...decisions.reviews, ...decisions.suggestions, ...decisions.history]
          .find((item) => item.id === decisionDetail.id);
        if (!result) notFound(res);
        else jsonResponse(res, 200, result);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/state") {
        jsonResponse(res, 410, { error: "The unrestricted runtime feed has been retired. Use the focused cockpit sections." });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/decision-inbox") {
        const state = getDashboardState(db);
        jsonResponse(res, 200, {
          generatedAt: state.generatedAt,
          decisionInbox: state.decisionInbox,
          metrics: state.metrics.decisionInbox,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/manual-market-cockpit") {
        const state = getDashboardState(db);
        jsonResponse(res, 200, {
          generatedAt: state.generatedAt,
          manualMarketCockpit: state.manualMarketCockpit,
          metrics: state.metrics.manualMarketCockpit,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/events") {
        jsonResponse(res, 200, getDashboardState(db).events);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-workbench") {
        jsonResponse(res, 200, getAgentWorkbenchState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-operating-briefs") {
        jsonResponse(res, 200, getAgentOperatingBriefsState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-playbooks") {
        jsonResponse(res, 200, getAgentPlaybooksState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-model-readiness") {
        jsonResponse(res, 200, getAgentModelReadinessState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-model-comparison-packets") {
        jsonResponse(res, 200, {
          schema: "jarvis_agent_model_comparison_packets_v1",
          packets: storedComparisonPackets(db),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-pilot") {
        jsonResponse(res, 200, getPilotState(db));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/agent-pilot/fixtures") {
        const body = await readBody(req);
        const result = createPilotFixture(db, body || {});
        broadcastState();
        jsonResponse(res, 201, { result, pilot: getPilotState(db) });
        return;
      }

      const pilotFixturePrepare = routeMatch(url.pathname, "/api/agent-pilot/fixtures/:id/prepare");
      if (req.method === "POST" && pilotFixturePrepare) {
        const body = await readBody(req);
        const result = prepareDemandValidatorPilot(db, pilotFixturePrepare.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result, pilot: getPilotState(db) });
        return;
      }

      const pilotFixtureRetry = routeMatch(url.pathname, "/api/agent-pilot/fixtures/:id/retry");
      if (req.method === "POST" && pilotFixtureRetry) {
        const body = await readBody(req);
        const result = prepareDemandValidatorPilotRetry(db, pilotFixtureRetry.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result, pilot: getPilotState(db) });
        return;
      }

      const pilotRunReview = routeMatch(url.pathname, "/api/agent-pilot/runs/:id/review");
      if (req.method === "POST" && pilotRunReview) {
        const body = await readBody(req);
        const result = reviewPilotRun(db, pilotRunReview.id, body || {});
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const modelComparisonPacket = routeMatch(url.pathname, "/api/agent-model-readiness/:id/comparison-packet");
      if (req.method === "POST" && modelComparisonPacket) {
        const body = await readBody(req);
        const result = queueAgentModelComparisonPacket(db, modelComparisonPacket.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }

      const aiPilotReviewDecision = routeMatch(url.pathname, "/api/ai-pilot-review/:agentId/:decision");
      if (req.method === "POST" && aiPilotReviewDecision) {
        const body = await readBody(req);
        const result = recordAiPilotReviewDecision(
          db,
          aiPilotReviewDecision.agentId,
          aiPilotReviewDecision.decision,
          body || {},
        );
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/agent-playbooks/rehearsal-suite") {
        const body = await readBody(req);
        const queued = queueAgentPlaybookRehearsalSuite(db, body || {});
        const maxSteps = body.maxSteps || queued.tasks.length + 2;
        const loop = body.autoRun === false ? null : await runUntilBlocked(db, { workflowId: queued.workflow.id, maxSteps });
        broadcastState();
        jsonResponse(res, 201, { result: { ...queued, loop } });
        return;
      }

      const agentPlaybookRehearsal = routeMatch(url.pathname, "/api/agent-playbooks/:id/rehearsal");
      if (req.method === "POST" && agentPlaybookRehearsal) {
        const body = await readBody(req);
        const queued = queueAgentPlaybookRehearsal(db, agentPlaybookRehearsal.id, body || {});
        const runResult = body.autoRun === false ? null : await runOnce(db, { workflowId: queued.workflow.id });
        broadcastState();
        jsonResponse(res, 201, { result: { ...queued, run: runResult } });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/agent-workbench/proof-suite") {
        const body = await readBody(req);
        const queued = queueAgentWorkbenchProofSuite(db, body || {});
        const maxSteps = body.maxSteps || queued.tasks.length + 2;
        const loop = body.autoRun === false ? null : await runUntilBlocked(db, { workflowId: queued.workflow.id, maxSteps });
        broadcastState();
        jsonResponse(res, 201, { result: { ...queued, loop } });
        return;
      }
      const agentLiveComparison = routeMatch(url.pathname, "/api/agent-workbench/:id/live-comparison");
      if (req.method === "POST" && agentLiveComparison) {
        const body = await readBody(req);
        const result = requestAgentWorkbenchLiveComparison(db, agentLiveComparison.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }
      const agentProofRun = routeMatch(url.pathname, "/api/agent-workbench/:id/proof-run");
      if (req.method === "POST" && agentProofRun) {
        const body = await readBody(req);
        const queued = queueAgentWorkbenchProof(db, agentProofRun.id, body || {});
        const runResult = body.autoRun === false ? null : await runOnce(db, { workflowId: queued.workflow.id });
        broadcastState();
        jsonResponse(res, 201, { result: { ...queued, run: runResult } });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-tools") {
        jsonResponse(res, 200, getAgentToolPolicyState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/agent-tool-gate") {
        jsonResponse(res, 200, getAgentToolGateState(db));
        return;
      }

      const deliverableFile = routeMatch(url.pathname, "/api/deliverables/:id/file");
      if (req.method === "GET" && deliverableFile) {
        serveDeliverableFile(db, res, deliverableFile.id);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/monitor/run") {
        const body = await readBody(req);
        const result = runMonitorCycle(db, body || {});
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/scheduler") {
        const state = getDashboardState(db);
        jsonResponse(res, 200, {
          jobs: state.schedulerJobs,
          runs: state.schedulerRuns,
          metrics: state.metrics.scheduler,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/system/maintenance/run-due") {
        const body = await readBody(req);
        const result = await runDueSchedulerJobs(db, { limit: body.limit });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const schedulerJobRun = routeMatch(url.pathname, "/api/scheduler/jobs/:id/run");
      if (req.method === "POST" && schedulerJobRun) {
        const body = await readBody(req);
        const result = await runSchedulerJob(db, schedulerJobRun.id, {
          manual: true,
          force: body.force === true,
          maxSteps: body.maxSteps,
        });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const schedulerJobAction = routeMatch(url.pathname, "/api/scheduler/jobs/:id/:action");
      if (req.method === "POST" && schedulerJobAction) {
        const actionMap = { enable: "enabled", disable: "disabled" };
        const status = actionMap[schedulerJobAction.action];
        if (!status) {
          jsonResponse(res, 400, { error: "Scheduler action must be enable or disable." });
          return;
        }
        const job = setSchedulerJobStatus(db, schedulerJobAction.id, status);
        broadcastState();
        jsonResponse(res, 200, { job });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/commands") {
        const body = await readBody(req);
        if (!body.text || !String(body.text).trim()) {
          jsonResponse(res, 400, { error: "Command text is required." });
          return;
        }
        const ventureId = body.venture_id || body.ventureId;
        if (!ventureId) {
          jsonResponse(res, 400, { error: "Select the active venture before creating work." });
          return;
        }
        if (!["plan_only", "run_protected"].includes(body.mode)) {
          jsonResponse(res, 400, { error: "Choose plan_only or run_protected for this command." });
          return;
        }
        const result = createCommandPlan(db, {
          text: body.text,
          source: body.source || "dashboard",
          createFiles: body.createFiles,
          ventureId,
          mode: body.mode,
        });
        let loop = null;
        if (body.mode === "run_protected" && body.autoRun === true) {
          loop = await runUntilBlocked(db, { workflowId: result.workflow.id, maxSteps: body.maxSteps });
        }
        broadcastState();
        jsonResponse(res, 201, { result, loop });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/tick") {
        const result = await runOnce(db);
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const taskRun = routeMatch(url.pathname, "/api/tasks/:id/run");
      if (req.method === "POST" && taskRun) {
        const task = get(db, "SELECT id, workflow_id FROM tasks WHERE id = ?", [taskRun.id]);
        if (!task) {
          jsonResponse(res, 404, { error: "Work item not found." });
          return;
        }
        const result = await runOnce(db, { taskId: taskRun.id, workflowId: task.workflow_id, claimant: "dashboard_exact_task" });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/run-until-blocked") {
        const body = await readBody(req);
        const result = await runUntilBlocked(db, { maxSteps: body.maxSteps });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const workflowRun = routeMatch(url.pathname, "/api/workflows/:id/run");
      if (req.method === "POST" && workflowRun) {
        const result = await runOnce(db, { workflowId: workflowRun.id });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const workflowRunUntilBlocked = routeMatch(url.pathname, "/api/workflows/:id/run-until-blocked");
      if (req.method === "POST" && workflowRunUntilBlocked) {
        const body = await readBody(req);
        const result = await runUntilBlocked(db, { workflowId: workflowRunUntilBlocked.id, maxSteps: body.maxSteps });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const approvalPack = routeMatch(url.pathname, "/api/workflows/:id/approval-pack");
      if (req.method === "POST" && approvalPack) {
        const result = generateApprovalPack(db, approvalPack.id);
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const liveResearchRequest = routeMatch(url.pathname, "/api/workflows/:id/request-live-research");
      if (req.method === "POST" && liveResearchRequest) {
        const body = await readBody(req);
        const result = requestLiveResearch(db, liveResearchRequest.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/live-research/smoke-test") {
        const body = await readBody(req);
        const result = createLiveResearchSmokeTest(db, body || {});
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }

      const liveAiWorkerRequest = routeMatch(url.pathname, "/api/workflows/:id/request-live-ai-worker");
      if (req.method === "POST" && liveAiWorkerRequest) {
        const body = await readBody(req);
        const result = requestLiveAiWorker(db, liveAiWorkerRequest.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/live-ai-workers/smoke-test") {
        const body = await readBody(req);
        const result = createLiveAiWorkerSmokeTest(db, body || {});
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/commercial/experiments") {
        const body = await readBody(req);
        const result = createCommercialExperiment(db, body || {});
        if (result.workflow_id) upsertWorkflowScorecard(db, result.workflow_id, { commercialExperimentId: result.id });
        broadcastState();
        jsonResponse(res, 201, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/research-to-experiment/plans") {
        const body = await readBody(req);
        const result = createResearchToExperimentPlan(db, body || {});
        broadcastState();
        jsonResponse(res, 201, { result });
        return;
      }

      const promoteTestCandidate = routeMatch(url.pathname, "/api/research-to-experiment/candidates/:id/promote");
      if (req.method === "POST" && promoteTestCandidate) {
        const body = await readBody(req);
        const result = promoteCandidateToExperiment(db, promoteTestCandidate.id, body || {});
        if (result.experiment?.workflow_id) upsertWorkflowScorecard(db, result.experiment.workflow_id, { commercialExperimentId: result.experiment.id });
        broadcastState();
        jsonResponse(res, 201, { result });
        return;
      }

      const learningRevisionPlan = routeMatch(url.pathname, "/api/commercial/learning/:id/revision-plan");
      if (req.method === "POST" && learningRevisionPlan) {
        const body = await readBody(req);
        const result = createRevisionPlanFromLearning(db, learningRevisionPlan.id, body || {});
        broadcastState();
        jsonResponse(res, 201, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/execution-packs") {
        const body = await readBody(req);
        const result = generateExecutionPack(db, body || {});
        broadcastState();
        jsonResponse(res, 201, { result });
        return;
      }

      const executionPackOutcome = routeMatch(url.pathname, "/api/execution-packs/:id/outcomes");
      if (req.method === "POST" && executionPackOutcome) {
        const body = await readBody(req);
        const result = recordExecutionPackOutcome(db, executionPackOutcome.id, body || {});
        const workflowId = result.recorded?.experiment?.workflow_id || result.pack?.workflow_id;
        let scorecard = null;
        if (workflowId) scorecard = upsertWorkflowScorecard(db, workflowId, { commercialExecutionPackId: result.pack.id });
        broadcastState();
        jsonResponse(res, 201, { result: { ...result, scorecard } });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/commercial/results") {
        const body = await readBody(req);
        const result = recordCommercialResult(db, body || {});
        let scorecard = null;
        if (result.experiment.workflow_id) scorecard = upsertWorkflowScorecard(db, result.experiment.workflow_id, { commercialResultId: result.result.id });
        broadcastState();
        jsonResponse(res, 201, { result: { ...result, scorecard } });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/commercial/feedback") {
        const body = await readBody(req);
        const result = recordCommercialFeedback(db, body || {});
        let scorecard = null;
        if (result.experiment.workflow_id) scorecard = upsertWorkflowScorecard(db, result.experiment.workflow_id, { commercialFeedbackId: result.feedback.id });
        broadcastState();
        jsonResponse(res, 201, { result: { ...result, scorecard } });
        return;
      }

      const approvalAction = routeMatch(url.pathname, "/api/approval-actions/:token");
      if (approvalAction && ["GET", "POST"].includes(req.method)) {
        jsonResponse(res, 410, {
          error: "Email action links are disabled until a signed provider webhook is connected. Use Decisions in Jarvis.",
        });
        return;
      }

      const approvalDecision = routeMatch(url.pathname, "/api/approvals/:id/:decision");
      if (req.method === "POST" && approvalDecision) {
        const body = await readBody(req);
        const decisionMap = {
          approve: "approved",
          reject: "rejected",
          changes: "needs_changes",
        };
        const decision = decisionMap[approvalDecision.decision];
        if (!decision) {
          jsonResponse(res, 400, { error: "Decision must be approve, reject, or changes." });
          return;
        }
        if (!body.scopeHash) {
          jsonResponse(res, 409, { error: "Refresh this decision before acting; its approval scope is missing." });
          return;
        }
        const result = decideApproval(db, approvalDecision.id, decision, body.note || "", { expectedScopeHash: body.scopeHash });
        const execution = decision === "approved" && result.changed && result.approvedTaskIds?.length
          ? await runOnce(db, { taskId: result.approvedTaskIds[0], claimant: "dashboard_approval" })
          : null;
        broadcastState();
        jsonResponse(res, 200, { result, execution });
        return;
      }

      const handoffDecision = routeMatch(url.pathname, "/api/agent-handoffs/:id/:decision");
      if (req.method === "POST" && handoffDecision) {
        const body = await readBody(req);
        const decisionMap = {
          approve: "approve",
          reject: "reject",
          changes: "changes",
        };
        const decision = decisionMap[handoffDecision.decision];
        if (!decision) {
          jsonResponse(res, 400, { error: "Decision must be approve, reject, or changes." });
          return;
        }
        const result = decideAgentHandoff(db, handoffDecision.id, decision, body.note || "", {
          decidedBy: body.decidedBy || "operator",
        });
        const execution = decision === "approve" && result.followupTask?.id
          ? await runOnce(db, { taskId: result.followupTask.id, claimant: "dashboard_handoff_approval" })
          : null;
        broadcastState();
        jsonResponse(res, 200, { result, execution });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/inbound/approval-reply") {
        jsonResponse(res, 410, {
          error: "Inbound email decisions are disabled until sender authenticity and signed webhook delivery are available.",
        });
        return;
      }

      const messageResolve = routeMatch(url.pathname, "/api/messages/:id/resolve");
      if (req.method === "POST" && messageResolve) {
        const message = get(db, "SELECT * FROM messages WHERE id = ?", [messageResolve.id]);
        if (!message) {
          jsonResponse(res, 404, { error: "Message not found" });
          return;
        }
        run(db, "UPDATE messages SET status = 'resolved', resolved_at = ? WHERE id = ?", [now(), messageResolve.id]);
        insertEvent(db, {
          actor: "operator",
          type: "message.resolved",
          entityType: "message",
          entityId: messageResolve.id,
          message: `Operator resolved message ${messageResolve.id}.`,
        });
        broadcastState();
        jsonResponse(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/integrations/check") {
        const result = refreshIntegrationHealth(db);
        const recovery = recoverSetupBlockedTasks(db);
        insertEvent(db, {
          actor: "runtime",
          type: "integrations.checked",
          entityType: "integration",
          entityId: "all",
          message: "Integration health statuses refreshed from environment configuration.",
          metadata: { result, recovery },
        });
        broadcastState();
        jsonResponse(res, 200, { result: { integrations: result, recovery } });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/live-action-request") {
        jsonResponse(res, 410, { error: "Generic live actions are not supported. Start the exact approved business action instead." });
        return;
      }

      notFound(res);
    } catch (error) {
      if ([400, 413].includes(Number(error.statusCode))) {
        jsonResponse(res, Number(error.statusCode), { error: error.message });
        return;
      }
      const requestId = crypto.randomUUID();
      insertEvent(db, {
        level: "error",
        actor: "server",
        type: "server.error",
        entityType: "request",
        entityId: requestId,
        message: error.message,
        metadata: { path: url.pathname },
      });
      jsonResponse(res, 500, { error: "Jarvis could not complete that request. Check System activity for the recorded error.", requestId });
    }
  });

  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;

  const wss = new WebSocketServer({ noServer: true });
  wss.on("error", (error) => {
    insertEvent(db, {
      level: "error",
      actor: "server",
      type: "websocket.error",
      entityType: "websocket",
      entityId: "dashboard",
      message: error.message,
    });
  });
  server.broadcastState = () => {
    const payload = JSON.stringify({
      type: "invalidate",
      sections: ["cockpit", "decisions", "tests", "ai-team", "system"],
      at: now(),
    });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  };
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "connected", at: now() }));
  });
  server.on("upgrade", (req, socket, head) => {
    try {
      security.assertWebSocket(req);
      wss.handleUpgrade(req, socket, head, (client) => wss.emit("connection", client, req));
    } catch {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });

  let shuttingDown = false;
  server.shutdown = () => {
    if (shuttingDown) return Promise.resolve();
    shuttingDown = true;
    server.schedulerLoop?.stop?.();
    for (const client of wss.clients) client.terminate();
    return new Promise((resolve) => {
      const finish = () => {
        if (!options.db) db.close();
        resolve();
      };
      wss.close(() => {
        if (server.listening) server.close(finish);
        else finish();
      });
    });
  };

  return { server, db, wss, security, instanceId, workspaceId };
}

function startServer(options = {}) {
  const app = createApp(options);
  const port = options.port ?? CONFIG.port;
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    app.server.once("error", onError);
    app.server.listen(port, "127.0.0.1", () => {
      app.server.off("error", onError);
      const address = app.server.address();
      const url = `http://127.0.0.1:${address.port}`;
      let schedulerLoop = null;
      if (options.schedulerEnabled ?? CONFIG.schedulerEnabled) {
        schedulerLoop = startSchedulerLoop(app.db, options.scheduler || {});
      }
      app.server.schedulerLoop = schedulerLoop;
      console.log(`Jarvis-Codex Control running at ${url}`);
      if (schedulerLoop) console.log(`Jarvis-Codex scheduler polling every ${schedulerLoop.pollMs}ms`);
      resolve({ ...app, url, schedulerLoop });
    });
  });
}

if (require.main === module) {
  const bootstrapSecret = process.env.JARVIS_OPERATOR_BOOTSTRAP || crypto.randomBytes(32).toString("base64url");
  process.env.JARVIS_OPERATOR_BOOTSTRAP = bootstrapSecret;
  startServer({ bootstrapSecret }).then(({ url }) => {
    console.log(`Open ${url}/#bootstrap=${bootstrapSecret}`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  createApp,
  createRuntime,
  startServer,
};
