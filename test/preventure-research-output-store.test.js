"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Worker } = require("node:worker_threads");

const { sha256 } = require("../src/runtime/commercial-test-contract");
const {
  createPreventureResearchOutputStore: createOutputStore,
} = require("../src/runtime/preventure-research-output-store");

const MODULE_PATH = require.resolve("../src/runtime/preventure-research-output-store");
const MIB = 1024 * 1024;

function createPreventureResearchOutputStore(options = {}) {
  return createOutputStore({
    ...options,
    assignmentMaxCostAudCentsForHash:
      options.assignmentMaxCostAudCentsForHash || (() => 50),
  });
}

function temporaryRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-${label}-`));
}

function canonicalInput(overrides = {}) {
  const providerResponse = overrides.providerResponse || {
    id: "resp_output_store_1",
    object: "response",
    model: "gpt-5-mini-2025-08-07",
    output: [],
    status: "completed",
    usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
  };
  const rawProviderBody = overrides.rawProviderBody || JSON.stringify(providerResponse);
  const billing = overrides.billing || {
    currency: "AUD",
    costAudCents: 2,
    costStatus: "estimated",
    modelCallId: "model_call_output_store_1",
  };
  const groundedSources = overrides.groundedSources || [];
  return {
    artifactKind: "canonical_known_response",
    assignmentMaxCostAudCents: 50,
    authorityHash: sha256("authority-output-store"),
    assignmentHash: sha256("assignment-output-store"),
    descriptorHash: sha256("descriptor-output-store"),
    requestBodyHash: sha256("request-output-store"),
    providerRequestId: null,
    providerResponseId: providerResponse.id,
    clientRequestId: "pantheon-output-store-client-1",
    providerResponse,
    providerResponseHash: sha256(providerResponse),
    rawProviderBody,
    rawProviderBodyHash: sha256(rawProviderBody),
    output: "{}",
    groundedSources,
    groundedSourceSetHash: sha256(groundedSources),
    billing,
    billingHash: sha256(billing),
    responseMetadata: { httpStatus: 200, responseIssues: [] },
    retainedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

function invalidInput(rawProviderBody, identity, overrides = {}) {
  let parsed;
  let parsedSuccessfully = false;
  try {
    parsed = JSON.parse(rawProviderBody);
    parsedSuccessfully = true;
  } catch {
    parsed = null;
  }
  const providerResponseId = parsedSuccessfully
    && parsed
    && !Array.isArray(parsed)
    && typeof parsed === "object"
    && /^[A-Za-z0-9._:-]{1,200}$/.test(String(parsed.id || ""))
    ? String(parsed.id)
    : null;
  const billing = { currency: "AUD", costAudCents: null, costStatus: "unknown" };
  return canonicalInput({
    artifactKind: "known_effect_invalid",
    assignmentHash: sha256(`invalid-assignment-${identity}`),
    descriptorHash: sha256(`invalid-descriptor-${identity}`),
    requestBodyHash: sha256(`invalid-request-${identity}`),
    providerResponse: parsedSuccessfully ? parsed : null,
    providerResponseHash: parsedSuccessfully ? sha256(parsed) : null,
    providerResponseId,
    rawProviderBody,
    rawProviderBodyHash: sha256(rawProviderBody),
    output: null,
    groundedSources: [],
    groundedSourceSetHash: sha256([]),
    billing,
    billingHash: sha256(billing),
    responseMetadata: { httpStatus: 200, canonicalResponseValid: false },
    ...overrides,
  });
}

function preEffectInput(overrides = {}) {
  const providerResponse = {
    error: { type: "invalid_request_error", code: "invalid_request", message: "Rejected" },
  };
  const rawProviderBody = JSON.stringify(providerResponse);
  const billing = {
    currency: "AUD",
    costAudCents: 0,
    costStatus: "estimated",
    exactBillingPending: true,
    providerZeroBillingGuarantee: false,
    exposureAudCents: 50,
  };
  return canonicalInput({
    artifactKind: "known_pre_effect_rejection",
    assignmentHash: sha256("pre-effect-assignment"),
    descriptorHash: sha256("pre-effect-descriptor"),
    requestBodyHash: sha256("pre-effect-request"),
    providerResponse,
    providerResponseHash: sha256(providerResponse),
    providerResponseId: null,
    rawProviderBody,
    rawProviderBodyHash: sha256(rawProviderBody),
    output: null,
    groundedSources: [],
    groundedSourceSetHash: sha256([]),
    billing,
    billingHash: sha256(billing),
    responseMetadata: {
      httpStatus: 400,
      providerErrorType: "invalid_request_error",
      providerErrorCode: "invalid_request",
      usage: null,
      observedWebSearchCallCount: 0,
    },
    ...overrides,
  });
}

function contentFile(root, artifactHash) {
  const hex = artifactHash.slice("sha256:".length);
  return path.join(root, hex.slice(0, 2), `${hex}.json`);
}

function stableIdentity(input) {
  return sha256({
    schema: "pantheon.preventure-provider-output.v1",
    authorityHash: input.authorityHash,
    assignmentHash: input.assignmentHash,
    descriptorHash: input.descriptorHash,
    requestBodyHash: input.requestBodyHash,
  });
}

function claimFile(root, input) {
  const hex = stableIdentity(input).slice("sha256:".length);
  return path.join(root, "claims", hex.slice(0, 2), `${hex}.json`);
}

function jsonFiles(root, includeClaims = false) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(entry.parentPath || entry.path, entry.name))
    .filter((file) => includeClaims || !file.includes(`${path.sep}claims${path.sep}`));
}

function workerRetain(root, input, signal) {
  const workerSource = `
    "use strict";
    const { parentPort, workerData } = require("node:worker_threads");
    const { createPreventureResearchOutputStore } = require(workerData.modulePath);
    const state = new Int32Array(workerData.signal);
    Atomics.add(state, 0, 1);
    Atomics.notify(state, 0);
    Atomics.wait(state, 1, 0);
    try {
      const store = createPreventureResearchOutputStore({
        artifactRoot: workerData.root,
        assignmentMaxCostAudCentsForHash() { return 50; },
      });
      const retained = store.retain(workerData.input);
      parentPort.postMessage({ ok: true, artifactRef: retained.artifactRef });
    } catch (error) {
      parentPort.postMessage({ ok: false, code: error.code, message: error.message });
    }
  `;
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: { modulePath: MODULE_PATH, root, input, signal },
  });
  return {
    worker,
    result: new Promise((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
    }),
  };
}

async function concurrentRetain(root, inputs) {
  const signal = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const state = new Int32Array(signal);
  const workers = inputs.map((input) => workerRetain(root, input, signal));
  while (Atomics.load(state, 0) < workers.length) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  Atomics.store(state, 1, 1);
  Atomics.notify(state, 1, workers.length);
  const results = await Promise.all(workers.map((item) => item.result));
  await Promise.all(workers.map((item) => item.worker.terminate()));
  return results;
}

test("output-store construction requires an exact assignment cost-cap resolver", () => {
  const sandbox = temporaryRoot("output-store-cap-resolver");
  const root = path.join(sandbox, "missing-resolver");
  try {
    assert.throws(
      () => createOutputStore({ artifactRoot: root }),
      { code: "preventure_output_assignment_cap_resolver_invalid" },
    );
    assert.equal(fs.existsSync(root), false);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("retention is immutable, deeply frozen, and exact replays keep one full-hash artifact", () => {
  const root = temporaryRoot("output-store-basic");
  try {
    const store = createPreventureResearchOutputStore({ artifactRoot: root });
    const input = canonicalInput();
    const first = store.retain(input);
    const replay = store.retain({ ...input, retainedAt: "2026-08-02T00:01:00.000Z" });
    assert.equal(replay.artifactRef, first.artifactRef);
    assert.equal(jsonFiles(root).length, 1);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.providerResponse), true);
    assert.equal(Object.isFrozen(first.billing), true);
    assert.throws(() => { first.providerResponse.id = "resp_changed"; }, TypeError);
    assert.equal(store.load(first.artifactRef).providerResponseId, "resp_output_store_1");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a crash-window lookup recovers only the exact stable hard-linked assignment claim", () => {
  const root = temporaryRoot("output-store-crash-window");
  try {
    const marker = "ordinary-lookup-marker";
    const providerResponse = {
      ...canonicalInput().providerResponse,
      message: marker,
    };
    const rawProviderBody = JSON.stringify(providerResponse);
    const input = canonicalInput({
      providerResponse,
      providerResponseHash: sha256(providerResponse),
      rawProviderBody,
      rawProviderBodyHash: sha256(rawProviderBody),
    });
    const store = createPreventureResearchOutputStore({ artifactRoot: root });
    const retained = store.retain(input);
    const binding = {
      authorityHash: input.authorityHash,
      assignmentHash: input.assignmentHash,
      descriptorHash: input.descriptorHash,
      requestBodyHash: input.requestBodyHash,
    };

    const recovered = store.loadByStableBinding(binding);
    assert.equal(recovered.artifactHash, retained.artifactHash);
    assert.equal(recovered.artifactRef, retained.artifactRef);
    assert.equal(store.loadByStableBinding({
      ...binding,
      assignmentHash: sha256("genuinely-missing-crash-window-assignment"),
    }), null);
    assert.throws(
      () => store.loadByStableBinding({ ...binding, taskAttemptId: "unsupported" }),
      { code: "preventure_output_shape_invalid" },
    );
    assert.throws(
      () => store.loadByStableBinding(binding, { sensitiveValues: [marker] }),
      (error) => error.code === "preventure_output_sensitive_value"
        && !String(error.message).includes(marker),
    );
    assert.throws(
      () => store.loadByStableBinding(binding, { sensitiveValue: ["misspelled"] }),
      { code: "preventure_output_shape_invalid" },
    );
    assert.throws(
      () => store.loadByStableBinding(binding, { sensitiveValues: "not-an-array" }),
      { code: "preventure_output_shape_invalid" },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent identical and conflicting first writes elect one claim without orphan artifacts", async () => {
  const identicalRoot = temporaryRoot("output-store-identical-race");
  const conflictRoot = temporaryRoot("output-store-conflict-race");
  try {
    const base = canonicalInput();
    const identical = await concurrentRetain(identicalRoot, [
      base,
      { ...base, retainedAt: "2026-08-02T00:00:01.000Z" },
    ]);
    assert.equal(identical.every((item) => item.ok), true);
    assert.equal(new Set(identical.map((item) => item.artifactRef)).size, 1);
    assert.equal(jsonFiles(identicalRoot).length, 1);

    const changedBilling = { ...base.billing, costAudCents: 3 };
    const conflicting = await concurrentRetain(conflictRoot, [
      base,
      {
        ...base,
        retainedAt: "2026-08-02T00:00:02.000Z",
        billing: changedBilling,
        billingHash: sha256(changedBilling),
      },
    ]);
    assert.equal(conflicting.filter((item) => item.ok).length, 1);
    assert.deepEqual(
      conflicting.filter((item) => !item.ok).map((item) => item.code),
      ["preventure_output_replay_conflict"],
    );
    assert.equal(jsonFiles(conflictRoot).length, 1);
  } finally {
    fs.rmSync(identicalRoot, { recursive: true, force: true });
    fs.rmSync(conflictRoot, { recursive: true, force: true });
  }
});

test("disk publication is reread and a swapped staging file cannot be reported as retained", () => {
  const root = temporaryRoot("output-store-publish-swap");
  const originalLink = fs.linkSync;
  let sabotaged = false;
  try {
    fs.linkSync = function sabotagingLink(source, destination) {
      if (
        !sabotaged
        && destination.endsWith(".json")
        && !destination.includes(`${path.sep}claims${path.sep}`)
      ) {
        sabotaged = true;
        fs.writeFileSync(source, "{\"tampered\":true}", "utf8");
      }
      return originalLink.call(fs, source, destination);
    };
    const store = createPreventureResearchOutputStore({ artifactRoot: root });
    assert.throws(
      () => store.retain(canonicalInput()),
      (error) => /preventure_output_artifact_/.test(String(error.code)),
    );
    assert.equal(jsonFiles(root, true).length, 0);
  } finally {
    fs.linkSync = originalLink;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("self-consistent full-reference forgery still fails derived-content validation", () => {
  const root = temporaryRoot("output-store-forgery");
  try {
    const store = createPreventureResearchOutputStore({ artifactRoot: root });
    const retained = store.retain(canonicalInput());
    const stored = JSON.parse(fs.readFileSync(contentFile(root, retained.artifactHash), "utf8"));
    stored.outputHash = sha256("forged-output-hash");
    const {
      artifactHash: _oldHash,
      artifactRef: _oldRef,
      location: _oldLocation,
      retained: _retained,
      retainedAt,
      ...semantic
    } = stored;
    const forgedHash = sha256({ ...semantic, retainedAt });
    stored.artifactHash = forgedHash;
    stored.artifactRef = `preventure-output:${forgedHash.slice(7)}`;
    stored.location = stored.artifactRef;
    const forgedFile = contentFile(root, forgedHash);
    fs.mkdirSync(path.dirname(forgedFile), { recursive: true });
    fs.writeFileSync(forgedFile, JSON.stringify(stored), "utf8");
    assert.throws(
      () => store.load(stored.artifactRef),
      { code: "preventure_output_artifact_changed" },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stable claim must remain a hard-link anchor to its content artifact", () => {
  const root = temporaryRoot("output-store-claim-tamper");
  try {
    const store = createPreventureResearchOutputStore({ artifactRoot: root });
    const input = canonicalInput();
    const retained = store.retain(input);
    const claim = claimFile(root, input);
    const content = contentFile(root, retained.artifactHash);
    fs.unlinkSync(claim);
    fs.copyFileSync(content, claim);
    assert.throws(
      () => store.retain(input),
      { code: "preventure_output_artifact_changed" },
    );
    assert.throws(
      () => store.load(retained.artifactRef),
      { code: "preventure_output_artifact_changed" },
    );
    const binding = {
      authorityHash: input.authorityHash,
      assignmentHash: input.assignmentHash,
      descriptorHash: input.descriptorHash,
      requestBodyHash: input.requestBodyHash,
    };
    assert.throws(
      () => store.loadByStableBinding(binding),
      { code: "preventure_output_artifact_changed" },
    );
    fs.unlinkSync(claim);
    assert.throws(
      () => store.load(retained.artifactRef),
      { code: "preventure_output_claim_missing" },
    );
    assert.equal(store.loadByStableBinding(binding), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a missing content path cannot be recovered from an unanchored claim alias", () => {
  const root = temporaryRoot("output-store-content-missing");
  try {
    const store = createPreventureResearchOutputStore({ artifactRoot: root });
    const input = canonicalInput();
    const retained = store.retain(input);
    fs.unlinkSync(contentFile(root, retained.artifactHash));
    assert.throws(
      () => store.load(retained.artifactRef),
      { code: "preventure_output_artifact_missing" },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("known malformed 2xx bodies retain null, array, scalar, non-JSON, and exact body IDs", () => {
  const root = temporaryRoot("output-store-malformed");
  try {
    const store = createPreventureResearchOutputStore({ artifactRoot: root });
    const cases = ["null", "[]", "42", "\"scalar\"", "not-json"];
    for (const [index, raw] of cases.entries()) {
      const input = invalidInput(raw, index);
      const retained = store.retain(input);
      assert.deepEqual(retained.providerResponse, input.providerResponse);
      assert.equal(retained.providerResponseId, null);
      assert.equal(retained.rawProviderBody, raw);
      assert.equal(store.loadByStableBinding({
        authorityHash: input.authorityHash,
        assignmentHash: input.assignmentHash,
        descriptorHash: input.descriptorHash,
        requestBodyHash: input.requestBodyHash,
      }).artifactHash, retained.artifactHash);
    }
    const withId = invalidInput('{"id":"resp_malformed_1","status":"malformed"}', "with-id");
    assert.throws(
      () => store.retain({ ...withId, providerResponseId: null }),
      { code: "preventure_output_invalid_effect_changed" },
    );
    assert.equal(store.retain(withId).providerResponseId, "resp_malformed_1");
    const withoutId = invalidInput('{"status":"malformed"}', "without-id");
    assert.equal(store.retain(withoutId).providerResponseId, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("official pre-effect errors retain exact uncertainty and reject settled-zero claims", () => {
  const root = temporaryRoot("output-store-pre-effect");
  try {
    const store = createPreventureResearchOutputStore({ artifactRoot: root });
    const input = preEffectInput();
    const retained = store.retain(input);
    assert.equal(retained.artifactKind, "known_pre_effect_rejection");
    assert.equal(retained.providerResponseId, null);
    assert.equal(retained.output, null);
    assert.equal(retained.billing.costStatus, "estimated");
    assert.equal(retained.billing.exactBillingPending, true);
    assert.equal(retained.billing.exposureAudCents, 50);
    assert.equal(store.loadByStableBinding({
      authorityHash: input.authorityHash,
      assignmentHash: input.assignmentHash,
      descriptorHash: input.descriptorHash,
      requestBodyHash: input.requestBodyHash,
    }).artifactHash, retained.artifactHash);

    assert.throws(
      () => store.retain({
        ...input,
        assignmentHash: sha256("pre-effect-mismatched-error-assignment"),
        descriptorHash: sha256("pre-effect-mismatched-error-descriptor"),
        requestBodyHash: sha256("pre-effect-mismatched-error-request"),
        responseMetadata: { ...input.responseMetadata, providerErrorCode: "changed" },
      }),
      { code: "preventure_output_pre_effect_changed" },
    );

    const settled = { ...input.billing, costStatus: "reconciled", exactBillingPending: false };
    assert.throws(
      () => store.retain({
        ...input,
        assignmentHash: sha256("pre-effect-settled-assignment"),
        descriptorHash: sha256("pre-effect-settled-descriptor"),
        requestBodyHash: sha256("pre-effect-settled-request"),
        billing: settled,
        billingHash: sha256(settled),
      }),
      { code: "preventure_output_pre_effect_changed" },
    );

    for (const exposureAudCents of [1, 51]) {
      const billing = { ...input.billing, exposureAudCents };
      assert.throws(
        () => store.retain({
          ...input,
          assignmentHash: sha256(`pre-effect-exposure-${exposureAudCents}-assignment`),
          descriptorHash: sha256(`pre-effect-exposure-${exposureAudCents}-descriptor`),
          requestBodyHash: sha256(`pre-effect-exposure-${exposureAudCents}-request`),
          billing,
          billingHash: sha256(billing),
        }),
        { code: "preventure_output_pre_effect_changed" },
      );
    }

    for (const claimedCap of [49, 51, 999]) {
      const billing = { ...input.billing, exposureAudCents: claimedCap };
      assert.throws(
        () => store.retain({
          ...input,
          assignmentMaxCostAudCents: claimedCap,
          assignmentHash: sha256(`pre-effect-cap-${claimedCap}-assignment`),
          descriptorHash: sha256(`pre-effect-cap-${claimedCap}-descriptor`),
          requestBodyHash: sha256(`pre-effect-cap-${claimedCap}-request`),
          billing,
          billingHash: sha256(billing),
        }),
        { code: "preventure_output_assignment_cap_invalid" },
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("health is blocked when the configured filesystem cannot make exact hard links", () => {
  const root = temporaryRoot("output-store-health-links");
  const originalLink = fs.linkSync;
  try {
    const store = createPreventureResearchOutputStore({ artifactRoot: root });
    fs.linkSync = function unsupportedLink() {
      const error = new Error("Hard links are unavailable.");
      error.code = "ENOTSUP";
      throw error;
    };
    const health = store.status();
    assert.equal(health.ready, false);
    assert.equal(health.status, "blocked");
    assert.equal(health.blocker, "artifact_root_not_secure_writable_directory");
    assert.equal(jsonFiles(root, true).length, 0);
  } finally {
    fs.linkSync = originalLink;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("request/client identities, raw bytes, and reference aliases cannot be omitted or changed", () => {
  const root = temporaryRoot("output-store-bindings");
  try {
    const store = createPreventureResearchOutputStore({ artifactRoot: root });
    const input = canonicalInput();
    const retained = store.retain(input);
    assert.throws(
      () => store.retain({ ...input, clientRequestId: undefined }),
      { code: "preventure_output_provider_id_invalid" },
    );
    assert.throws(
      () => store.retain({ ...input, clientRequestId: "pantheon-output-store-client-changed" }),
      { code: "preventure_output_replay_conflict" },
    );
    assert.throws(
      () => store.retain({ ...input, requestBodyHash: undefined }),
      { code: "preventure_output_hash_invalid" },
    );
    assert.throws(
      () => store.retain({ ...input, retainedAt: undefined }),
      { code: "preventure_output_time_invalid" },
    );
    assert.throws(
      () => store.retain({
        ...input,
        rawProviderBodyBytes: Buffer.from(`${input.rawProviderBody} `),
      }),
      { code: "preventure_output_raw_body_changed" },
    );
    assert.throws(
      () => store.load({
        retainedOutputHash: retained.artifactRef,
        artifactRef: `preventure-output:${"0".repeat(64)}`,
      }),
      { code: "preventure_output_reference_binding_changed" },
    );
    assert.throws(
      () => store.load(contentFile(root, retained.artifactHash)),
      { code: "preventure_output_reference_invalid" },
    );
    assert.equal(jsonFiles(root).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("configured 6 MiB raw limit remains readable and over-limit input leaves no artifact", () => {
  const root = temporaryRoot("output-store-size");
  try {
    const store = createPreventureResearchOutputStore({
      artifactRoot: root,
      maximumBytes: 6 * MIB,
      maximumManifestBytes: 25 * MIB,
    });
    const within = invalidInput("x".repeat(Math.floor(5.5 * MIB)), "large-within");
    const retained = store.retain(within);
    assert.equal(store.load(retained.artifactRef).rawProviderBody.length, within.rawProviderBody.length);

    const otherRoot = temporaryRoot("output-store-over-size");
    try {
      const other = createPreventureResearchOutputStore({
        artifactRoot: otherRoot,
        maximumBytes: 6 * MIB,
        maximumManifestBytes: 25 * MIB,
      });
      const over = invalidInput("y".repeat((6 * MIB) + 1), "large-over");
      assert.throws(
        () => other.retain(over),
        { code: "preventure_output_artifact_too_large" },
      );
      assert.equal(jsonFiles(otherRoot, true).length, 0);
    } finally {
      fs.rmSync(otherRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("linked roots, linked child prefixes, and path-like references fail closed", (t) => {
  const sandbox = temporaryRoot("output-store-links");
  try {
    const realRoot = path.join(sandbox, "real-root");
    const linkedRoot = path.join(sandbox, "linked-root");
    fs.mkdirSync(realRoot);
    try {
      fs.symlinkSync(realRoot, linkedRoot, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
        t.skip("Directory links are unavailable in this test environment.");
        return;
      }
      throw error;
    }
    assert.throws(
      () => createPreventureResearchOutputStore({ artifactRoot: linkedRoot }),
      { code: "preventure_output_path_invalid" },
    );

    const childRoot = path.join(sandbox, "child-root");
    const store = createPreventureResearchOutputStore({ artifactRoot: childRoot });
    const retained = store.retain(canonicalInput());
    const prefix = path.dirname(contentFile(childRoot, retained.artifactHash));
    const moved = path.join(sandbox, "moved-prefix");
    fs.renameSync(prefix, moved);
    fs.symlinkSync(moved, prefix, process.platform === "win32" ? "junction" : "dir");
    assert.throws(
      () => store.load(retained.artifactRef),
      { code: "preventure_output_path_invalid" },
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("unrelated secret-shaped input is neither persisted nor exposed by status/errors", () => {
  const root = temporaryRoot("output-store-secret");
  const secret = "sk-output-store-must-not-persist-123456";
  try {
    const store = createPreventureResearchOutputStore({ artifactRoot: root });
    const retained = store.retain({
      ...canonicalInput(),
      apiKey: secret,
      authorization: `Bearer ${secret}`,
    });
    const allBytes = jsonFiles(root, true)
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    assert.equal(allBytes.includes(secret), false);
    assert.equal(JSON.stringify(store.status()).includes(secret), false);
    assert.throws(
      () => store.load(`${root}${path.sep}${secret}`),
      (error) => !String(error.message).includes(secret),
    );
    assert.equal(store.load(retained.artifactRef).artifactHash, retained.artifactHash);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("nested provider artifacts use exact safe fields and known credentials never reach disk", () => {
  const root = temporaryRoot("output-store-nested-secrets");
  const secret = "credential-value-without-provider-prefix-9081726354";
  try {
    const store = createPreventureResearchOutputStore({ artifactRoot: root });
    const canonical = canonicalInput({
      assignmentHash: sha256("nested-secret-assignment-base"),
      descriptorHash: sha256("nested-secret-descriptor-base"),
      requestBodyHash: sha256("nested-secret-request-base"),
    });
    const unsafeProviderResponse = {
      ...canonical.providerResponse,
      output: [{
        id: "msg_nested_secret_1",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{
          type: "output_text",
          text: "{}",
          annotations: [],
          headers: { authorization: secret },
        }],
      }],
    };
    const rawUnsafeProviderResponse = JSON.stringify(unsafeProviderResponse);
    const groundedSource = {
      url: "https://example.com/safe-source",
      provenance: ["web_search_action_source"],
      titles: ["Safe source"],
      publishers: ["Example"],
      snippets: ["A public result."],
      publishedAtValues: [],
    };
    const cases = [
      canonicalInput({
        assignmentHash: sha256("nested-secret-assignment-provider"),
        descriptorHash: sha256("nested-secret-descriptor-provider"),
        requestBodyHash: sha256("nested-secret-request-provider"),
        providerResponse: unsafeProviderResponse,
        providerResponseHash: sha256(unsafeProviderResponse),
        rawProviderBody: rawUnsafeProviderResponse,
        rawProviderBodyHash: sha256(rawUnsafeProviderResponse),
      }),
      canonicalInput({
        assignmentHash: sha256("nested-secret-assignment-billing"),
        descriptorHash: sha256("nested-secret-descriptor-billing"),
        requestBodyHash: sha256("nested-secret-request-billing"),
        billing: { ...canonical.billing, headers: { authorization: secret } },
        billingHash: sha256({ ...canonical.billing, headers: { authorization: secret } }),
      }),
      canonicalInput({
        assignmentHash: sha256("nested-secret-assignment-metadata"),
        descriptorHash: sha256("nested-secret-descriptor-metadata"),
        requestBodyHash: sha256("nested-secret-request-metadata"),
        responseMetadata: {
          httpStatus: 200,
          responseIssues: [],
          csrf: secret,
        },
      }),
      canonicalInput({
        assignmentHash: sha256("nested-secret-assignment-grounding"),
        descriptorHash: sha256("nested-secret-descriptor-grounding"),
        requestBodyHash: sha256("nested-secret-request-grounding"),
        groundedSources: [{ ...groundedSource, cookies: { session: secret } }],
        groundedSourceSetHash: sha256([{ ...groundedSource, cookies: { session: secret } }]),
      }),
      canonicalInput({
        assignmentHash: sha256("nested-secret-assignment-known-value"),
        descriptorHash: sha256("nested-secret-descriptor-known-value"),
        requestBodyHash: sha256("nested-secret-request-known-value"),
        output: `Provider echoed ${secret}`,
        sensitiveValues: [secret],
      }),
      canonicalInput({
        assignmentHash: sha256("nested-secret-assignment-token-shape"),
        descriptorHash: sha256("nested-secret-descriptor-token-shape"),
        requestBodyHash: sha256("nested-secret-request-token-shape"),
        output: "Bearer token-material-that-must-never-persist-123456",
      }),
    ];
    for (const input of cases) {
      assert.throws(
        () => store.retain(input),
        (error) => (
          ["preventure_output_shape_invalid", "preventure_output_sensitive_value"].includes(error.code)
          && !String(error.message).includes(secret)
        ),
      );
    }
    const bytes = jsonFiles(root, true).map((file) => fs.readFileSync(file, "utf8")).join("\n");
    assert.equal(bytes.includes(secret), false);
    assert.equal(JSON.stringify(store.status()).includes(secret), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("known credentials in retained request identities leave no artifact or error leak", () => {
  const root = temporaryRoot("output-store-secret-identities");
  const secret = "req_known_secret_identity_9081726354";
  try {
    const store = createPreventureResearchOutputStore({ artifactRoot: root });
    const cases = [
      canonicalInput({
        assignmentHash: sha256("secret-provider-request-id-assignment"),
        descriptorHash: sha256("secret-provider-request-id-descriptor"),
        requestBodyHash: sha256("secret-provider-request-id-request"),
        providerRequestId: secret,
        sensitiveValues: [secret],
      }),
      canonicalInput({
        assignmentHash: sha256("secret-client-request-id-assignment"),
        descriptorHash: sha256("secret-client-request-id-descriptor"),
        requestBodyHash: sha256("secret-client-request-id-request"),
        clientRequestId: secret,
        sensitiveValues: [secret],
      }),
    ];
    for (const input of cases) {
      let failure = null;
      assert.throws(
        () => store.retain(input),
        (error) => {
          failure = error;
          return error.code === "preventure_output_sensitive_value";
        },
      );
      assert.equal(JSON.stringify({
        message: failure.message,
        code: failure.code,
        ...Object.fromEntries(Object.keys(failure).map((key) => [key, failure[key]])),
      }).includes(secret), false);
    }
    assert.equal(jsonFiles(root, true).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("known sensitive values are rejected even when shorter than credential-shaped patterns", () => {
  const root = temporaryRoot("output-store-short-secret");
  const secret = "tiny7";
  try {
    const store = createPreventureResearchOutputStore({ artifactRoot: root });
    assert.throws(
      () => store.retain(canonicalInput({
        providerRequestId: secret,
        sensitiveValues: [secret],
      })),
      (error) => error.code === "preventure_output_sensitive_value"
        && !String(error.message).includes(secret),
    );
    const files = fs.readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile());
    assert.deepEqual(files, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("provider request, response-body, and client request identities cannot collide", () => {
  const root = temporaryRoot("output-store-identity-collision");
  try {
    const store = createPreventureResearchOutputStore({ artifactRoot: root });
    const base = canonicalInput({ providerRequestId: "req_output_store_1" });
    for (const changed of [
      { ...base, providerRequestId: base.providerResponseId },
      { ...base, providerRequestId: base.clientRequestId },
      { ...base, providerResponseId: base.clientRequestId },
    ]) {
      assert.throws(
        () => store.retain(changed),
        { code: "preventure_output_provider_id_collision" },
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
