const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CONFIG = require("../src/config");
const { runLiveAiWorkerTask } = require("../src/adapters/live-ai-worker");
const {
  MAX_OPENAI_ERROR_CHARACTERS,
  MAX_OPENAI_RESPONSE_BYTES,
  OFFICIAL_OPENAI_API_BASE_URL,
  OFFICIAL_OPENAI_RESPONSES_URL,
  inspectOpenAiEgressPolicy,
} = require("../src/adapters/openai-egress-policy");
const { refreshIntegrationHealth } = require("../src/adapters/registry");
const { runResearchTask } = require("../src/adapters/research");
const { all, fromJson, get, now, openDatabase, run, seedDatabase, toJson } = require("../src/db");
const {
  __classifySdkRunErrorForTests,
  __createSecureOpenAiClientForTests,
} = require("../src/runtime/agent-runtime");
const { monthlyBudgetExposure, reserveBudget } = require("../src/runtime/cost-ledger");
const { getLiveResearchReadiness } = require("../src/runtime/live-research-readiness");
const { operatingMandateState } = require("../src/runtime/pantheon-policy");
const { createCommandPlan } = require("../src/runtime/planner");
const { missingPreflightRequirements } = require("../src/runtime/spend-gate");
const { spendCostId } = require("../src/runtime/stable-id");

const MANAGED_ENVIRONMENT = [
  "JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER",
  "JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER",
  "JARVIS_ENABLE_LIVE_MODELS",
  "JARVIS_ENABLE_LIVE_RESEARCH",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_RESPONSES_URL",
  "PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER",
  "PANTHEON_DISABLE_LIVE_RESEARCH_ADAPTER",
  "PANTHEON_ENABLE_LIVE_MODELS",
  "PANTHEON_ENABLE_LIVE_RESEARCH",
];

function snapshotEnvironment() {
  return Object.fromEntries(MANAGED_ENVIRONMENT.map((name) => [name, process.env[name]]));
}

function restoreEnvironment(snapshot) {
  for (const name of MANAGED_ENVIRONMENT) {
    if (snapshot[name] === undefined) delete process.env[name];
    else process.env[name] = snapshot[name];
  }
}

function enableTestProviders() {
  process.env.OPENAI_API_KEY = "test-only-openai-egress-key";
  process.env.PANTHEON_ENABLE_LIVE_MODELS = "1";
  process.env.PANTHEON_ENABLE_LIVE_RESEARCH = "1";
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_RESPONSES_URL;
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  delete process.env.PANTHEON_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.PANTHEON_DISABLE_LIVE_RESEARCH_ADAPTER;
  delete process.env.JARVIS_DISABLE_LIVE_AI_WORKER_ADAPTER;
  delete process.env.JARVIS_DISABLE_LIVE_RESEARCH_ADAPTER;
}

function seededDb(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-openai-egress-${name}-`));
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db, { includeDemoProof: true });
  return db;
}

function researchContext(db, suffix) {
  const planned = createCommandPlan(db, {
    text: `Evaluate a bounded digital-product opportunity for the OpenAI egress ${suffix} proof.`,
    source: "openai-egress-security-test",
    createFiles: false,
  });
  const workflowRow = get(db, "SELECT * FROM workflows WHERE id = ?", [planned.workflow.id]);
  const taskRow = get(
    db,
    "SELECT * FROM tasks WHERE workflow_id = ? AND kind = 'market_research' ORDER BY priority LIMIT 1",
    [planned.workflow.id],
  );
  const command = get(db, "SELECT * FROM commands WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1", [planned.workflow.id]);
  return {
    command,
    task: { ...taskRow, payload: fromJson(taskRow.payload), result: fromJson(taskRow.result) },
    workflow: { ...workflowRow, metadata: fromJson(workflowRow.metadata) },
  };
}

function outboundRowsForTask(db, taskId) {
  return {
    costs: get(db, "SELECT COUNT(*) AS count FROM costs WHERE task_id = ?", [taskId]).count,
    modelCalls: get(db, "SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ?", [taskId]).count,
    researchRuns: get(db, "SELECT COUNT(*) AS count FROM research_runs WHERE task_id = ?", [taskId]).count,
  };
}

function reserveTaskCost(db, task, amountCents = Number(task.cost_budget_cents || 60)) {
  run(
    db,
    `INSERT INTO costs
     (id, workflow_id, venture_id, task_id, category, source, status, amount_cents, currency, occurred_at, metadata)
     VALUES (?, ?, ?, ?, 'live_research', 'openai-security-test', 'reserved', ?, 'AUD', ?, ?)`,
    [
      spendCostId(task.id),
      task.workflow_id,
      task.venture_id || null,
      task.id,
      amountCents,
      now(),
      toJson({ reservedExposureCents: amountCents }),
    ],
  );
  return amountCents;
}

function providerErrorResponse(status, requestId, message) {
  return {
    ok: false,
    status,
    headers: new Headers({ "x-request-id": requestId }),
    async json() {
      return { error: { message } };
    },
  };
}

function demandValidatorDefinition() {
  return {
    id: "demand_validator",
    name: "Demand Validator",
    role: "Validate supplied demand evidence.",
    instructions: "Return a bounded decision.",
    approval_policy: { mustPauseFor: [] },
    outputContract: { required: [] },
  };
}

test("OpenAI egress policy accepts only the exact official HTTPS destinations", () => {
  assert.equal(CONFIG.openaiResponsesUrl, OFFICIAL_OPENAI_RESPONSES_URL);
  assert.equal(inspectOpenAiEgressPolicy().ready, true);
  assert.equal(inspectOpenAiEgressPolicy({ responsesUrl: OFFICIAL_OPENAI_RESPONSES_URL }).ready, true);
  assert.equal(inspectOpenAiEgressPolicy({ baseUrl: OFFICIAL_OPENAI_API_BASE_URL }).ready, true);

  for (const responsesUrl of [
    "http://api.openai.com/v1/responses",
    "http://127.0.0.1:5051/collect",
    "https://example.com/v1/responses",
    "https://api.openai.com/v1/responses?forward=true",
    "https://api.openai.com/v1/responses/other",
    "https://user:password@api.openai.com/v1/responses",
  ]) {
    assert.equal(inspectOpenAiEgressPolicy({ responsesUrl }).ready, false, responsesUrl);
  }
  assert.equal(
    inspectOpenAiEgressPolicy({ baseUrl: "https://example.com/v1" }).ready,
    false,
  );
});

test("hostile endpoint configuration is rejected before either adapter calls fetch or records dispatch state", async () => {
  const previous = snapshotEnvironment();
  const db = seededDb("adapter-block");
  try {
    enableTestProviders();
    const context = researchContext(db, "adapter-block");
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      throw new Error("fetch must not be called for a rejected endpoint");
    };

    for (const responsesUrl of [
      "http://127.0.0.1:5051/collect",
      "https://example.com/v1/responses",
      "https://api.openai.com/v1/responses?forward=true",
    ]) {
      await assert.rejects(
        runResearchTask(db, context.task, context.workflow, context.command, {
          live: true,
          apiKey: process.env.OPENAI_API_KEY,
          responsesUrl,
          fetchImpl,
        }),
        (error) => error.code === "OPENAI_EGRESS_POLICY_BLOCKED"
          && error.providerDispatchStatus === "not_dispatched",
      );
      await assert.rejects(
        runLiveAiWorkerTask(db, context.task, {}, {}, {
          apiKey: process.env.OPENAI_API_KEY,
          responsesUrl,
          fetchImpl,
        }),
        (error) => error.code === "OPENAI_EGRESS_POLICY_BLOCKED"
          && error.providerDispatchStatus === "not_dispatched",
      );
    }

    assert.equal(fetchCalls, 0);
    assert.deepEqual(outboundRowsForTask(db, context.task.id), {
      costs: 0,
      modelCalls: 0,
      researchRuns: 0,
    });
  } finally {
    db.close();
    restoreEnvironment(previous);
  }
});

test("the live research adapter refuses redirects on the canonical request", async () => {
  const previous = snapshotEnvironment();
  const db = seededDb("redirect-policy");
  try {
    enableTestProviders();
    const context = researchContext(db, "redirect-policy");
    let captured = null;
    const fetchImpl = async (url, options) => {
      captured = { url, options };
      return {
        ok: false,
        status: 400,
        async json() {
          return { error: { message: "expected test rejection" } };
        },
      };
    };

    await assert.rejects(
      runResearchTask(db, context.task, context.workflow, context.command, {
        live: true,
        apiKey: process.env.OPENAI_API_KEY,
        fetchImpl,
      }),
      /expected test rejection/,
    );
    assert.equal(captured.url, OFFICIAL_OPENAI_RESPONSES_URL);
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.redirect, "error");
  } finally {
    db.close();
    restoreEnvironment(previous);
  }
});

test("unsafe endpoint configuration is visible in integration, readiness, and spend preflight state", () => {
  const previous = snapshotEnvironment();
  const db = seededDb("readiness");
  try {
    enableTestProviders();
    process.env.OPENAI_RESPONSES_URL = "http://127.0.0.1:5051/collect";
    refreshIntegrationHealth(db);

    const readiness = getLiveResearchReadiness(db);
    assert.equal(readiness.credentialsConfigured, true);
    assert.equal(readiness.egressReady, false);
    assert.equal(readiness.ready, false);
    assert.equal(readiness.checklist.find((item) => item.id === "openai_egress").ok, false);
    assert.ok(readiness.blockers.some((blocker) => /network destination/i.test(blocker)));

    const integration = get(db, "SELECT * FROM integrations WHERE id = 'openai'");
    assert.equal(integration.status, "blocked");
    assert.equal(integration.health, "blocked");
    assert.equal(fromJson(integration.metadata).egressPolicy.ready, false);

    const requirements = missingPreflightRequirements({ type: "live_research" });
    assert.ok(requirements.some((requirement) => requirement.name === "openai_egress_policy"));
  } finally {
    db.close();
    restoreEnvironment(previous);
  }
});

test("configuration and the Windows launcher do not pass through an endpoint override", () => {
  const child = childProcess.spawnSync(
    process.execPath,
    ["-e", "process.stdout.write(require('./src/config').openaiResponsesUrl)"],
    {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        OPENAI_RESPONSES_URL: "http://127.0.0.1:5051/collect",
      },
    },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, OFFICIAL_OPENAI_RESPONSES_URL);

  const launcher = fs.readFileSync(
    path.resolve(__dirname, "../scripts/start-pantheon.ps1"),
    "utf8",
  );
  const runtimeNames = launcher.match(/\$runtimeNames\s*=\s*@\(([\s\S]*?)\r?\n\)/)?.[1] || "";
  assert.doesNotMatch(runtimeNames, /OPENAI_RESPONSES_URL/);
  assert.doesNotMatch(runtimeNames, /OPENAI_BASE_URL/);
});

test("every post-dispatch HTTP failure retains full billing exposure even when the provider outcome is known", async (t) => {
  const previous = snapshotEnvironment();
  try {
    enableTestProviders();
    const definiteStatuses = new Set([400, 401, 403, 404, 405, 413, 415, 422]);
    for (const status of [...definiteStatuses, 408, 409, 429, 500, 502]) {
      await t.test(`HTTP ${status}`, async () => {
        const db = seededDb(`http-${status}`);
        try {
          const context = researchContext(db, `http-${status}`);
          const exposureCents = reserveTaskCost(db, context.task);
          const requestId = `req_security_${status}`;
          let failure = null;
          await assert.rejects(
            runResearchTask(db, context.task, context.workflow, context.command, {
              live: true,
              apiKey: process.env.OPENAI_API_KEY,
              fetchImpl: async () => providerErrorResponse(
                status,
                requestId,
                `bounded HTTP ${status} proof`,
              ),
            }),
            (error) => {
              failure = error;
              return true;
            },
          );

          const definite = definiteStatuses.has(status);
          assert.equal(failure.definiteProviderRejection, definite);
          assert.equal(failure.outcomeUnknown, !definite);
          assert.equal(failure.billingOutcomeUnknown, true);
          assert.equal(failure.exactBillingPending, true);
          assert.equal(failure.providerRequestId, requestId);
          assert.equal(failure.reservedExposureCents, exposureCents);

          const cost = get(db, "SELECT * FROM costs WHERE id = ?", [spendCostId(context.task.id)]);
          const costMetadata = fromJson(cost.metadata);
          assert.equal(cost.status, "unknown");
          assert.equal(cost.amount_cents, exposureCents);
          assert.equal(costMetadata.providerRequestId, requestId);
          assert.equal(costMetadata.outcomeUnknown, !definite);
          assert.equal(costMetadata.billingOutcomeUnknown, true);
          assert.equal(costMetadata.exactBillingPending, true);
          assert.equal(costMetadata.noSpendOccurred, null);
          assert.equal(costMetadata.reservedExposureCents, exposureCents);
          if (definite) assert.equal(costMetadata.estimatedCostCents, 0);

          const modelCall = get(db, "SELECT * FROM model_calls WHERE task_id = ?", [context.task.id]);
          const modelMetadata = fromJson(modelCall.metadata);
          assert.equal(modelCall.provider_request_id, requestId);
          assert.equal(modelCall.outcome_status, definite ? "failed_before_effect" : "unknown");
          assert.equal(modelCall.cost_status, "unknown");
          assert.equal(modelCall.reserved_cost_cents, exposureCents);
          assert.equal(modelMetadata.billingOutcomeUnknown, true);
          assert.equal(modelMetadata.exactBillingPending, true);
          if (definite) assert.equal(modelCall.estimated_cost_cents, 0);

          const researchRun = get(db, "SELECT * FROM research_runs WHERE task_id = ?", [context.task.id]);
          const researchMetadata = fromJson(researchRun.metadata);
          assert.equal(researchMetadata.providerRequestId, requestId);
          assert.equal(researchMetadata.outcomeUnknown, !definite);
          assert.equal(researchMetadata.billingOutcomeUnknown, true);
          assert.equal(researchMetadata.exactBillingPending, true);
          assert.equal(researchMetadata.reservedExposureCents, exposureCents);

          if (definite) {
            const mandate = operatingMandateState(db);
            const exposure = mandate.exposure.groups.find((group) => (
              group.entries.some((entry) => entry.taskId === context.task.id)
            ));
            assert.ok(exposure);
            assert.equal(exposure.countedAs, "unresolved");
            assert.equal(exposure.amountCents, exposureCents);
            assert.equal(
              mandate.remainingCents,
              Math.max(0, Number(mandate.mandate.budget_cap_cents) - mandate.exposure.totalCents),
            );

            if (status === 400) {
              const monthlyExposure = monthlyBudgetExposure(db);
              const budgetSetting = fromJson(
                get(db, "SELECT value FROM settings WHERE key = 'budget'")?.value,
                {},
              );
              run(
                db,
                "UPDATE settings SET value = ? WHERE key = 'budget'",
                [toJson({ ...budgetSetting, monthlyBudgetCents: monthlyExposure.totalCents })],
              );
              const nextTaskRow = get(
                db,
                `SELECT * FROM tasks
                 WHERE workflow_id = ? AND id <> ?
                 ORDER BY priority, created_at, id
                 LIMIT 1`,
                [context.workflow.id, context.task.id],
              );
              assert.ok(nextTaskRow);
              run(db, "UPDATE tasks SET cost_budget_cents = 1 WHERE id = ?", [nextTaskRow.id]);
              const nextTask = {
                ...nextTaskRow,
                cost_budget_cents: 1,
                payload: fromJson(nextTaskRow.payload, {}),
              };
              assert.throws(
                () => reserveBudget(db, nextTask, null, 1),
                /monthly pre-revenue cap/i,
              );
              assert.equal(
                get(
                  db,
                  "SELECT COUNT(*) AS count FROM budget_reservations WHERE task_id = ?",
                  [nextTask.id],
                ).count,
                0,
              );
              assert.equal(monthlyBudgetExposure(db).totalCents, monthlyExposure.totalCents);
            }
          }
        } finally {
          db.close();
        }
      });
    }
  } finally {
    restoreEnvironment(previous);
  }
});

test("the fallback live worker retains full exposure for known rejection and ambiguous rate limit", async (t) => {
  const previous = snapshotEnvironment();
  try {
    enableTestProviders();
    for (const status of [400, 429]) {
      await t.test(`HTTP ${status}`, async () => {
        const db = seededDb(`worker-${status}`);
        try {
          const context = researchContext(db, `worker-${status}`);
          context.task.payload.liveSpendRequest = {
            estimatedCostCents: 17,
            maxCostCents: 150,
          };
          const exposureCents = reserveTaskCost(db, context.task, 150);
          const requestId = `req_worker_${status}`;
          let failure = null;
          await assert.rejects(
            runLiveAiWorkerTask(
              db,
              context.task,
              demandValidatorDefinition(),
              { allowedTools: [], blockedTools: [] },
              {
                apiKey: process.env.OPENAI_API_KEY,
                fetchImpl: async () => providerErrorResponse(status, requestId, `bounded HTTP ${status} proof`),
              },
            ),
            (error) => {
              failure = error;
              return true;
            },
          );

          const definite = status === 400;
          assert.equal(failure.outcomeUnknown, !definite);
          assert.equal(failure.definiteProviderRejection, definite);
          assert.equal(failure.billingOutcomeUnknown, true);
          assert.equal(failure.exactBillingPending, true);
          assert.equal(failure.providerRequestId, requestId);
          assert.equal(failure.reservedExposureCents, exposureCents);
          const cost = get(db, "SELECT * FROM costs WHERE id = ?", [spendCostId(context.task.id)]);
          const costMetadata = fromJson(cost.metadata);
          assert.equal(cost.status, "unknown");
          assert.equal(cost.amount_cents, exposureCents);
          assert.equal(costMetadata.providerRequestId, requestId);
          assert.equal(costMetadata.outcomeUnknown, !definite);
          assert.equal(costMetadata.billingOutcomeUnknown, true);
          assert.equal(costMetadata.exactBillingPending, true);
          assert.equal(costMetadata.noSpendOccurred, null);
          const modelCall = get(db, "SELECT * FROM model_calls WHERE task_id = ?", [context.task.id]);
          const modelMetadata = fromJson(modelCall.metadata);
          assert.equal(modelCall.outcome_status, definite ? "failed_before_effect" : "unknown");
          assert.equal(modelCall.cost_status, "unknown");
          assert.equal(modelCall.provider_request_id, requestId);
          assert.equal(modelCall.estimated_cost_cents, definite ? 0 : 17);
          assert.equal(modelCall.reserved_cost_cents, exposureCents);
          assert.equal(modelMetadata.billingOutcomeUnknown, true);
          assert.equal(modelMetadata.exactBillingPending, true);
        } finally {
          db.close();
        }
      });
    }
  } finally {
    restoreEnvironment(previous);
  }
});

test("the explicit Agents SDK OpenAI client uses one attempt, the canonical base, a deadline, and redirect refusal", async () => {
  const previous = snapshotEnvironment();
  try {
    enableTestProviders();
    const OpenAIModule = require("openai");
    const OpenAI = OpenAIModule.default || OpenAIModule;
    let fetchCalls = 0;
    let captured = null;
    const client = __createSecureOpenAiClientForTests(OpenAI, 12_345, {
      apiKey: process.env.OPENAI_API_KEY,
      fetchImpl: async (input, init) => {
        fetchCalls += 1;
        captured = { input, init };
        return new Response(
          JSON.stringify({ error: { message: "single-attempt proof" } }),
          {
            status: 500,
            headers: { "content-type": "application/json", "x-request-id": "req_sdk_one_attempt" },
          },
        );
      },
    });

    assert.equal(client.baseURL, OFFICIAL_OPENAI_API_BASE_URL);
    assert.equal(client.maxRetries, 0);
    assert.equal(client.timeout, 12_345);
    await assert.rejects(
      client.responses.create({ model: "gpt-5.6-terra", input: "one safe test request", max_output_tokens: 1 }),
      /single-attempt proof/,
    );
    assert.equal(fetchCalls, 1);
    const requestUrl = captured.input instanceof Request ? captured.input.url : String(captured.input);
    const redirect = captured.init?.redirect || captured.input?.redirect;
    assert.equal(requestUrl, OFFICIAL_OPENAI_RESPONSES_URL);
    assert.equal(redirect, "error");

    process.env.OPENAI_BASE_URL = "http://127.0.0.1:5051/collect";
    assert.throws(
      () => __createSecureOpenAiClientForTests(OpenAI, 12_345, {
        apiKey: process.env.OPENAI_API_KEY,
        fetchImpl: async () => {
          throw new Error("must not dispatch");
        },
      }),
      (error) => error.code === "OPENAI_EGRESS_POLICY_BLOCKED"
        && error.providerDispatchStatus === "not_dispatched",
    );
  } finally {
    restoreEnvironment(previous);
  }
});

test("Agents SDK error classification separates known pre-effect failures from ambiguous outcomes without claiming zero billing", () => {
  const previous = snapshotEnvironment();
  try {
    enableTestProviders();
    const secret = process.env.OPENAI_API_KEY;
    const definiteStatuses = new Set([400, 401, 403, 404, 405, 413, 415, 422]);
    for (const status of [...definiteStatuses, 408, 409, 429, 500]) {
      const error = new Error(`${secret} ${"x".repeat(MAX_OPENAI_ERROR_CHARACTERS * 3)}`);
      error.status = status;
      error.requestID = `req_sdk_${status}`;
      __classifySdkRunErrorForTests(error, true, "trace_security_test");
      const definite = definiteStatuses.has(status);
      assert.equal(error.definiteProviderRejection === true, definite);
      assert.equal(error.outcomeUnknown, !definite);
      if (definite) {
        assert.equal(error.billingOutcomeUnknown, true);
        assert.equal(error.exactBillingPending, true);
      }
      assert.equal(error.providerRequestId, `req_sdk_${status}`);
      assert.equal(error.message.includes(secret), false);
      assert.ok(error.message.length <= MAX_OPENAI_ERROR_CHARACTERS);
    }
    const longRequestIdError = new Error("bounded request ID proof");
    longRequestIdError.status = 500;
    longRequestIdError.requestID = `req_${"y".repeat(500)}`;
    __classifySdkRunErrorForTests(longRequestIdError, true, "trace_request_id_test");
    assert.ok(longRequestIdError.providerRequestId.length <= 200);
  } finally {
    restoreEnvironment(previous);
  }
});

test("provider error bodies are bounded and secrets are not persisted", async () => {
  const previous = snapshotEnvironment();
  const db = seededDb("bounded-errors");
  try {
    enableTestProviders();
    const context = researchContext(db, "bounded-errors");
    reserveTaskCost(db, context.task);
    const secret = process.env.OPENAI_API_KEY;
    const rawTail = "z".repeat(MAX_OPENAI_ERROR_CHARACTERS * 4);
    let failure = null;
    await assert.rejects(
      runResearchTask(db, context.task, context.workflow, context.command, {
        live: true,
        apiKey: secret,
        fetchImpl: async () => providerErrorResponse(
          500,
          "req_bounded_error",
          `Never store ${secret} ${rawTail}`,
        ),
      }),
      (error) => {
        failure = error;
        return true;
      },
    );

    assert.equal(failure.message.includes(secret), false);
    assert.ok(failure.message.length <= MAX_OPENAI_ERROR_CHARACTERS + 80);
    const persisted = JSON.stringify({
      cost: get(db, "SELECT metadata FROM costs WHERE task_id = ?", [context.task.id]),
      model: get(db, "SELECT metadata FROM model_calls WHERE task_id = ?", [context.task.id]),
      research: get(db, "SELECT summary, metadata FROM research_runs WHERE task_id = ?", [context.task.id]),
      events: all(db, "SELECT message, metadata FROM events WHERE entity_id = ? OR metadata LIKE ?", [context.task.id, `%${context.task.id}%`]),
    });
    assert.equal(persisted.includes(secret), false);
    assert.equal(persisted.includes(rawTail), false);
  } finally {
    db.close();
    restoreEnvironment(previous);
  }
});

test("an oversized provider body is rejected before it is read and remains an unknown full-cost outcome", async () => {
  const previous = snapshotEnvironment();
  const db = seededDb("oversized-body");
  try {
    enableTestProviders();
    const context = researchContext(db, "oversized-body");
    const exposureCents = reserveTaskCost(db, context.task);
    let bodyRead = false;
    let failure = null;
    await assert.rejects(
      runResearchTask(db, context.task, context.workflow, context.command, {
        live: true,
        apiKey: process.env.OPENAI_API_KEY,
        fetchImpl: async () => ({
          ok: false,
          status: 500,
          headers: new Headers({
            "content-length": String(MAX_OPENAI_RESPONSE_BYTES + 1),
            "x-request-id": "req_oversized_body",
          }),
          async text() {
            bodyRead = true;
            return "must not be read";
          },
        }),
      }),
      (error) => {
        failure = error;
        return true;
      },
    );
    assert.equal(bodyRead, false);
    assert.equal(failure.outcomeUnknown, true);
    assert.equal(failure.providerRequestId, "req_oversized_body");
    assert.match(failure.message, /response safety limit/);
    const cost = get(db, "SELECT * FROM costs WHERE task_id = ?", [context.task.id]);
    assert.equal(cost.status, "unknown");
    assert.equal(cost.amount_cents, exposureCents);
  } finally {
    db.close();
    restoreEnvironment(previous);
  }
});
