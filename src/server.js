const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const { WebSocketServer } = require("ws");
const {
  emergencyStopPantheon,
  getRuntimeControlState,
  returnToStandby,
  stopPantheon,
} = require("./runtime/runtime-supervisor");
const CONFIG = require("./config");
const { decideApproval } = require("./runtime/approvals");
const { refreshIntegrationHealth } = require("./adapters/registry");
const { getDashboardState } = require("./runtime/state");
const { all, fromJson, get, insertEvent, now, openDatabase, run, seedDatabase, toJson } = require("./db");
const { runOnce, runUntilBlocked } = require("./runtime/orchestrator");
const { generateApprovalPack } = require("./runtime/approval-pack");
const { runMonitorCycle } = require("./runtime/monitor");
const {
  prepareReviewedLiveAiWorkerRetry,
  refreshOutdatedLiveAiWorkerApproval,
  refreshOutdatedLiveAiWorkerApprovals,
  requestLiveAiWorker,
} = require("./runtime/live-ai-workers");
const { prepareProductBuilderAsset } = require("./runtime/product-builder-workspace");
const { requestLiveResearch } = require("./runtime/live-research");
const { decideAgentHandoff, ensureAiTeam, getAgentHandoff } = require("./runtime/ai-team");
const { ensureWorkflowScorecards } = require("./runtime/scorecard");
const { getLiveAiWorkerReadiness } = require("./runtime/live-ai-worker-readiness");
const { getLiveResearchReadiness } = require("./runtime/live-research-readiness");
const {
  ensureAgentWorkbench,
  getAgentWorkbenchState,
  requestAgentWorkbenchLiveComparison,
} = require("./runtime/agent-workbench");
const { getAgentToolGateState } = require("./runtime/agent-tool-gate");
const { ensureAgentTools, getAgentToolPolicyState } = require("./runtime/agent-tools");
const { getAgentOperatingBriefsState } = require("./runtime/agent-operating-briefs");
const { getAgentPlaybooksState } = require("./runtime/agent-playbooks");
const { getAgentModelReadinessState, storedComparisonPackets } = require("./runtime/agent-model-readiness");
const { recordAiPilotReviewDecision } = require("./runtime/ai-pilot-review");
const { createLocalSecurity } = require("./runtime/local-security");
const { recoverSetupBlockedTasks } = require("./runtime/spend-gate");
const {
  ensureWeeklyDigest,
  generateWeeklyDigest,
  getCanonicalOwnerDigest,
} = require("./runtime/executive-digest");
const { ensureActiveVentureCase } = require("./runtime/venture-case");
const { ensureCapabilityAutonomy } = require("./runtime/capability-autonomy");
const { reconcileProviderUsageBatch } = require("./runtime/cost-ledger");
const {
  ensureRetentionPolicy,
  prepareRetentionPolicyDecision,
} = require("./runtime/retention-policy");
const {
  latestAgentRunReceipt,
  verifyAgentRunReceiptChain,
} = require("./runtime/agent-execution-evidence");
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
  getCockpitState,
  getDecisionsState,
  getSystemState,
} = require("./runtime/cockpit-state");
const {
  getCommercialOwnerTestsState,
} = require("./runtime/commercial-owner-state");
const {
  decideCommercialLifecycleApproval,
  hasCommercialLifecycleApprovalPayload,
} = require("./runtime/commercial-lifecycle-decision");
const {
  ensureSchedulerJobs,
  inspectSafeWorkflow,
  runSchedulerJob,
  setSchedulerJobStatus,
  startSchedulerLoop,
  unsafeTaskReason,
} = require("./runtime/scheduler");
const { getOpportunityState } = require("./runtime/pantheon-opportunities");
const {
  ensurePortfolioController,
  getPortfolioState,
} = require("./runtime/portfolio-controller");
const {
  getCommercialConstitution,
  searchCommercialKnowledge,
} = require("./runtime/commercial-knowledge");
const {
  getInvestmentCase,
  listInvestmentCases,
} = require("./runtime/commercial-investment-review");
const {
  getServiceTrialsState,
} = require("./runtime/service-trials");
const { getCapabilityAssuranceState } = require("./runtime/capability-assurance");
const { listVentureKits } = require("./runtime/venture-kit-registry");
const { approveInternalWorkWithinMandate } = require("./runtime/pantheon-policy");
const { getPantheonSupervisorState, runPantheonSupervisorCycle } = require("./runtime/pantheon-supervisor");
const {
  applyPantheonHandoffDecision,
  getProductionState,
} = require("./runtime/pantheon-production");
const {
  getJourneyState,
  isTerminalJourneyStatus,
  journeyById,
} = require("./runtime/pantheon-journey");
const {
  classifyCommercialTaskSafety,
  classifyCommercialWorkflowSafety,
  commercialAuthorityErrorPayload,
  commercialRouteGuard,
  getCommercialAuthorityState,
} = require("./runtime/commercial-authority");

const PUBLIC_DIR = path.join(CONFIG.rootDir, "public");
const MONITOR_JOB_ID = "job-monitor-cycle";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".csv": "text/csv; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".zip": "application/zip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
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
  const canonical = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
  const configuredPackRoot = process.env.PANTHEON_APPROVAL_PACK_DIR
    || process.env.JARVIS_APPROVAL_PACK_DIR
    || null;
  const allowedRoots = [
    path.resolve(CONFIG.artifactRoot),
    path.resolve(CONFIG.rootDir, "output", "pdf"),
    ...(configuredPackRoot ? [path.resolve(configuredPackRoot)] : []),
  ];
  return allowedRoots.some((allowedRoot) => {
    const canonicalRoot = fs.existsSync(allowedRoot)
      ? fs.realpathSync.native(allowedRoot)
      : allowedRoot;
    const relative = path.relative(canonicalRoot, canonical);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  }) ? canonical : null;
}

function serveDeliverableFile(db, res, id, options = {}) {
  const download = options.download === true;
  const deliverable = get(
    db,
    `SELECT id, human_name, format, status, file_path, content_hash, metadata
     FROM deliverables WHERE id = ?`,
    [id],
  );
  if (!deliverable) {
    notFound(res);
    return;
  }
  const format = String(deliverable.format || "").toLowerCase();
  const previewableFormat = format === "pdf"
    || format === "application/pdf"
    || format.startsWith("image/");
  if (!download && !previewableFormat) {
    jsonResponse(res, 415, { error: "Preview is available for PDF and image review outputs only." });
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
  const extension = path.extname(filePath).toLowerCase();
  const previewExtensions = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  const downloadExtensions = new Set([
    ...previewExtensions,
    ".zip",
    ".xlsx",
    ".csv",
    ".txt",
    ".md",
    ".json",
    ".docx",
    ".pptx",
  ]);
  if (!(download ? downloadExtensions : previewExtensions).has(extension)) {
    jsonResponse(res, 415, { error: "This review output format cannot be previewed safely." });
    return;
  }
  if (stats.size > 150 * 1024 * 1024) {
    jsonResponse(res, 413, { error: "This file exceeds Pantheon's 150 MB operator-download limit." });
    return;
  }
  const bytes = fs.readFileSync(filePath);
  const metadata = fromJson(deliverable.metadata, {});
  const expectedHash = String(deliverable.content_hash || metadata.sha256 || "");
  if (download && !/^[a-f0-9]{64}$/i.test(expectedHash)) {
    jsonResponse(res, 409, { error: "This file is not bound to a verified content hash." });
    return;
  }
  if (expectedHash) {
    const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== expectedHash) {
      jsonResponse(res, 409, { error: "This file changed after Pantheon recorded it. Review is required." });
      return;
    }
  }
  const filename = path.basename(filePath).replace(/["\r\n]/g, "");
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[extension] || "application/octet-stream",
    "content-length": bytes.length,
    "content-disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-pantheon-content-hash": expectedHash || "unbound",
  });
  res.end(bytes);
}

function ensureRuntimeFoundation(db) {
  const integrationHealth = refreshIntegrationHealth(db);
  ensureAiTeam(db);
  ensureAgentTools(db);
  const approvalRefresh = refreshOutdatedLiveAiWorkerApprovals(db, {
    trigger: "runtime-startup-policy-refresh",
  });
  const setupRecovery = recoverSetupBlockedTasks(db);
  ensureAgentWorkbench(db);
  ensureSchedulerJobs(db);
  run(
    db,
    `UPDATE scheduler_jobs
     SET status = 'disabled', next_run_at = NULL, updated_at = ?
     WHERE kind = 'pantheon_supervisor'
       AND status <> 'disabled'`,
    [now()],
  );
  ensureWorkflowScorecards(db);
  ensureActiveVentureCase(db);
  ensureCapabilityAutonomy(db);
  ensureWeeklyDigest(db);
  ensureRetentionPolicy(db);
  ensurePortfolioController(db);
  return { integrationHealth, approvalRefresh, setupRecovery };
}

function getMonitoringReadiness(db, runtimeState) {
  const job = get(
    db,
    `SELECT id, name, status, interval_seconds, last_run_at, next_run_at,
            locked_at, lock_owner, updated_at
     FROM scheduler_jobs
     WHERE id = ?`,
    [MONITOR_JOB_ID],
  );
  const latestCompleted = get(
    db,
    `SELECT id, status, severity, finding_count, started_at, completed_at
     FROM monitor_runs
     WHERE completed_at IS NOT NULL
     ORDER BY completed_at DESC, started_at DESC
     LIMIT 1`,
  );
  const latestSchedulerRun = get(
    db,
    `SELECT id, status, started_at, completed_at
     FROM scheduler_runs
     WHERE job_id = ?
     ORDER BY started_at DESC
     LIMIT 1`,
    [MONITOR_JOB_ID],
  );
  const intervalSeconds = Math.max(60, Number(job?.interval_seconds || 15 * 60));
  const pollSeconds = Math.max(10, Math.ceil(Number(runtimeState.schedulerPollMs || CONFIG.schedulerPollMs) / 1000));
  const graceSeconds = Math.max(120, Math.ceil(intervalSeconds / 4), pollSeconds * 2);
  const maxAgeSeconds = intervalSeconds + graceSeconds;
  const currentMs = Date.now();
  const completedMs = Date.parse(latestCompleted?.completed_at || "");
  const nextRunMs = Date.parse(job?.next_run_at || "");
  const runtimeStartedMs = Date.parse(runtimeState.startedAt || "");
  const ageSeconds = Number.isFinite(completedMs)
    ? Math.max(0, Math.floor((currentMs - completedMs) / 1000))
    : null;
  const recent = ageSeconds !== null && ageSeconds <= maxAgeSeconds;
  const scheduleOverdue = Boolean(
    job?.status === "enabled"
      && !job.lock_owner
      && Number.isFinite(nextRunMs)
      && currentMs > nextRunMs + graceSeconds * 1000,
  );
  const latestSchedulerRunFailed = Boolean(
    latestSchedulerRun
      && ["failed", "needs_attention", "abandoned"].includes(latestSchedulerRun.status),
  );
  const currentProcessCheckCompleted = Boolean(
    Number.isFinite(completedMs)
      && Number.isFinite(runtimeStartedMs)
      && completedMs >= runtimeStartedMs,
  );
  const startupCheckCompleted = runtimeState.startupMonitoring.status === "completed"
    || currentProcessCheckCompleted;

  let reason = null;
  if (!runtimeState.schedulerEnabled) reason = "scheduler_disabled";
  else if (!runtimeState.schedulerRunning) reason = "scheduler_not_running";
  else if (!job) reason = "monitor_job_missing";
  else if (job.status !== "enabled") reason = "monitor_job_disabled";
  else if (latestSchedulerRunFailed) reason = "monitor_job_failed";
  else if (!latestCompleted) reason = "monitor_check_pending";
  else if (!startupCheckCompleted) reason = "startup_monitor_incomplete";
  else if (!recent || scheduleOverdue) reason = "monitor_check_overdue";

  return {
    scheduler: {
      enabled: runtimeState.schedulerEnabled,
      running: runtimeState.schedulerRunning,
      pollMs: runtimeState.schedulerPollMs,
    },
    monitoring: {
      ready: reason === null,
      recent,
      overdue: Boolean(latestCompleted && (!recent || scheduleOverdue)),
      reason,
      maxAgeSeconds,
      ageSeconds,
      startup: {
        status: runtimeState.startupMonitoring.status,
        reason: runtimeState.startupMonitoring.reason || null,
        schedulerRunId: runtimeState.startupMonitoring.schedulerRunId || null,
        monitorRunId: runtimeState.startupMonitoring.monitorRunId || null,
        completedAt: runtimeState.startupMonitoring.completedAt || null,
      },
      job: job ? {
        id: job.id,
        name: job.name,
        status: job.status,
        enabled: job.status === "enabled",
        running: Boolean(job.lock_owner),
        intervalSeconds,
        lastRunAt: job.last_run_at,
        nextRunAt: job.next_run_at,
        lockedAt: job.locked_at,
        latestRun: latestSchedulerRun ? {
          id: latestSchedulerRun.id,
          status: latestSchedulerRun.status,
          startedAt: latestSchedulerRun.started_at,
          completedAt: latestSchedulerRun.completed_at,
        } : null,
      } : null,
      latestCompletedCheck: latestCompleted ? {
        id: latestCompleted.id,
        status: latestCompleted.status,
        severity: latestCompleted.severity,
        findingCount: Number(latestCompleted.finding_count || 0),
        startedAt: latestCompleted.started_at,
        completedAt: latestCompleted.completed_at,
      } : null,
    },
  };
}

function selectSafeRuntimeTickTask(db) {
  const candidates = all(
    db,
    `SELECT tasks.*
     FROM tasks
     JOIN workflows ON workflows.id = tasks.workflow_id
     WHERE tasks.status IN ('queued', 'planned')
       AND workflows.status IN ('planned', 'ready', 'agent_running', 'agent_retrying')
     ORDER BY CASE tasks.status WHEN 'queued' THEN 0 ELSE 1 END,
              tasks.priority ASC, tasks.created_at ASC, tasks.id ASC`,
  );
  const rejectedReasons = {};
  for (const task of candidates) {
    const taskReason = unsafeTaskReason(task);
    if (taskReason) {
      rejectedReasons[taskReason] = (rejectedReasons[taskReason] || 0) + 1;
      continue;
    }
    const workflowSafety = inspectSafeWorkflow(db, task.workflow_id);
    if (!workflowSafety.safe) {
      rejectedReasons[workflowSafety.reason] = (rejectedReasons[workflowSafety.reason] || 0) + 1;
      continue;
    }
    const commercialSafety = classifyCommercialTaskSafety(db, task);
    if (!commercialSafety.safe) {
      const reason = commercialSafety.code || commercialSafety.classification || "commercial_authority_required";
      rejectedReasons[reason] = (rejectedReasons[reason] || 0) + 1;
      continue;
    }
    return { task, rejectedReasons };
  }
  return { task: null, rejectedReasons };
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

function sendCommercialGuardFailure(res, assessment) {
  jsonResponse(
    res,
    Number(assessment.statusCode || 409),
    assessment.payload || commercialAuthorityErrorPayload(assessment),
  );
}

function requireCommercialTarget(db, res, target) {
  const assessment = commercialRouteGuard(db, target);
  if (assessment.allowed) return assessment;
  sendCommercialGuardFailure(res, assessment);
  return null;
}

function requireCommercialWorkflowWhenNeeded(db, res, workflowId, options = {}) {
  const safety = classifyCommercialWorkflowSafety(db, workflowId);
  if (safety.safe && !safety.requiresCommercialAuthority && !options.required) {
    return {
      allowed: true,
      code: safety.code,
      workflowSafety: safety,
    };
  }
  if (safety.safe && safety.requiresCommercialAuthority) {
    return {
      allowed: true,
      code: safety.code,
      workflowSafety: safety,
      assessment: safety.assessment,
    };
  }
  const assessment = safety.assessment || commercialRouteGuard(db, { workflowId });
  sendCommercialGuardFailure(res, assessment);
  return null;
}

function requireCommercialTaskWhenNeeded(db, res, task) {
  const safety = classifyCommercialTaskSafety(db, task);
  if (safety.safe) {
    return {
      allowed: true,
      code: safety.code,
      taskSafety: safety,
    };
  }
  const assessment = safety.assessment || commercialRouteGuard(db, { taskId: task.id });
  sendCommercialGuardFailure(res, assessment);
  return null;
}

function retireCommercialRoute(db, res, message) {
  const payload = commercialAuthorityErrorPayload({
    code: "commercial_route_retired",
    message,
    authority: getCommercialAuthorityState(db),
  });
  payload.commercialAuthority.retiredRoute = true;
  jsonResponse(res, 410, payload);
}

function rejectUnboundCommercialRoute(db, res, message) {
  jsonResponse(
    res,
    409,
    commercialAuthorityErrorPayload({
      code: "commercial_binding_required",
      message,
      authority: getCommercialAuthorityState(db),
    }),
  );
}

function createApp(options = {}) {
  const db = options.db || createRuntime(options);
  if (options.db) ensureRuntimeFoundation(db);
  const instanceId = String(
    options.instanceId
      || process.env.PANTHEON_RUNTIME_INSTANCE_ID
      || process.env.JARVIS_RUNTIME_INSTANCE_ID
      || crypto.randomUUID(),
  );
  const workspaceId = crypto.createHash("sha256").update(path.resolve(CONFIG.rootDir)).digest("hex").slice(0, 20);
  const controlToken = String(
    options.controlToken
      || process.env.PANTHEON_CONTROL_TOKEN
      || process.env.JARVIS_CONTROL_TOKEN
      || crypto.randomBytes(32).toString("base64url"),
  );
  const schedulerEnabled = Boolean(options.schedulerEnabled ?? CONFIG.schedulerEnabled);
  const runtimeState = {
    startedAt: now(),
    schedulerEnabled,
    schedulerRunning: false,
    schedulerPollMs: Number(options.scheduler?.pollMs || CONFIG.schedulerPollMs),
    startupMonitoring: {
      status: schedulerEnabled ? "pending" : "disabled",
      reason: schedulerEnabled ? null : "scheduler_disabled",
    },
  };
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
    res.setHeader("x-frame-options", "SAMEORIGIN");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("content-security-policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; frame-src 'self'; form-action 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*");
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
        const monitoringReadiness = getMonitoringReadiness(db, runtimeState);
        const providerProof = get(
          db,
          `SELECT
             SUM(CASE WHEN mode = 'live' AND status = 'completed' AND provider_request_id IS NOT NULL THEN 1 ELSE 0 END) AS completed_calls,
             SUM(CASE WHEN mode = 'live' AND status IN ('failed', 'needs_attention')
                        AND outcome_status <> 'not_started'
                        AND (
                          provider_request_id IS NOT NULL
                          OR json_extract(
                            CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
                            '$.providerResponseReceived'
                          ) = 1
                        )
                      THEN 1 ELSE 0 END) AS failed_calls,
             SUM(CASE WHEN mode = 'live'
                        AND (
                          (status = 'completed' AND provider_request_id IS NOT NULL)
                          OR (
                            status IN ('failed', 'needs_attention')
                            AND outcome_status <> 'not_started'
                            AND (
                              provider_request_id IS NOT NULL
                              OR json_extract(
                                CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,
                                '$.providerResponseReceived'
                              ) = 1
                            )
                          )
                        )
                      THEN 1 ELSE 0 END) AS known_calls
           FROM model_calls`,
        ) || {};
        const runtimeReady = monitoringReadiness.monitoring.ready;
        const payload = {
          alive: true,
          ok: runtimeReady,
          installationReady: null,
          recoveryReady: null,
          runtimeReady,
          readinessScope: "runtime_monitoring",
          operationsReady: runtimeReady,
          operationsReadyAliasFor: "runtimeReady",
          instanceId,
          workspaceId,
          time: now(),
          scheduler: monitoringReadiness.scheduler,
          monitoring: monitoringReadiness.monitoring,
          externalActionsMode: CONFIG.dryRun ? "locked" : "enabled",
          paidAiArmed: Boolean(process.env.OPENAI_API_KEY)
            && (
              process.env.PANTHEON_ENABLE_LIVE_MODELS === "1"
              || process.env.PANTHEON_ENABLE_LIVE_RESEARCH === "1"
              || process.env.JARVIS_ENABLE_LIVE_MODELS === "1"
              || process.env.JARVIS_ENABLE_LIVE_RESEARCH === "1"
            ),
          proofMode: CONFIG.systemProofMode === true,
          providerProof: {
            completedCalls: Number(providerProof.completed_calls || 0),
            failedCalls: Number(providerProof.failed_calls || 0),
            knownCalls: Number(providerProof.known_calls || 0),
            verifiedByPriorCall: Number(providerProof.known_calls || 0) > 0,
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
        const providedControlToken = String(
          req.headers["x-pantheon-control"] || req.headers["x-jarvis-control"] || "",
        );
        if (
          !controlToken
          || providedControlToken.length !== controlToken.length
          || !crypto.timingSafeEqual(Buffer.from(providedControlToken), Buffer.from(controlToken))
        ) {
          jsonResponse(res, 403, { error: "Runtime control token rejected." });
          return;
        }
        server.beginShutdown?.();
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

      if (req.method === "GET" && url.pathname === "/api/runtime/control") {
        jsonResponse(res, 200, getRuntimeControlState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/commercial/authority") {
        jsonResponse(res, 200, {
          schema: "pantheon.commercial-authority-status.v1",
          generatedAt: now(),
          readOnly: true,
          access: {
            mode: security.enabled ? "signed_operator_session" : "local_security_disabled",
            authenticated: true,
            sessionExpiresAt: session?.expiresAt || null,
          },
          authority: getCommercialAuthorityState(db),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/standby") {
        const result = await returnToStandby(db);
        jsonResponse(res, 202, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/stop") {
        const result = await stopPantheon(db);
        jsonResponse(res, 202, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/emergency-stop") {
        const body = await readBody(req);
        if (body.confirm !== "STOP PANTHEON NOW") {
          jsonResponse(res, 400, { error: "Emergency stop needs the exact confirmation phrase." });
          return;
        }
        const result = await emergencyStopPantheon(db);
        jsonResponse(res, 202, result);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/cockpit") {
        jsonResponse(res, 200, getCockpitState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/opportunities") {
        jsonResponse(res, 200, getOpportunityState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/portfolio") {
        jsonResponse(res, 200, getPortfolioState(db));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/portfolio/discovery") {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Portfolio discovery cannot create unbound commercial work. Prepare and accept an exact v2 program first.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/portfolio/targeted-review") {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Targeted investment review cannot create unbound commercial work. Prepare and accept an exact v2 program first.",
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/commercial/constitution") {
        jsonResponse(res, 200, getCommercialConstitution());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/commercial/knowledge") {
        const query = url.searchParams.get("query") || "";
        if (!query.trim()) {
          jsonResponse(res, 400, { error: "A focused commercial knowledge query is required." });
          return;
        }
        jsonResponse(res, 200, {
          query,
          results: searchCommercialKnowledge(db, {
            query,
            domains: url.searchParams.getAll("domain"),
            classes: url.searchParams.getAll("class"),
            jurisdiction: url.searchParams.get("jurisdiction") || "Australia",
            limit: url.searchParams.get("limit") || 8,
          }),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/commercial/investment-cases") {
        jsonResponse(res, 200, { cases: listInvestmentCases(db) });
        return;
      }

      const investmentCaseDetail = routeMatch(url.pathname, "/api/commercial/investment-cases/:id");
      if (req.method === "GET" && investmentCaseDetail) {
        const result = getInvestmentCase(db, investmentCaseDetail.id);
        if (!result) notFound(res);
        else {
          jsonResponse(res, 200, {
            ...result,
            buyerIntentOption: null,
            canonicalTestContract: "pantheon.commercial-test-contract.v2",
          });
        }
        return;
      }

      const prepareBuyerIntent = routeMatch(
        url.pathname,
        "/api/commercial/investment-cases/:id/prepare-buyer-intent-test",
      );
      if (req.method === "POST" && prepareBuyerIntent) {
        retireCommercialRoute(
          db,
          res,
          "The v1 buyer-intent preparation path is retired. A validated v2 contract proposal and exact owner lifecycle decision are required.",
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/commercial/service-trials") {
        jsonResponse(res, 200, getServiceTrialsState(db));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/commercial/service-trials") {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Service trials are not yet bound to the immutable commercial program ledger.",
        );
        return;
      }

      const serviceTrialApprove = routeMatch(url.pathname, "/api/commercial/service-trials/:id/approve");
      if (req.method === "POST" && serviceTrialApprove) {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Service-trial approval cannot rely on client-supplied readiness flags; this trial needs an exact ledger binding.",
        );
        return;
      }

      const serviceTrialStart = routeMatch(url.pathname, "/api/commercial/service-trials/:id/start");
      if (req.method === "POST" && serviceTrialStart) {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Service-trial start is blocked until the trial is bound to the accepted active commercial program.",
        );
        return;
      }

      const serviceTrialComplete = routeMatch(url.pathname, "/api/commercial/service-trials/:id/complete");
      if (req.method === "POST" && serviceTrialComplete) {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Service-trial completion is blocked until the trial has an exact immutable commercial binding.",
        );
        return;
      }

      const serviceTrialDecision = routeMatch(url.pathname, "/api/commercial/service-trials/:id/decision");
      if (req.method === "POST" && serviceTrialDecision) {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Service-retention decisions are blocked until the trial has an exact immutable commercial binding.",
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/system/capability-assurance") {
        jsonResponse(res, 200, getCapabilityAssuranceState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/venture-kits") {
        jsonResponse(res, 200, { kits: listVentureKits(db) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/pantheon") {
        jsonResponse(res, 200, getPantheonSupervisorState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/journey") {
        jsonResponse(res, 200, getJourneyState(db, url.searchParams.get("id")));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/production") {
        jsonResponse(res, 200, getProductionState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/ventures") {
        jsonResponse(res, 200, {
          ventures: all(
            db,
            `SELECT id, name, lifecycle_stage, is_active, business_model
             FROM ventures
             WHERE COALESCE(json_extract(metadata, '$.visibleInVentureSelector'), 1) <> 0
             ORDER BY is_active DESC, name ASC`,
          ),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/executive-digest") {
        jsonResponse(res, 200, { digest: getCanonicalOwnerDigest(db) });
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
        jsonResponse(res, 200, getCommercialOwnerTestsState(db));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/gumroad/sales") {
        retireCommercialRoute(
          db,
          res,
          "Legacy Gumroad sales rows are historical context only. Use a contract-bound verified v2 adapter receipt.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/gumroad/import") {
        retireCommercialRoute(
          db,
          res,
          "The legacy Gumroad importer is not an authoritative v2 evidence route. Use contract-bound evidence import.",
        );
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

      if (req.method === "POST" && url.pathname === "/api/system/retention/prepare-decision") {
        const result = prepareRetentionPolicyDecision(db);
        if (!result.prepared) {
          jsonResponse(res, 409, { error: result.reason, result });
          return;
        }
        broadcastState();
        jsonResponse(res, 201, { result, decisions: getDecisionsState(db) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/system/audit/verify") {
        jsonResponse(res, 200, verifyAgentRunReceiptChain(db));
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
        jsonResponse(res, 410, {
          error: "The legacy test detail endpoint is retired. Use the read-only Tests & Results view.",
        });
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

      const agentRunReceipt = routeMatch(url.pathname, "/api/agent-runs/:id/receipt");
      if (req.method === "GET" && agentRunReceipt) {
        const result = latestAgentRunReceipt(db, agentRunReceipt.id);
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
        jsonResponse(res, 410, {
          error: "The legacy decision inbox is retired. Use the focused Decisions and Tests & Results views.",
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/manual-market-cockpit") {
        jsonResponse(res, 410, {
          error: "The manual market cockpit is retired because its legacy rows are not authoritative buyer or cash evidence.",
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
        retireCommercialRoute(
          db,
          res,
          "Caller-defined model-comparison creation is retired because it cannot carry one exact accepted commercial contract through every new record.",
        );
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
        retireCommercialRoute(
          db,
          res,
          "Caller-defined playbook suites are retired because they could create commercial workflows and tasks without an exact accepted contract.",
        );
        return;
      }

      const agentPlaybookRehearsal = routeMatch(url.pathname, "/api/agent-playbooks/:id/rehearsal");
      if (req.method === "POST" && agentPlaybookRehearsal) {
        retireCommercialRoute(
          db,
          res,
          "Caller-defined playbook rehearsal creation is retired because it cannot preserve an exact commercial contract through every new record.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/agent-workbench/proof-suite") {
        retireCommercialRoute(
          db,
          res,
          "Caller-defined Workbench proof suites are retired because they could create unbound commercial work.",
        );
        return;
      }
      const agentLiveComparison = routeMatch(url.pathname, "/api/agent-workbench/:id/live-comparison");
      if (req.method === "POST" && agentLiveComparison) {
        const body = await readBody(req);
        if (!requireCommercialWorkflowWhenNeeded(db, res, agentLiveComparison.id, { required: true })) return;
        const result = requestAgentWorkbenchLiveComparison(db, agentLiveComparison.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }
      const agentProofRun = routeMatch(url.pathname, "/api/agent-workbench/:id/proof-run");
      if (req.method === "POST" && agentProofRun) {
        retireCommercialRoute(
          db,
          res,
          "Caller-defined Workbench proof creation is retired because it cannot bind every new record to one exact accepted commercial contract.",
        );
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
      const deliverableDownload = routeMatch(url.pathname, "/api/deliverables/:id/download");
      if (req.method === "GET" && deliverableDownload) {
        serveDeliverableFile(db, res, deliverableDownload.id, { download: true });
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
        const limit = Math.max(1, Math.min(Number(body.limit || 2), 10));
        const dueJobs = all(
          db,
          `SELECT id, kind
           FROM scheduler_jobs
           WHERE status = 'enabled'
             AND locked_at IS NULL
             AND (next_run_at IS NULL OR next_run_at <= ?)
           ORDER BY priority ASC, next_run_at ASC
           LIMIT ?`,
          [now(), limit],
        );
        const runs = [];
        for (const job of dueJobs) {
          if (job.kind === "pantheon_supervisor") {
            runs.push({
              id: null,
              jobId: job.id,
              status: "skipped",
              result: {
                status: "safety_blocked",
                reason: "exact_commercial_workflow_not_selected",
              },
            });
            continue;
          }
          if (job.kind === "safe_work_loop") {
            const selection = selectSafeRuntimeTickTask(db);
            if (!selection.task) {
              runs.push({
                id: null,
                jobId: job.id,
                status: "skipped",
                result: {
                  status: "idle",
                  reason: "no_safe_internal_task",
                  rejectedReasons: selection.rejectedReasons,
                },
              });
              continue;
            }
            runs.push(await runSchedulerJob(db, job.id, {
              workflowId: selection.task.workflow_id,
              maxSteps: body.maxSteps,
            }));
            continue;
          }
          runs.push(await runSchedulerJob(db, job.id));
        }
        const result = {
          status: "completed",
          dueCount: dueJobs.length,
          claimedCount: runs.filter((item) => item.status !== "skipped").length,
          runs,
        };
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const schedulerJobRun = routeMatch(url.pathname, "/api/scheduler/jobs/:id/run");
      if (req.method === "POST" && schedulerJobRun) {
        const body = await readBody(req);
        const job = get(db, "SELECT id, kind FROM scheduler_jobs WHERE id = ?", [schedulerJobRun.id]);
        if (!job) {
          jsonResponse(res, 404, { error: "Scheduler job not found." });
          return;
        }
        if (job.kind === "pantheon_supervisor") {
          rejectUnboundCommercialRoute(
            db,
            res,
            "The unscoped commercial supervisor job is disabled. Use one exact contract-bound workflow.",
          );
          return;
        }
        let workflowId = body.workflowId || body.workflow_id || null;
        if (job.kind === "safe_work_loop") {
          if (workflowId) {
            if (!requireCommercialWorkflowWhenNeeded(db, res, workflowId)) return;
          } else {
            const selection = selectSafeRuntimeTickTask(db);
            if (!selection.task) {
              jsonResponse(res, 200, {
                result: {
                  status: "idle",
                  reason: "no_safe_internal_task",
                  rejectedReasons: selection.rejectedReasons,
                },
              });
              return;
            }
            workflowId = selection.task.workflow_id;
          }
        }
        const result = await runSchedulerJob(db, schedulerJobRun.id, {
          manual: true,
          force: body.force === true,
          maxSteps: body.maxSteps,
          workflowId,
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
        const job = get(db, "SELECT id, kind FROM scheduler_jobs WHERE id = ?", [schedulerJobAction.id]);
        if (!job) {
          jsonResponse(res, 404, { error: "Scheduler job not found." });
          return;
        }
        if (job.kind === "pantheon_supervisor" && status === "enabled") {
          rejectUnboundCommercialRoute(
            db,
            res,
            "The unscoped commercial supervisor cannot be enabled. Commercial runs must name one exact bound workflow.",
          );
          return;
        }
        const updatedJob = setSchedulerJobStatus(db, schedulerJobAction.id, status);
        broadcastState();
        jsonResponse(res, 200, { job: updatedJob });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/commands") {
        retireCommercialRoute(
          db,
          res,
          "The generic command-to-work route is permanently retired. Use an exact accepted commercial program or a protected system proof.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/pantheon/discovery") {
        retireCommercialRoute(
          db,
          res,
          "The unbound discovery route is permanently retired. New commercial discovery must begin inside an exact accepted program.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/pantheon/journeys") {
        rejectUnboundCommercialRoute(
          db,
          res,
          "Broad commercial journeys cannot be created outside the one exact accepted and activated program.",
        );
        return;
      }

      const journeyContinue = routeMatch(url.pathname, "/api/pantheon/journeys/:id/continue");
      if (req.method === "POST" && journeyContinue) {
        const journey = journeyById(db, journeyContinue.id);
        if (!journey) {
          jsonResponse(res, 404, { error: "This Pantheon journey was not found." });
          return;
        }
        if (!requireCommercialWorkflowWhenNeeded(db, res, journey.workflow_id, { required: true })) return;
        if (isTerminalJourneyStatus(journey.status)) {
          const payload = commercialAuthorityErrorPayload({
            code: "commercial_program_terminal",
            message: "This commercial journey is permanently finished and cannot be continued.",
            authority: getCommercialAuthorityState(db),
          });
          payload.state = getJourneyState(db, journey.id);
          jsonResponse(res, 410, payload);
          return;
        }
        const result = await runPantheonSupervisorCycle(db, {
          triggerType: "manual",
          triggerId: journey.id,
          startedBy: "dashboard-full-journey",
          workflowId: journey.workflow_id,
          ventureId: journey.venture_id,
          maxSteps: 2,
        });
        broadcastState();
        jsonResponse(res, 200, { result, state: getJourneyState(db, journey.id) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/pantheon/run") {
        const body = await readBody(req);
        if (body.startDiscovery === true) {
          rejectUnboundCommercialRoute(
            db,
            res,
            "Pantheon cannot start unbound discovery. Accept and activate an exact commercial program first.",
          );
          return;
        }
        const workflowId = body.workflowId || body.workflow_id || null;
        if (!workflowId) {
          jsonResponse(res, 200, {
            result: {
              status: "idle",
              reason: "exact_commercial_workflow_not_selected",
              message: "No exact accepted commercial workflow was selected, so Pantheon made no changes.",
            },
          });
          return;
        }
        if (!requireCommercialWorkflowWhenNeeded(db, res, workflowId, { required: true })) return;
        const result = await runPantheonSupervisorCycle(db, {
          triggerType: "manual",
          startedBy: "dashboard",
          maxSteps: body.maxSteps || 4,
          allowDiscoveryStart: false,
          prompt: body.prompt,
          workflowId,
        });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/tick") {
        const selection = selectSafeRuntimeTickTask(db);
        const result = selection.task
          ? await runOnce(db, {
            taskId: selection.task.id,
            workflowId: selection.task.workflow_id,
            claimant: "runtime_tick_protected",
          })
          : {
            status: "idle",
            reason: "no_safe_internal_task",
            message: "No strictly protected internal work is ready to run.",
            rejectedReasons: selection.rejectedReasons,
          };
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const taskRun = routeMatch(url.pathname, "/api/tasks/:id/run");
      if (req.method === "POST" && taskRun) {
        const task = get(db, "SELECT * FROM tasks WHERE id = ?", [taskRun.id]);
        if (!task) {
          jsonResponse(res, 404, { error: "Work item not found." });
          return;
        }
        if (!requireCommercialTaskWhenNeeded(db, res, task)) return;
        const result = await runOnce(db, { taskId: taskRun.id, workflowId: task.workflow_id, claimant: "dashboard_exact_task" });
        const parameters = fromJson(task.payload, {}).liveSpendRequest?.parameters || {};
        const supervisorOwned = parameters.pantheonCommercial?.supervisorOwned === true
          || parameters.pantheonProduction?.supervisorOwned === true;
        const continuation = result.status === "completed" && supervisorOwned
          ? await runPantheonSupervisorCycle(db, {
            triggerType: "manual",
            triggerId: task.id,
            startedBy: "dashboard_exact_task",
            workflowId: task.workflow_id,
            maxSteps: 1,
          })
          : null;
        broadcastState();
        jsonResponse(res, 200, { result, continuation });
        return;
      }

      const taskKnownRetry = routeMatch(url.pathname, "/api/tasks/:id/prepare-known-ai-retry");
      if (req.method === "POST" && taskKnownRetry) {
        const task = get(db, "SELECT * FROM tasks WHERE id = ?", [taskKnownRetry.id]);
        if (!task) {
          jsonResponse(res, 404, { error: "Work item not found." });
          return;
        }
        if (!requireCommercialTaskWhenNeeded(db, res, task)) return;
        const result = prepareReviewedLiveAiWorkerRetry(db, taskKnownRetry.id, {
          proofMode: CONFIG.systemProofMode === true,
        });
        const commercial = result.task?.payload?.liveSpendRequest?.parameters?.pantheonCommercial;
        if (commercial?.supervisorOwned === true && result.approval?.id) {
          result.mandate = approveInternalWorkWithinMandate(db, result.approval.id);
        }
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runtime/run-until-blocked") {
        retireCommercialRoute(
          db,
          res,
          "The global run-until-blocked route is permanently retired. Run one exact protected workflow instead.",
        );
        return;
      }

      const workflowRun = routeMatch(url.pathname, "/api/workflows/:id/run");
      if (req.method === "POST" && workflowRun) {
        if (!requireCommercialWorkflowWhenNeeded(db, res, workflowRun.id)) return;
        const result = await runOnce(db, { workflowId: workflowRun.id });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const workflowRunUntilBlocked = routeMatch(url.pathname, "/api/workflows/:id/run-until-blocked");
      if (req.method === "POST" && workflowRunUntilBlocked) {
        const body = await readBody(req);
        if (!requireCommercialWorkflowWhenNeeded(db, res, workflowRunUntilBlocked.id)) return;
        const result = await runUntilBlocked(db, { workflowId: workflowRunUntilBlocked.id, maxSteps: body.maxSteps });
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const approvalPack = routeMatch(url.pathname, "/api/workflows/:id/approval-pack");
      if (req.method === "POST" && approvalPack) {
        if (!requireCommercialWorkflowWhenNeeded(db, res, approvalPack.id)) return;
        const result = generateApprovalPack(db, approvalPack.id);
        broadcastState();
        jsonResponse(res, 200, { result });
        return;
      }

      const liveResearchRequest = routeMatch(url.pathname, "/api/workflows/:id/request-live-research");
      if (req.method === "POST" && liveResearchRequest) {
        const body = await readBody(req);
        if (!requireCommercialWorkflowWhenNeeded(db, res, liveResearchRequest.id)) return;
        const result = requestLiveResearch(db, liveResearchRequest.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/live-research/smoke-test") {
        retireCommercialRoute(
          db,
          res,
          "The caller-defined live-research smoke route is permanently retired because it could create unbound commercial work, approvals, and cost reservations.",
        );
        return;
      }

      const liveAiWorkerRequest = routeMatch(url.pathname, "/api/workflows/:id/request-live-ai-worker");
      if (req.method === "POST" && liveAiWorkerRequest) {
        const body = await readBody(req);
        if (!requireCommercialWorkflowWhenNeeded(db, res, liveAiWorkerRequest.id)) return;
        const result = requestLiveAiWorker(db, liveAiWorkerRequest.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }

      const productBuilderAsset = routeMatch(url.pathname, "/api/workflows/:id/product-builder/prepare-asset");
      if (req.method === "POST" && productBuilderAsset) {
        const body = await readBody(req);
        if (!requireCommercialWorkflowWhenNeeded(db, res, productBuilderAsset.id)) return;
        const result = prepareProductBuilderAsset(db, productBuilderAsset.id, body || {});
        broadcastState();
        jsonResponse(res, 202, { result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/live-ai-workers/smoke-test") {
        retireCommercialRoute(
          db,
          res,
          "The caller-defined live-AI smoke route is permanently retired because it could create unbound commercial work, approvals, and cost reservations.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/commercial/experiments") {
        retireCommercialRoute(
          db,
          res,
          "Legacy commercial experiments cannot represent the immutable v2 offer, cohort, channel, attribution, cash, and evidence contract.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/research-to-experiment/plans") {
        retireCommercialRoute(
          db,
          res,
          "Legacy research-to-experiment plans are retired. Research now produces a non-executable v2 contract proposal that requires a separate owner decision.",
        );
        return;
      }

      const promoteTestCandidate = routeMatch(url.pathname, "/api/research-to-experiment/candidates/:id/promote");
      if (req.method === "POST" && promoteTestCandidate) {
        retireCommercialRoute(
          db,
          res,
          "Legacy test-candidate promotion is retired. A validated immutable v2 contract and exact approval lifecycle are required.",
        );
        return;
      }

      const learningRevisionPlan = routeMatch(url.pathname, "/api/commercial/learning/:id/revision-plan");
      if (req.method === "POST" && learningRevisionPlan) {
        retireCommercialRoute(
          db,
          res,
          "Legacy learning revisions cannot mutate or replace an immutable v2 commercial test decision.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/execution-packs") {
        retireCommercialRoute(
          db,
          res,
          "Legacy execution packs are retired because they do not preserve the immutable v2 offer, channel, attribution, and evidence binding.",
        );
        return;
      }

      const executionPackOutcome = routeMatch(url.pathname, "/api/execution-packs/:id/outcomes");
      if (req.method === "POST" && executionPackOutcome) {
        retireCommercialRoute(
          db,
          res,
          "Legacy execution-pack outcomes are not authoritative buyer or cash evidence and are permanently read-only.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/commercial/results") {
        retireCommercialRoute(
          db,
          res,
          "Legacy commercial results are not authoritative v2 buyer, settlement, cost, attribution, or cash evidence.",
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/commercial/feedback") {
        retireCommercialRoute(
          db,
          res,
          "Legacy commercial feedback writes are retired. Learning must be derived from the complete canonical v2 ledger.",
        );
        return;
      }

      const approvalAction = routeMatch(url.pathname, "/api/approval-actions/:token");
      if (approvalAction && ["GET", "POST"].includes(req.method)) {
        jsonResponse(res, 410, {
          error: "Email action links are disabled until a signed provider webhook is connected. Use Decisions in Pantheon.",
        });
        return;
      }

      const commercialLifecycleDecision = routeMatch(
        url.pathname,
        "/api/commercial/lifecycle-decisions/:id/:decision",
      );
      if (req.method === "POST" && commercialLifecycleDecision) {
        const body = await readBody(req);
        const result = decideCommercialLifecycleApproval(
          db,
          commercialLifecycleDecision.id,
          commercialLifecycleDecision.decision,
          body.note || "",
          {
            expectedScopeHash: body.scopeHash,
            actor: "operator",
          },
        );
        broadcastState();
        jsonResponse(res, 200, {
          result,
          tests: getCommercialOwnerTestsState(db),
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
        const approvalRecord = get(
          db,
          "SELECT payload FROM approvals WHERE id = ?",
          [approvalDecision.id],
        );
        if (approvalRecord && hasCommercialLifecycleApprovalPayload(approvalRecord)) {
          jsonResponse(res, 409, {
            code: "commercial_lifecycle_decision_required",
            error: "Use the exact commercial lifecycle decision control for this test.",
          });
          return;
        }
        const approvalTask = get(
          db,
          `SELECT tasks.*
           FROM tasks
           WHERE tasks.approval_id = ?
           ORDER BY tasks.created_at DESC
           LIMIT 1`,
          [approvalDecision.id],
        );
        if (approvalTask && !requireCommercialTaskWhenNeeded(db, res, approvalTask)) return;
        let result;
        try {
          result = decideApproval(db, approvalDecision.id, decision, body.note || "", { expectedScopeHash: body.scopeHash });
        } catch (error) {
          const refreshed = refreshOutdatedLiveAiWorkerApproval(db, approvalDecision.id, {
            trigger: "dashboard-policy-refresh",
          });
          if (refreshed?.refreshed) {
            broadcastState();
            jsonResponse(res, 409, {
              code: "approval_refreshed",
              error: "The AI check details changed before work began, so Pantheon prepared a fresh decision. Nothing ran and there was no cost. Review the updated details, then choose whether to start it.",
              result: refreshed,
            });
            return;
          }
          throw error;
        }
        const execution = decision === "approved" && result.changed && result.approvedTaskIds?.length
          ? await runOnce(db, { taskId: result.approvedTaskIds[0], claimant: "dashboard_approval" })
          : null;
        const approvedTask = result.approvedTaskIds?.length
          ? get(db, "SELECT payload, workflow_id, venture_id FROM tasks WHERE id = ?", [result.approvedTaskIds[0]])
          : null;
        const approvedPayload = fromJson(approvedTask?.payload, {});
        const isPantheonWork = Boolean(
          approvedPayload.liveSpendRequest?.parameters?.pantheonCommercial
          || approvedPayload.liveSpendRequest?.parameters?.pantheonProduction,
        );
        const pantheonContinuation = decision === "approved"
          && execution
          && isPantheonWork
          ? await runPantheonSupervisorCycle(db, {
            triggerType: "operator_approval",
            triggerId: approvalDecision.id,
            startedBy: "dashboard",
            workflowId: approvedTask.workflow_id,
            ventureId: approvedTask.venture_id,
            maxSteps: 10,
          })
          : null;
        const recovery = decision === "approved" && execution?.status === "completed"
          ? recoverSetupBlockedTasks(db)
          : null;
        broadcastState();
        jsonResponse(res, 200, { result, execution, pantheonContinuation, recovery });
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
        const existingHandoff = getAgentHandoff(db, handoffDecision.id);
        if (!existingHandoff) {
          jsonResponse(res, 404, { error: "Worker handoff not found." });
          return;
        }
        const handoffWorkflowSafety = existingHandoff.workflow_id
          ? classifyCommercialWorkflowSafety(db, existingHandoff.workflow_id)
          : null;
        if (decision === "approve" && handoffWorkflowSafety) {
          const authorizedCommercial = Boolean(
            handoffWorkflowSafety.safe
            && handoffWorkflowSafety.requiresCommercialAuthority
            && handoffWorkflowSafety.classification === "authorized_commercial",
          );
          const allowedNonCommercial = Boolean(
            handoffWorkflowSafety.safe
            && !handoffWorkflowSafety.requiresCommercialAuthority
            && ["non_commercial", "diagnostic"].includes(
              handoffWorkflowSafety.classification,
            ),
          );
          if (!authorizedCommercial && !allowedNonCommercial) {
            const assessment = handoffWorkflowSafety.assessment
              || handoffWorkflowSafety;
            sendCommercialGuardFailure(res, assessment);
            return;
          }
        }
        if (decision === "approve" && existingHandoff.task_id) {
          const handoffTaskSafety = classifyCommercialTaskSafety(
            db,
            existingHandoff.task_id,
          );
          const authorizedCommercialTask = Boolean(
            handoffTaskSafety.safe
            && handoffTaskSafety.requiresCommercialAuthority
            && handoffTaskSafety.classification === "authorized_commercial",
          );
          const allowedNonCommercialTask = Boolean(
            handoffTaskSafety.safe
            && !handoffTaskSafety.requiresCommercialAuthority
            && ["non_commercial", "diagnostic"].includes(
              handoffTaskSafety.classification,
            ),
          );
          if (!authorizedCommercialTask && !allowedNonCommercialTask) {
            const assessment = handoffTaskSafety.assessment
              || handoffTaskSafety;
            sendCommercialGuardFailure(res, assessment);
            return;
          }
        }
        const pantheonAction = existingHandoff?.metadata?.pantheonProduction?.action || null;
        const result = decideAgentHandoff(db, handoffDecision.id, decision, body.note || "", {
          decidedBy: body.decidedBy || "operator",
          skipFollowupTask: Boolean(pantheonAction),
        });
        const pantheonDecision = pantheonAction
          ? applyPantheonHandoffDecision(db, result.handoff, decision, body.note || "")
          : null;
        const execution = decision === "approve" && result.followupTask?.id
          ? await runOnce(db, { taskId: result.followupTask.id, claimant: "dashboard_handoff_approval" })
          : null;
        broadcastState();
        jsonResponse(res, 200, { result, pantheonDecision, execution });
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
      if (Number(error.statusCode) >= 400 && Number(error.statusCode) < 500) {
        if (error.assessment) {
          jsonResponse(
            res,
            Number(error.statusCode),
            commercialAuthorityErrorPayload(error),
          );
          return;
        }
        jsonResponse(res, Number(error.statusCode), {
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
        });
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
      jsonResponse(res, 500, { error: "Pantheon could not complete that request. Check System activity for the recorded error.", requestId });
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
      sections: ["cockpit", "opportunities", "decisions", "tests", "ai-team", "system"],
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

  let shutdownPromise = null;
  server.beginShutdown = () => {
    server.schedulerLoop?.stop?.();
    runtimeState.schedulerRunning = false;
    runtimeState.shuttingDown = true;
  };
  server.shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    server.beginShutdown();
    shutdownPromise = (async () => {
      await server.schedulerLoop?.drain?.();
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => {
        const finish = () => {
          if (!options.db) db.close();
          resolve();
        };
        wss.close(() => {
          if (server.listening) server.close(finish);
          else finish();
        });
      });
    })();
    return shutdownPromise;
  };

  server.runtimeState = runtimeState;
  return { server, db, wss, security, instanceId, workspaceId, runtimeState };
}

function startServer(options = {}) {
  const app = createApp(options);
  const port = options.port ?? CONFIG.port;
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    app.server.once("error", onError);
    app.server.listen(port, "127.0.0.1", async () => {
      app.server.off("error", onError);
      const address = app.server.address();
      const url = `http://127.0.0.1:${address.port}`;
      let schedulerLoop = null;
      if (app.runtimeState.schedulerEnabled) {
        try {
          schedulerLoop = startSchedulerLoop(app.db, options.scheduler || {});
          app.runtimeState.schedulerRunning = true;
          app.runtimeState.schedulerPollMs = schedulerLoop.pollMs;
        } catch (error) {
          app.runtimeState.schedulerRunning = false;
          console.error(`Pantheon scheduler could not start: ${error.message}`);
        }
      }
      app.server.schedulerLoop = schedulerLoop;
      console.log(`Pantheon Control running at ${url}`);
      if (schedulerLoop) console.log(`Pantheon scheduler polling every ${schedulerLoop.pollMs}ms`);

      if (app.runtimeState.schedulerEnabled) {
        const monitorJob = get(app.db, "SELECT status FROM scheduler_jobs WHERE id = ?", [MONITOR_JOB_ID]);
        if (!monitorJob || monitorJob.status !== "enabled") {
          app.runtimeState.startupMonitoring = {
            status: "disabled",
            reason: monitorJob ? "monitor_job_disabled" : "monitor_job_missing",
            completedAt: now(),
          };
          console.error("Pantheon independent monitoring is disabled; operations readiness is not satisfied.");
        } else {
          app.runtimeState.startupMonitoring = { status: "running", reason: null };
          try {
            const startupRun = await runSchedulerJob(app.db, MONITOR_JOB_ID, {
              manual: true,
              actor: "server-startup",
            });
            app.runtimeState.startupMonitoring = {
              status: startupRun.status,
              reason: startupRun.status === "completed"
                ? null
                : startupRun.result?.reason || startupRun.error || "monitor_startup_failed",
              schedulerRunId: startupRun.id || null,
              monitorRunId: startupRun.result?.monitorRunId || null,
              completedAt: now(),
            };
            if (startupRun.status === "completed") {
              console.log("Pantheon startup monitor cycle completed.");
            } else {
              console.error(`Pantheon startup monitor did not complete: ${app.runtimeState.startupMonitoring.reason}`);
            }
          } catch (error) {
            app.runtimeState.startupMonitoring = {
              status: "failed",
              reason: "monitor_startup_failed",
              completedAt: now(),
            };
            console.error(`Pantheon startup monitor failed: ${error.message}`);
          }
        }
      }
      resolve({ ...app, url, schedulerLoop });
    });
  });
}

if (require.main === module) {
  const bootstrapSecret = process.env.PANTHEON_OPERATOR_BOOTSTRAP
    || process.env.JARVIS_OPERATOR_BOOTSTRAP
    || crypto.randomBytes(32).toString("base64url");
  process.env.PANTHEON_OPERATOR_BOOTSTRAP = bootstrapSecret;
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
