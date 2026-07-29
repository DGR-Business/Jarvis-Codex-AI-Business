const {
  SDK_GUARDRAIL_POLICY_VERSION,
  verifyAgentHarnessDescriptor,
  verifyAgentTraceGroup,
} = require("./agent-harness");

const PROTECTED_EXTERNAL_EFFECTS = [
  "publish",
  "public post",
  "customer contact",
  "account creation",
  "account change",
  "kyc",
  "money movement",
  "payment",
  "advertising activation",
  "legal agreement",
];

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function guardrailOutput(checks) {
  const failed = checks.filter((check) => check.status === "failed");
  return {
    tripwireTriggered: failed.length > 0,
    outputInfo: {
      schema: "pantheon.sdk-guardrail-result.v1",
      policyVersion: SDK_GUARDRAIL_POLICY_VERSION,
      status: failed.length ? "blocked" : "passed",
      checks,
      findings: failed.map((check) => check.finding),
    },
  };
}

function inputGuardrailResult(task, agentDefinition, capabilityPlan) {
  const request = task?.payload?.liveSpendRequest || {};
  const effects = Array.isArray(request.effects) ? request.effects : [];
  const protectedEffects = effects.filter((effect) => (
    PROTECTED_EXTERNAL_EFFECTS.some((phrase) => normalizedText(effect).toLowerCase().includes(phrase))
  ));
  const requestedTools = Array.isArray(request.tools) ? request.tools : [];
  const plannedTools = Array.isArray(capabilityPlan?.requestedTools) ? capabilityPlan.requestedTools : [];
  const contextClasses = request.parameters?.contextSnapshot?.recordClasses || [];
  const restrictedContextClasses = contextClasses.filter((item) => (
    /\b(?:credential|password|secret|payment[_ -]?credential|authentication token)\b/i.test(String(item))
  ));
  const harnessCheck = verifyAgentHarnessDescriptor(request.agentHarness);
  const traceGroupCheck = verifyAgentTraceGroup(request.traceGroup, task);
  const checks = [
    {
      id: "agent_harness",
      status: harnessCheck.valid ? "passed" : "failed",
      finding: harnessCheck.valid ? "The exact agent harness is valid." : harnessCheck.reason,
    },
    {
      id: "trace_group",
      status: traceGroupCheck.valid ? "passed" : "failed",
      finding: traceGroupCheck.valid ? "The commercial trace group is valid." : traceGroupCheck.reason,
    },
    {
      id: "worker_identity",
      status: request.agentHarness?.worker?.id === agentDefinition?.id ? "passed" : "failed",
      finding: request.agentHarness?.worker?.id === agentDefinition?.id
        ? "The harness worker matches the executing specialist."
        : "The harness worker does not match the executing specialist.",
    },
    {
      id: "tool_plan",
      status: JSON.stringify([...requestedTools].sort()) === JSON.stringify([...plannedTools].sort()) ? "passed" : "failed",
      finding: JSON.stringify([...requestedTools].sort()) === JSON.stringify([...plannedTools].sort())
        ? "The SDK tool plan matches the exact approved tools."
        : "The SDK tool plan differs from the exact approved tools.",
    },
    {
      id: "protected_effects",
      status: protectedEffects.length ? "failed" : "passed",
      finding: protectedEffects.length
        ? `Protected external effects are not available in this worker run: ${protectedEffects.join(", ")}.`
        : "No protected external effect is exposed to this worker run.",
    },
    {
      id: "context_minimization",
      status: restrictedContextClasses.length ? "failed" : "passed",
      finding: restrictedContextClasses.length
        ? `Credential-bearing context classes are outside this worker's approved input: ${restrictedContextClasses.join(", ")}.`
        : "No credential-bearing context class is supplied to the worker.",
    },
  ];
  return guardrailOutput(checks);
}

function hasAffirmativeClaim(text, pattern) {
  const clauses = normalizedText(text).split(/[.!?;\n]+/).filter(Boolean);
  return clauses.some((clause) => (
    pattern.test(clause)
    && !/\b(?:no|not|never|without|cannot|can't|did not|has not|have not|must not|do not)\b/i.test(clause)
  ));
}

function outputGuardrailResult(agentOutput) {
  const output = agentOutput && typeof agentOutput === "object" ? agentOutput : null;
  const serialized = JSON.stringify(agentOutput || "");
  const claimsExternalCompletion = hasAffirmativeClaim(
    serialized,
    /\b(?:published|posted publicly|contacted customers?|launched the campaign|created the account|completed KYC|charged the card|spent A?\$)\b/i,
  );
  const claimsGuarantee = hasAffirmativeClaim(
    serialized,
    /\b(?:guaranteed profit|guaranteed sales|guaranteed results|certain to succeed|risk[- ]free return)\b/i,
  );
  const placeholder = /\b(?:lorem ipsum|placeholder|insert (?:text|price|link) here|TBC|TBD|TODO)\b/i.test(serialized);
  const authorityExpanded = /"externalActionsAllowed"\s*:\s*true/i.test(serialized);
  const checks = [
    {
      id: "structured_output",
      status: output && !Array.isArray(output) ? "passed" : "failed",
      finding: output && !Array.isArray(output)
        ? "The worker returned structured output."
        : "The worker did not return the required structured output.",
    },
    {
      id: "protected_completion_claim",
      status: claimsExternalCompletion ? "failed" : "passed",
      finding: claimsExternalCompletion
        ? "The worker claimed a protected external action that was not available."
        : "The worker did not claim a protected external action.",
    },
    {
      id: "guaranteed_outcome",
      status: claimsGuarantee ? "failed" : "passed",
      finding: claimsGuarantee
        ? "The worker made an unsupported guaranteed-outcome claim."
        : "The worker did not guarantee a commercial outcome.",
    },
    {
      id: "placeholder_material",
      status: placeholder ? "failed" : "passed",
      finding: placeholder
        ? "The worker presented placeholder material as completed work."
        : "The worker output contains no placeholder material.",
    },
    {
      id: "authority_expansion",
      status: authorityExpanded ? "failed" : "passed",
      finding: authorityExpanded
        ? "The worker attempted to expand its external-action authority."
        : "The worker kept external-action authority locked.",
    },
  ];
  return guardrailOutput(checks);
}

function buildAgentsSdkGuardrails(task, agentDefinition, capabilityPlan) {
  const input = {
    name: "Pantheon exact scope and authority",
    runInParallel: false,
    execute: async () => inputGuardrailResult(task, agentDefinition, capabilityPlan),
  };
  const output = {
    name: "Pantheon output authority and completion",
    execute: async ({ agentOutput }) => outputGuardrailResult(agentOutput),
  };
  return {
    policyVersion: SDK_GUARDRAIL_POLICY_VERSION,
    inputGuardrails: [input],
    outputGuardrails: [output],
    preflight() {
      return inputGuardrailResult(task, agentDefinition, capabilityPlan);
    },
    checkOutput(agentOutput) {
      return outputGuardrailResult(agentOutput);
    },
  };
}

function summarizeSdkGuardrailResults(result, preflight = null) {
  const normalize = (item) => ({
    name: item?.guardrail?.name || null,
    tripwireTriggered: item?.output?.tripwireTriggered === true,
    outputInfo: item?.output?.outputInfo || null,
  });
  return {
    schema: "pantheon.sdk-guardrail-activity.v1",
    policyVersion: SDK_GUARDRAIL_POLICY_VERSION,
    preflight: preflight?.outputInfo || null,
    input: Array.isArray(result?.inputGuardrailResults) ? result.inputGuardrailResults.map(normalize) : [],
    output: Array.isArray(result?.outputGuardrailResults) ? result.outputGuardrailResults.map(normalize) : [],
  };
}

module.exports = {
  buildAgentsSdkGuardrails,
  inputGuardrailResult,
  outputGuardrailResult,
  summarizeSdkGuardrailResults,
};
