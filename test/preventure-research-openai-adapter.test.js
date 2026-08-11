"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const authority = require("../config/preventure-research-authority-smm-scope-guard-v1");
const {
  createPreventureResearchOpenAiTransport,
} = require("../src/adapters/preventure-research-openai");
const { sha256 } = require("../src/runtime/commercial-test-contract");
const {
  createPreventureResearchExecutionDescriptor,
} = require("../src/runtime/preventure-research-runner");
const {
  createPreventureResearchOutputStore,
} = require("../src/runtime/preventure-research-output-store");

function exactDescriptor() {
  const template = authority.assignments[0];
  const activation = {
    eventType: "activated",
    eventHash: sha256({ fixture: "adapter_activation" }),
  };
  const assignment = {
    ...template,
    authorityHash: authority.authorityHash,
    templateHash: sha256(template),
    activationEventHash: activation.eventHash,
    assignmentHash: sha256({ fixture: "adapter_assignment" }),
    workflowId: "workflow_adapter_fixture",
    taskId: "task_adapter_fixture",
  };
  return createPreventureResearchExecutionDescriptor(
    authority,
    assignment,
    template,
    activation,
  );
}

function recordingOutputStore() {
  const retained = [];
  return {
    retained,
    status() {
      return { ready: true };
    },
    retain(input) {
      const record = {
        ...input,
        retained: true,
        artifactHash: sha256({ input, index: retained.length }),
        artifactRef: `artifact_${retained.length + 1}`,
        location: `artifact_${retained.length + 1}`,
      };
      retained.push(record);
      return record;
    },
  };
}

function transportFor(
  fetchImpl,
  outputStore,
  apiKey = "sk-adapter-fixture-credential-123456",
  overrides = {},
) {
  return createPreventureResearchOpenAiTransport({
    authority,
    outputStore,
    allowTestOverrides: true,
    liveResearchEnabled: true,
    apiKey,
    fetchImpl,
    clock() {
      return "2026-08-02T02:04:00.000Z";
    },
    clientRequestIdForClaim() {
      return "client_adapter_fixture_1";
    },
    async assertProviderRetentionBinding(input) {
      return {
        retentionBound: true,
        current: true,
        terminalRetention: false,
        emergencyStopped: false,
        lifecycleState: "activated",
        latestLifecycleEventHash: sha256("adapter-active-lifecycle"),
        claimToken: input.claimToken,
        authorityHash: input.authorityHash,
        assignmentHash: input.assignmentHash,
        descriptorHash: input.descriptorHash,
        taskId: input.taskId,
        taskAttemptId: input.taskAttemptId,
        modelCallId: "model_call_adapter_fixture",
        clientRequestId: input.clientRequestId,
        providerDispatchedAt: "2026-08-02T02:03:00.000Z",
      };
    },
    ...overrides,
  });
}

function dispatch(transport, descriptor = exactDescriptor()) {
  return transport.dispatch({
    descriptor,
    request: descriptor.request,
    claimToken: "claim_adapter_fixture",
    clientRequestId: "client_adapter_fixture_1",
    taskId: "task_adapter_fixture",
    taskAttemptId: "attempt_adapter_fixture",
    deadlineMs: descriptor.limits.deadlineMs,
  });
}

test("definite pre-effect 400 retains exact bytes before returning pending A$0.50 exposure", async () => {
  const outputStore = recordingOutputStore();
  const raw = JSON.stringify({
    error: {
      type: "invalid_request_error",
      code: "invalid_request",
      message: "The request was rejected before execution.",
    },
  });
  let calls = 0;
  const transport = transportFor(async () => {
    calls += 1;
    return new Response(raw, {
      status: 400,
      headers: { "x-request-id": "req_adapter_pre_effect_1" },
    });
  }, outputStore);
  let failure = null;
  await assert.rejects(dispatch(transport), (error) => {
    failure = error;
    return error.kind === "definite_pre_effect_http_rejection";
  });
  assert.equal(calls, 1);
  assert.equal(outputStore.retained.length, 1);
  assert.equal(outputStore.retained[0].assignmentMaxCostAudCents, 50);
  assert.equal(outputStore.retained[0].retainedAt, "2026-08-02T02:04:00.000Z");
  assert.equal(failure.costAudCents, 0);
  assert.equal(failure.costStatus, "estimated");
  assert.equal(failure.exposureAudCents, 50);
  assert.equal(failure.exactBillingPending, true);
  assert.equal(failure.providerZeroBillingGuarantee, false);
  assert.equal(failure.providerRequestId, "req_adapter_pre_effect_1");
  assert.equal(failure.providerResponseId, null);
  assert.equal(failure.clientRequestId, "client_adapter_fixture_1");
  assert.equal(failure.retainedOutput.rawProviderBody, raw);
  assert.equal(failure.retainedOutput.rawProviderBodyHash, sha256(raw));
  assert.deepEqual(failure.retainedOutput.billing, {
    currency: "AUD",
    costAudCents: 0,
    costStatus: "estimated",
    exactBillingPending: true,
    exposureAudCents: 50,
    providerZeroBillingGuarantee: false,
  });
});

test("malformed known 2xx is retained exactly once before the no-retry frozen result", async () => {
  const outputStore = recordingOutputStore();
  const raw = "{malformed-provider-json";
  let calls = 0;
  const transport = transportFor(async () => {
    calls += 1;
    return new Response(raw, {
      status: 200,
      headers: { "x-request-id": "req_adapter_malformed_1" },
    });
  }, outputStore);
  const result = await dispatch(transport);
  assert.equal(calls, 1);
  assert.equal(outputStore.retained.length, 1);
  assert.equal(result.outcomeStatus, "known_effect_invalid");
  assert.equal(result.httpStatus, 200);
  assert.equal(result.providerRequestId, "req_adapter_malformed_1");
  assert.equal(result.providerResponseId, null);
  assert.equal(result.clientRequestId, "client_adapter_fixture_1");
  assert.equal(result.rawProviderBody, raw);
  assert.equal(result.rawProviderBodyHash, sha256(raw));
  assert.deepEqual(result.issues, [
    "provider_output_invalid",
    "provider_response_id_missing",
    "provider_usage_unknown",
    "response_json_invalid",
  ]);
  assert.equal(result.costAudCents, null);
  assert.equal(result.costStatus, "unknown");
  assert.equal(result.retainedOutput.rawProviderBody, raw);
  assert.equal(result.retainedOutput.responseMetadata.httpStatus, 200);
});

test("canonical known 2xx retains exact response bytes before returning the usable result", async () => {
  const outputStore = recordingOutputStore();
  const descriptor = exactDescriptor();
  const providerResponse = {
    id: "resp_adapter_canonical_1",
    object: "response",
    model: descriptor.model,
    status: "completed",
    incomplete_details: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    },
    output: [
      {
        id: "ws_adapter_canonical_1",
        type: "web_search_call",
        status: "completed",
        action: {
          type: "search",
          query: "public buyer demand evidence",
          sources: [{
            url: "https://example.com/public-demand-evidence",
            title: "Public demand evidence",
            publisher: "Example Publisher",
            snippet: "A public source used only as partial grounding metadata.",
          }],
        },
      },
      {
        id: "msg_adapter_canonical_1",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{
          type: "output_text",
          text: JSON.stringify({ boundedResult: true }),
          annotations: [{
            type: "url_citation",
            url: "https://example.com/public-demand-evidence",
            title: "Public demand evidence",
          }],
        }],
      },
    ],
  };
  const raw = JSON.stringify(providerResponse);
  let calls = 0;
  const transport = transportFor(async () => {
    calls += 1;
    return new Response(raw, {
      status: 200,
      headers: { "x-request-id": "req_adapter_canonical_1" },
    });
  }, outputStore);

  const result = await dispatch(transport, descriptor);
  assert.equal(calls, 1);
  assert.equal(result.outcomeStatus, "known");
  assert.equal(result.providerRequestId, "req_adapter_canonical_1");
  assert.equal(result.providerResponseId, "resp_adapter_canonical_1");
  assert.equal(result.clientRequestId, "client_adapter_fixture_1");
  assert.equal(result.responseMetadata.httpStatus, 200);
  assert.equal(outputStore.retained.length, 1);
  assert.equal(result.retainedOutput.artifactKind, "canonical_known_response");
  assert.equal(result.retainedOutput.rawProviderBody, raw);
  assert.deepEqual(result.retainedOutput.rawProviderBodyBytes, Buffer.from(raw, "utf8"));
  assert.equal(result.retainedOutput.rawProviderBodyHash, sha256(raw));
  assert.equal(result.retainedOutput.providerResponseHash, sha256(providerResponse));
  assert.deepEqual(result.retainedOutput.responseMetadata.responseIssues, []);
});

test("ambiguous 408 retains exact 4xx bytes with distinct IDs and unknown full exposure", async () => {
  const outputStore = recordingOutputStore();
  const raw = JSON.stringify({
    id: "resp_adapter_timeout_1",
    error: {
      type: "request_timeout",
      code: "timeout",
      message: "The request timed out after dispatch.",
    },
  });
  let calls = 0;
  const transport = transportFor(async () => {
    calls += 1;
    return new Response(raw, {
      status: 408,
      headers: { "x-request-id": "req_adapter_timeout_1" },
    });
  }, outputStore);
  const result = await dispatch(transport);
  assert.equal(calls, 1);
  assert.equal(outputStore.retained.length, 1);
  assert.equal(result.outcomeStatus, "known_effect_invalid");
  assert.equal(result.httpStatus, 408);
  assert.equal(result.providerRequestId, "req_adapter_timeout_1");
  assert.equal(result.providerResponseId, "resp_adapter_timeout_1");
  assert.equal(result.clientRequestId, "client_adapter_fixture_1");
  assert.equal(new Set([
    result.providerRequestId,
    result.providerResponseId,
    result.clientRequestId,
  ]).size, 3);
  assert.equal(result.costAudCents, null);
  assert.equal(result.costStatus, "unknown");
  assert.deepEqual(result.issues, ["provider_http_408"]);
  assert.equal(result.retainedOutput.rawProviderBody, raw);
  assert.equal(result.retainedOutput.rawProviderBodyHash, sha256(raw));
  assert.equal(result.retainedOutput.responseMetadata.httpStatus, 408);
});

test("a provider credential echo is rejected before disk retention and cannot leak through the error", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-adapter-secret-"));
  const apiKey = "sk-adapter-secret-echo-123456789";
  try {
    const outputStore = createPreventureResearchOutputStore({
      artifactRoot: root,
      assignmentMaxCostAudCentsForHash: () => 50,
    });
    const raw = JSON.stringify({
      error: {
        type: "invalid_request_error",
        code: apiKey,
        message: `Credential echo ${apiKey}`,
      },
    });
    const transport = transportFor(async () => new Response(raw, {
      status: 400,
      headers: { "x-request-id": "req_adapter_secret_1" },
    }), outputStore, apiKey);
    let failure = null;
    await assert.rejects(dispatch(transport), (error) => {
      failure = error;
      return error.providerOutcomeKnown === true && error.knownProviderRetentionFailed === true;
    });
    assert.ok(failure);
    const exposed = JSON.stringify({
      message: failure.message,
      code: failure.code,
      ...Object.fromEntries(Object.keys(failure).map((key) => [key, failure[key]])),
    });
    assert.equal(exposed.includes(apiKey), false);
    const files = fs.readdirSync(root, { recursive: true });
    for (const relative of files) {
      const file = path.join(root, relative);
      if (fs.statSync(file).isFile()) {
        assert.equal(fs.readFileSync(file).includes(Buffer.from(apiKey)), false);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the sent credential is captured once and a rotated credential cannot hide a malicious request ID", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-adapter-rotated-secret-"));
  const sentKey = "sk-adapter-sent-header-secret-123456789";
  const rotatedKey = "sk-adapter-rotated-header-secret-987654321";
  let currentKey = sentKey;
  let reads = 0;
  const rotatingCredential = {
    toString() {
      reads += 1;
      return currentKey;
    },
  };
  try {
    const outputStore = createPreventureResearchOutputStore({
      artifactRoot: root,
      assignmentMaxCostAudCentsForHash: () => 50,
    });
    const raw = JSON.stringify({
      error: {
        type: "invalid_request_error",
        code: "invalid_request",
        message: "Rejected before execution.",
      },
    });
    const transport = transportFor(async (_url, request) => {
      assert.equal(request.headers.Authorization, `Bearer ${sentKey}`);
      currentKey = rotatedKey;
      return new Response(raw, {
        status: 400,
        headers: { "x-request-id": sentKey },
      });
    }, outputStore, rotatingCredential);
    let failure = null;
    await assert.rejects(dispatch(transport), (error) => {
      failure = error;
      return error.providerOutcomeKnown === true && error.knownProviderRetentionFailed === true;
    });
    assert.equal(reads, 1);
    const exposed = JSON.stringify({
      message: failure.message,
      code: failure.code,
      ...Object.fromEntries(Object.keys(failure).map((key) => [key, failure[key]])),
    });
    assert.equal(exposed.includes(sentKey), false);
    assert.equal(exposed.includes(rotatedKey), false);
    const files = fs.readdirSync(root, { recursive: true });
    for (const relative of files) {
      const file = path.join(root, relative);
      if (fs.statSync(file).isFile()) {
        const bytes = fs.readFileSync(file);
        assert.equal(bytes.includes(Buffer.from(sentKey)), false);
        assert.equal(bytes.includes(Buffer.from(rotatedKey)), false);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a short configured credential cannot leak through retention-failure request details", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-adapter-short-secret-"));
  const apiKey = "tiny7";
  try {
    const outputStore = createPreventureResearchOutputStore({
      artifactRoot: root,
      assignmentMaxCostAudCentsForHash: () => 50,
    });
    const raw = JSON.stringify({
      error: {
        type: "invalid_request_error",
        code: "invalid_request",
        message: "Rejected before execution.",
      },
    });
    const transport = transportFor(async () => new Response(raw, {
      status: 400,
      headers: { "x-request-id": apiKey },
    }), outputStore, apiKey);
    let failure = null;
    await assert.rejects(dispatch(transport), (error) => {
      failure = error;
      return error.knownProviderRetentionFailed === true;
    });
    assert.notEqual(failure.providerRequestId, apiKey);
    assert.equal(JSON.stringify({
      message: failure.message,
      code: failure.code,
      ...Object.fromEntries(Object.keys(failure).map((key) => [key, failure[key]])),
    }).includes(apiKey), false);
    const files = fs.readdirSync(root, { recursive: true })
      .filter((relative) => fs.statSync(path.join(root, relative)).isFile());
    assert.deepEqual(files, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a credential-shaped request ID cannot leak when the provider body is too large to retain", async () => {
  const outputStore = recordingOutputStore();
  const apiKey = "sk-adapter-oversize-header-secret-123456";
  const transport = transportFor(async () => new Response("x", {
    status: 200,
    headers: {
      "content-length": String((5 * 1024 * 1024) + 1),
      "x-request-id": apiKey,
    },
  }), outputStore, apiKey);
  let failure = null;
  await assert.rejects(dispatch(transport), (error) => {
    failure = error;
    return error.code === "preventure_transport_response_too_large";
  });
  assert.equal(failure.providerRequestId, null);
  assert.equal(JSON.stringify({
    message: failure.message,
    code: failure.code,
    ...Object.fromEntries(Object.keys(failure).map((key) => [key, failure[key]])),
  }).includes(apiKey), false);
  assert.equal(outputStore.retained.length, 0);
});

test("unsafe HTTP request IDs are rejected exactly rather than normalized into audit identities", async () => {
  const outputStore = recordingOutputStore();
  const raw = "{malformed-provider-json";
  const response = {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return name === "x-request-id" ? "req unsafe/id" : null;
      },
    },
    async text() {
      return raw;
    },
  };
  const transport = transportFor(async () => response, outputStore);
  const result = await dispatch(transport);
  assert.equal(result.outcomeStatus, "known_effect_invalid");
  assert.equal(result.providerRequestId, null);
  assert.equal(result.issues.includes("provider_request_id_invalid"), true);
  assert.equal(result.retainedOutput.providerRequestId, null);
  assert.equal(
    result.retainedOutput.responseMetadata.responseIssues.includes("provider_request_id_invalid"),
    true,
  );
  assert.equal(result.retainedOutput.rawProviderBody, raw);
});

test("an exact already-dispatched response remains in secret-safe custody after emergency claim loss", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-adapter-emergency-race-"));
  const raw = "{malformed-late-provider-json";
  try {
    const outputStore = createPreventureResearchOutputStore({
      artifactRoot: root,
      assignmentMaxCostAudCentsForHash: () => 50,
    });
    const transport = transportFor(
      async () => new Response(raw, {
        status: 200,
        headers: { "x-request-id": "req_adapter_late_emergency_1" },
      }),
      outputStore,
      undefined,
      {
        async assertProviderRetentionBinding(input) {
          return {
            retentionBound: true,
            current: false,
            terminalRetention: true,
            emergencyStopped: true,
            lifecycleState: "activated",
            latestLifecycleEventHash: sha256("adapter-emergency-lifecycle"),
            claimToken: input.claimToken,
            authorityHash: input.authorityHash,
            assignmentHash: input.assignmentHash,
            descriptorHash: input.descriptorHash,
            taskId: input.taskId,
            taskAttemptId: input.taskAttemptId,
            modelCallId: "model_call_adapter_fixture",
            clientRequestId: input.clientRequestId,
            providerDispatchedAt: "2026-08-02T02:03:00.000Z",
          };
        },
      },
    );
    const result = await dispatch(transport);
    assert.equal(result.outcomeStatus, "known_effect_invalid");
    assert.equal(result.costAudCents, null);
    assert.equal(result.retainedOutput.retained, true);
    assert.equal(result.retainedOutput.rawProviderBody, raw);
    const files = fs.readdirSync(root, { recursive: true })
      .filter((relative) => fs.statSync(path.join(root, relative)).isFile());
    assert.equal(files.length >= 2, true);
    assert.equal(files.some((relative) => fs.readFileSync(path.join(root, relative), "utf8")
      .includes(Buffer.from(raw).toString("base64"))), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a changed original dispatch binding prevents every artifact write", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-adapter-binding-race-"));
  const raw = "{malformed-unbound-provider-json";
  try {
    const outputStore = createPreventureResearchOutputStore({
      artifactRoot: root,
      assignmentMaxCostAudCentsForHash: () => 50,
    });
    const transport = transportFor(
      async () => new Response(raw, {
        status: 200,
        headers: { "x-request-id": "req_adapter_unbound_1" },
      }),
      outputStore,
      undefined,
      {
        async assertProviderRetentionBinding() {
          const error = new Error("Original dispatch binding changed.");
          error.code = "preventure_bridge_retention_binding_changed";
          throw error;
        },
      },
    );
    await assert.rejects(
      dispatch(transport),
      { code: "preventure_transport_retention_binding_changed" },
    );
    const files = fs.readdirSync(root, { recursive: true })
      .filter((relative) => fs.statSync(path.join(root, relative)).isFile());
    assert.deepEqual(files, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a failed retention clock cannot fabricate an epoch custody timestamp", async () => {
  const outputStore = recordingOutputStore();
  const raw = "{malformed-provider-json";
  const transport = transportFor(async () => new Response(raw, {
    status: 200,
    headers: { "x-request-id": "req_adapter_clock_failure_1" },
  }), outputStore, undefined, {
    clock() {
      throw new Error("clock unavailable");
    },
  });

  await assert.rejects(dispatch(transport), (error) => {
    assert.equal(error.code, "preventure_transport_clock_invalid");
    assert.equal(error.providerDispatchStarted, true);
    assert.equal(error.providerOutcomeKnown, true);
    assert.doesNotMatch(String(error.message), /clock unavailable|1970-01-01/);
    return true;
  });
  assert.equal(outputStore.retained.length, 0);
});

test("a non-advancing retention clock cannot blur dispatch and custody order", async () => {
  const outputStore = recordingOutputStore();
  const transport = transportFor(async () => new Response("{malformed-provider-json", {
    status: 200,
    headers: { "x-request-id": "req_adapter_clock_order_1" },
  }), outputStore, undefined, {
    clock() {
      return "2026-08-02T02:03:00.000Z";
    },
  });

  await assert.rejects(
    dispatch(transport),
    (error) => error.code === "preventure_transport_clock_order_invalid"
      && error.providerDispatchStarted === true
      && error.providerOutcomeKnown === true,
  );
  assert.equal(outputStore.retained.length, 0);
});
