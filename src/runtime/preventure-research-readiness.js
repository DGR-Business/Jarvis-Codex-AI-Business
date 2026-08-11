"use strict";

const { sha256 } = require("./commercial-test-contract");
const {
  createPreventureResearchDecision,
} = require("./preventure-research-contract");
const {
  validatePreventureResearchTerminalStop,
} = require("./preventure-research-terminal-stop");

const PREVENTURE_RESEARCH_READINESS_SCHEMA =
  "pantheon.preventure-research-readiness.v1";

function readinessError(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sortedHashes(records, key) {
  return records.map((record) => record?.[key]).filter(Boolean).sort();
}

function valueFrom(record, camel, snake) {
  return record?.[camel] ?? record?.[snake] ?? null;
}

function snapshotHash(record) {
  return valueFrom(record, "snapshotHash", "snapshot_hash")
    || valueFrom(record, "sourceSnapshotHash", "source_snapshot_hash");
}

function latestCostExposure(costEvents) {
  const latestByKey = new Map();
  for (const event of asArray(costEvents)) {
    const assignmentHash = String(event?.assignmentHash || "");
    const costKey = String(event?.costKey || "");
    if (!assignmentHash || !costKey) continue;
    const key = `${assignmentHash}\u0000${costKey}`;
    const prior = latestByKey.get(key);
    const sequence = Number(event.sequence || 0);
    const priorSequence = Number(prior?.sequence || 0);
    if (
      !prior
      || sequence > priorSequence
      || (
        sequence === priorSequence
        && String(event.occurredAt || "") > String(prior.occurredAt || "")
      )
    ) {
      latestByKey.set(key, event);
    }
  }
  const latest = [...latestByKey.values()];
  const exposureAudCents = latest.reduce(
    (sum, event) => sum + (Number.isSafeInteger(event.exposureAudCents) ? event.exposureAudCents : 0),
    0,
  );
  const reconciledAudCents = latest.reduce(
    (sum, event) => sum + (
      event.eventType === "reconciled" && Number.isSafeInteger(event.amountAudCents)
        ? event.amountAudCents
        : 0
    ),
    0,
  );
  const estimatedAudCents = latest.reduce(
    (sum, event) => sum + (
      ["estimated", "incurred"].includes(event.eventType)
      && Number.isSafeInteger(event.amountAudCents)
        ? event.amountAudCents
        : 0
    ),
    0,
  );
  return {
    latest,
    exposureAudCents,
    reconciledAudCents,
    estimatedAudCents,
    pendingReservationCount: latest.filter((event) => event.eventType === "reserved").length,
    exactBillingPending: latest.some((event) => (
      ["estimated", "incurred", "unknown"].includes(event.eventType)
    )),
    unknownCount: latest.filter((event) => event.eventType === "unknown").length,
  };
}

function exactAssignments(authority, storedAssignments) {
  const templates = new Map(
    asArray(authority.assignments).map((template) => [template.id, template]),
  );
  const stored = asArray(storedAssignments);
  const issues = [];
  if (stored.length !== templates.size) {
    issues.push("The complete accepted assignment set is not materialized.");
  }
  for (const assignment of stored) {
    const template = templates.get(assignment.id);
    if (
      !template
      || assignment.authorityHash !== authority.authorityHash
      || assignment.templateHash !== sha256(template)
      || assignment.provider !== authority.provider.id
      || assignment.model !== authority.provider.model
      || assignment.maxCostAudCents !== template.maxCostAudCents
      || assignment.maxAttempts !== 1
      || assignment.maxToolCalls !== template.maxToolCalls
      || assignment.maximumModelPasses !== template.maximumModelPasses
      || assignment.maxInputTokens !== template.maxInputTokens
      || assignment.localPromptPreflightMaxInputTokens
        !== template.localPromptPreflightMaxInputTokens
      || assignment.maxOutputTokens !== template.maxOutputTokens
      || assignment.maxTurns !== 1
      || sha256(assignment.worstCaseExposure) !== sha256(template.worstCaseExposure)
      || assignment.expiresAt !== authority.expiresAt
    ) {
      issues.push(`Assignment ${String(assignment.id || "unknown")} is outside the accepted authority.`);
    }
  }
  return {
    complete: issues.length === 0,
    issues,
    expected: templates.size,
    materialized: stored.length,
  };
}

function evidenceCoverage(authority, ledger) {
  const sources = asArray(ledger.sourceSnapshots);
  const evidence = asArray(ledger.evidenceRecords);
  const assignmentHashes = new Set(asArray(ledger.assignments).map((item) => item.assignmentHash));
  const sourceHashes = new Set(sources.map(snapshotHash).filter(Boolean));
  const orphanSources = sources.filter(
    (source) => source.assignmentHash && !assignmentHashes.has(source.assignmentHash),
  );
  const orphanEvidence = evidence.filter((record) => (
    record.assignmentHash && !assignmentHashes.has(record.assignmentHash)
  ) || (
    valueFrom(record, "sourceSnapshotHash", "source_snapshot_hash")
      && !sourceHashes.has(valueFrom(record, "sourceSnapshotHash", "source_snapshot_hash"))
  ));
  const contraryQuestionIds = new Set(
    evidence.filter((record) => record.polarity === "contrary").map((record) => record.questionId),
  );
  const requiredQuestionIds = asArray(authority.researchQuestions).map((item) => item.id);
  const missingContraryQuestions = requiredQuestionIds.filter(
    (questionId) => !contraryQuestionIds.has(questionId),
  );
  const receiptIds = new Set();
  for (const record of [...asArray(ledger.costEvents), ...sources]) {
    if (record.agentRunReceiptId) receiptIds.add(record.agentRunReceiptId);
  }
  const capturedSources = sources.filter((source) => source.captureStatus === "captured");
  return {
    sourceCount: sources.length,
    capturedSourceCount: capturedSources.length,
    partialOrBlockedSourceCount: sources.length - capturedSources.length,
    evidenceCount: evidence.length,
    contraryEvidenceCount: evidence.filter((record) => record.polarity === "contrary").length,
    unknownEvidenceCount: evidence.filter((record) => record.truthClass === "unknown").length,
    orphanSourceCount: orphanSources.length,
    orphanEvidenceCount: orphanEvidence.length,
    missingContraryQuestions,
    linkedReceiptIds: [...receiptIds].sort(),
    sourceSetHash: sha256(sources.map(snapshotHash).filter(Boolean).sort()),
    evidenceSetHash: sha256({
      authorityHash: authority.authorityHash,
      sourceSnapshotHashes: sources.map(snapshotHash).filter(Boolean).sort(),
      evidenceHashes: sortedHashes(evidence, "evidenceHash"),
    }),
    receiptSetHash: sha256({
      authorityHash: authority.authorityHash,
      costReceiptHashes: asArray(ledger.costEvents)
        .map((item) => valueFrom(item, "receiptHash", "receipt_hash"))
        .filter(Boolean)
        .sort(),
      sourceSnapshotHashes: sources.map(snapshotHash).filter(Boolean).sort(),
      agentRunReceiptHashes: asArray(ledger.executionEvidence?.agentRunReceipts)
        .map((item) => valueFrom(item, "receiptHash", "receipt_hash"))
        .filter(Boolean)
        .sort(),
      taskAttemptIds: asArray(ledger.executionEvidence?.taskAttempts)
        .map((item) => item.id)
        .filter(Boolean)
        .sort(),
      modelCallIds: asArray(ledger.executionEvidence?.modelCalls)
        .map((item) => item.id)
        .filter(Boolean)
        .sort(),
    }),
  };
}

function latestImmutableHeads(records, hashKey, supersedesKey) {
  const rows = asArray(records);
  const superseded = new Set(rows.map((record) => record?.[supersedesKey]).filter(Boolean));
  return rows.filter((record) => !superseded.has(record?.[hashKey]));
}

function comparatorCoverage(authority, records, sourceFor) {
  const comparators = new Map();
  for (const record of records) {
    const comparator = record?.details?.comparator;
    const source = sourceFor(record);
    if (
      !isObject(comparator)
      || !source?.offerIdentityKey
      || comparator.id !== source.offerIdentityKey
      || comparator.channelId !== source.marketplaceChannelId
      || comparator.sellerId !== source.sellerIdentityKey
      || !["etsy", "gumroad"].includes(comparator.channelId)
      || !Array.isArray(comparator.formatIds)
      || comparator.formatIds.length < 1
      || comparator.formatIds.some((formatId) => !asArray(authority.formats).includes(formatId))
      || !Number.isSafeInteger(comparator.reviewObservationCount)
      || (source.captureStatus === "partial" && comparator.reviewObservationCount !== 0)
    ) continue;
    const prior = comparators.get(source.offerIdentityKey);
    if (!prior || JSON.stringify(prior.comparator) === JSON.stringify(comparator)) {
      comparators.set(source.offerIdentityKey, { comparator, source });
    }
  }
  const observed = [...comparators.values()];
  const values = observed.filter(({ comparator }) => comparator.sellerId !== null)
    .map(({ comparator }) => comparator);
  const categoryCount = (category) => values.filter((item) => item.category === category).length;
  const sellerCounts = new Map();
  for (const item of values) {
    if (typeof item.sellerId !== "string" || !item.sellerId) continue;
    sellerCounts.set(item.sellerId, (sellerCounts.get(item.sellerId) || 0) + 1);
  }
  const reviewObservationCount = observed.reduce(
    (sum, { comparator }) => sum + (Number.isSafeInteger(comparator.reviewObservationCount)
      ? comparator.reviewObservationCount
      : 0),
    0,
  );
  const result = {
    comparatorCount: observed.length,
    decisionGradeComparatorCount: values.length,
    directOrNearDirectCount: categoryCount("direct_or_near_direct"),
    adjacentCount: categoryCount("adjacent"),
    indirectCount: categoryCount("indirect"),
    maximumAcceptedOffersPerSeller: Math.max(0, ...sellerCounts.values()),
    sellerIdentityComplete: values.length === observed.length,
    reviewObservationCount,
    perFormatCounts: Object.fromEntries(asArray(authority.formats).map((formatId) => [
      formatId,
      values.filter((item) => asArray(item.formatIds).includes(formatId)).length,
    ])),
    observedChannelIds: [...new Set(observed
      .map(({ comparator }) => comparator.channelId)
      .filter(Boolean))].sort(),
  };
  const scope = authority.comparatorScope;
  result.complete = values.length >= scope.minimumOffers
    && observed.length <= scope.maximumOffers
    && result.directOrNearDirectCount >= scope.directOrNearDirectMinimum
    && result.adjacentCount >= scope.adjacentMinimum
    && result.indirectCount >= scope.indirectMinimum
    && result.maximumAcceptedOffersPerSeller <= scope.acceptedOffersPerSellerMaximum
    && result.reviewObservationCount <= scope.reviewObservationMaximum
    && asArray(authority.formats).every(
      (formatId) => result.perFormatCounts[formatId] >= scope.minimumPerApprovedFormat,
    )
    && result.observedChannelIds.includes("etsy")
    && result.observedChannelIds.includes("gumroad");
  return result;
}

function commercialEvidenceCoverage(authority, ledger, generatedAt) {
  const sources = latestImmutableHeads(
    ledger.sourceSnapshots,
    "snapshotHash",
    "supersedesSnapshotHash",
  );
  const evidence = latestImmutableHeads(
    ledger.evidenceRecords,
    "evidenceHash",
    "supersedesEvidenceHash",
  );
  const sourcesByHash = new Map(sources.map((source) => [source.snapshotHash, source]));
  const sourceFor = (record) => sourcesByHash.get(record?.sourceSnapshotHash) || null;
  const capturedEvidence = evidence.filter((record) => {
    const source = sourceFor(record);
    return source?.captureStatus === "captured"
      && record.truthClass === "observed_fact";
  });
  const capturedCaseEvidence = evidence.filter((record) => {
    const source = sourceFor(record);
    return source?.captureStatus === "captured"
      && record.truthClass !== "unknown"
      && typeof record.criterionId === "string";
  });
  const comparatorRecords = evidence.filter((record) => isObject(record?.details?.comparator));
  const capturedComparatorRecords = capturedEvidence.filter(
    (record) => isObject(record?.details?.comparator),
  );
  const exploratoryComparators = comparatorCoverage(authority, comparatorRecords, sourceFor);
  const capturedComparators = comparatorCoverage(authority, capturedComparatorRecords, sourceFor);

  const seenBuyerSources = new Set();
  const buyerRows = capturedEvidence.filter((record) => {
    const buyer = record?.details?.buyerEvidence;
    const source = sourceFor(record);
    const sourceKey = snapshotHash(source);
    if (!isObject(buyer) || !source || !sourceKey || seenBuyerSources.has(sourceKey)) return false;
    const purchaser = buyer.kind === "purchaser_attributable_behaviour";
    const exact = buyer.independenceGroup === source.buyerIndependenceGroup
      && (purchaser
        ? Boolean(source.offerIdentityKey && source.sellerIdentityKey)
          && buyer.paidOfferId === source.offerIdentityKey
          && buyer.sellerOrPublisherId === source.sellerIdentityKey
        : buyer.paidOfferId === null
          && buyer.sellerOrPublisherId === source.publisherIdentityKey);
    if (!exact) return false;
    seenBuyerSources.add(sourceKey);
    return true;
  });
  const buyerProblemRows = buyerRows.filter((record) => [
    "consequence",
    "workaround_or_spending_trigger",
    "purchaser_attributable_behaviour",
  ].includes(record.details.buyerEvidence.kind));
  const consequenceRows = buyerRows.filter(
    (record) => record.details.buyerEvidence.kind === "consequence",
  );
  const workaroundRows = buyerRows.filter(
    (record) => record.details.buyerEvidence.kind === "workaround_or_spending_trigger",
  );
  const purchaserRows = buyerRows.filter(
    (record) => record.details.buyerEvidence.kind === "purchaser_attributable_behaviour",
  );
  const buyerProblem = {
    evidenceUnitCount: buyerProblemRows.length,
    independenceGroupCount: new Set(buyerProblemRows.map(
      (record) => record.details.buyerEvidence.independenceGroup,
    )).size,
    consequenceCount: consequenceRows.length,
    workaroundOrSpendingTriggerCount: workaroundRows.length,
  };
  buyerProblem.decisionGrade = buyerProblem.evidenceUnitCount >= 6
    && buyerProblem.independenceGroupCount >= 3
    && buyerProblem.consequenceCount >= 3
    && buyerProblem.workaroundOrSpendingTriggerCount >= 2;
  const directDemand = {
    purchaserAttributableCount: purchaserRows.length,
    paidOfferCount: new Set(purchaserRows.map(
      (record) => record.details.buyerEvidence.paidOfferId,
    ).filter(Boolean)).size,
    sellerOrPublisherCount: new Set(purchaserRows.map(
      (record) => record.details.buyerEvidence.sellerOrPublisherId,
    ).filter(Boolean)).size,
    exactWorkflowRelevanceCount: purchaserRows.filter(
      (record) => record.details.buyerEvidence.exactWorkflowRelevance === true,
    ).length,
  };
  directDemand.decisionGrade = directDemand.purchaserAttributableCount >= 6
    && directDemand.paidOfferCount >= 3
    && directDemand.sellerOrPublisherCount >= 2
    && directDemand.exactWorkflowRelevanceCount >= 3;

  const expectedCriteria = [
    ...asArray(authority.formats).map((id) => `format_case:${id}`),
    ...asArray(authority.channelCases).map((id) => `channel_case:${id}`),
    ...asArray(authority.channelCases).flatMap((channelId) => (
      asArray(authority.priceCasesAudCents).map(
        (priceAudCents) => `economics_case:${channelId}:${priceAudCents}`,
      )
    )),
    ...[
      "alternatives",
      "attribution_cash",
      "buyer_problem",
      "competition_entry",
      "direct_demand",
      "distribution",
      "experiment",
      "format_usability",
      "offer_value",
      "operations",
      "provisional_economics",
      "risk",
    ].map((id) => `readiness_gate:${id}`),
  ];
  const capturedCriteria = new Set(capturedCaseEvidence.map((record) => record.criterionId));
  const missingCapturedCriteria = expectedCriteria.filter(
    (criterionId) => !capturedCriteria.has(criterionId),
  );

  const decisionTime = Date.parse(generatedAt);
  const officialFreshnessMs = 7 * 24 * 60 * 60 * 1000;
  const listingFreshnessMs = 72 * 60 * 60 * 1000;
  const sourceIsFresh = (source, maximumAgeMs) => {
    const retrievedAt = Date.parse(source?.retrievedAt || "");
    return Number.isFinite(retrievedAt)
      && Number.isFinite(decisionTime)
      && retrievedAt <= decisionTime
      && decisionTime - retrievedAt <= maximumAgeMs;
  };
  const currentOfficialChannels = ["etsy", "gumroad"].filter((channelId) => (
    evidence.some((record) => {
      const source = sourceFor(record);
      return record.criterionId === `channel_case:${channelId}`
        && source?.captureStatus === "captured"
        && source.sourceClass === "official_platform_policy_or_pricing"
        && source.sourceTier === 1
        && source.marketplaceChannelId === channelId
        && sourceIsFresh(source, officialFreshnessMs);
    })
  ));
  const capturedComparatorSourcesFresh = capturedComparatorRecords.every((record) => (
    sourceIsFresh(sourceFor(record), listingFreshnessMs)
  ));
  const contraryQuestionIds = new Set(
    evidence.filter((record) => record.polarity === "contrary").map((record) => record.questionId),
  );
  const missingContraryQuestions = asArray(authority.researchQuestions)
    .map((question) => question.id)
    .filter((questionId) => !contraryQuestionIds.has(questionId));

  return {
    exploratoryComparators,
    capturedComparators,
    buyerProblem,
    directDemand,
    capturedSourceCount: sources.filter((source) => source.captureStatus === "captured").length,
    capturedObservedFactCount: capturedEvidence.length,
    missingCapturedCriteria,
    currentOfficialChannelIds: currentOfficialChannels,
    capturedComparatorSourcesFresh,
    missingContraryQuestions,
  };
}

function missingFieldsAreEmpty(receipt) {
  const value = valueFrom(receipt, "missingFields", "missing_fields");
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") {
    try {
      return Array.isArray(JSON.parse(value)) && JSON.parse(value).length === 0;
    } catch {
      return false;
    }
  }
  return false;
}

function executionCompletion(ledger) {
  const execution = isObject(ledger.executionEvidence) ? ledger.executionEvidence : {};
  const attempts = asArray(execution.taskAttempts);
  const calls = asArray(execution.modelCalls);
  const receipts = asArray(execution.agentRunReceipts);
  const items = asArray(ledger.assignments).map((assignment) => {
    const taskId = assignment.taskId;
    const assignmentAttempts = attempts.filter(
      (attempt) => valueFrom(attempt, "taskId", "task_id") === taskId,
    );
    const assignmentCalls = calls.filter(
      (call) => valueFrom(call, "taskId", "task_id") === taskId,
    );
    const assignmentReceiptHistory = receipts.filter(
      (receipt) => valueFrom(receipt, "taskId", "task_id") === taskId,
    );
    const latestReceiptByAttempt = new Map();
    for (const receipt of assignmentReceiptHistory) {
      const attemptId = valueFrom(receipt, "attemptId", "attempt_id");
      const prior = latestReceiptByAttempt.get(attemptId);
      if (!prior || Number(receipt.sequence || 0) > Number(prior.sequence || 0)) {
        latestReceiptByAttempt.set(attemptId, receipt);
      }
    }
    const assignmentReceipts = [...latestReceiptByAttempt.values()];
    const knownTerminalReceipts = assignmentReceipts.filter((receipt) => (
      receipt.status === "complete"
      && valueFrom(receipt, "outcomeStatus", "outcome_status") === "known"
      && missingFieldsAreEmpty(receipt)
      && /^(?:sha256:)?[a-f0-9]{64}$/.test(
        String(valueFrom(receipt, "receiptHash", "receipt_hash") || ""),
      )
    ));
    const unresolvedAttempt = assignmentAttempts.some((attempt) => (
      ["running", "claimed", "needs_attention"].includes(attempt.status)
      || ["provider_dispatched", "unknown"].includes(
        valueFrom(attempt, "outcomeStatus", "outcome_status"),
      )
    ));
    const unresolvedCall = assignmentCalls.some((call) => (
      ["dispatching", "running", "needs_attention"].includes(call.status)
      || ["provider_dispatched", "unknown"].includes(
        valueFrom(call, "outcomeStatus", "outcome_status"),
      )
      || valueFrom(call, "costStatus", "cost_status") === "unknown"
    ));
    const providerAttemptCount = assignmentAttempts.filter((attempt) => (
      valueFrom(attempt, "outcomeStatus", "outcome_status") !== "not_started"
    )).length;
    const complete = knownTerminalReceipts.length === 1
      && !unresolvedAttempt
      && !unresolvedCall
      && providerAttemptCount === 1;
    return {
      assignmentId: assignment.id,
      assignmentHash: assignment.assignmentHash,
      taskId,
      providerAttemptCount,
      modelCallCount: assignmentCalls.length,
      receiptCount: assignmentReceiptHistory.length,
      knownTerminalReceiptCount: knownTerminalReceipts.length,
      unresolvedAttempt,
      unresolvedCall,
      complete,
    };
  });
  return {
    items,
    expected: asArray(ledger.assignments).length,
    completed: items.filter((item) => item.complete).length,
    dispatchableAssignmentCount: items.filter((item) => !item.complete).length,
    complete: items.length > 0 && items.every((item) => item.complete),
  };
}

function terminalExecutionCompletion(ledger, stopRecord) {
  const completedIds = new Set(stopRecord.actualCoverage.completedAssignmentIds);
  const skippedIds = new Set(stopRecord.skippedAssignments.map((item) => item.assignmentId));
  const items = asArray(ledger.assignments).map((assignment) => {
    const ordinary = executionCompletion({
      ...ledger,
      assignments: [assignment],
    }).items[0];
    const completed = completedIds.has(assignment.id);
    const skipped = skippedIds.has(assignment.id);
    const stopped = assignment.id === stopRecord.triggerAssignmentId && !completed;
    return {
      ...ordinary,
      complete: completed,
      stopped,
      skipped,
      dispatchable: false,
    };
  });
  return {
    items,
    expected: items.length,
    completed: items.filter((item) => item.complete).length,
    stopped: items.filter((item) => item.stopped).length,
    skipped: items.filter((item) => item.skipped).length,
    dispatchableAssignmentCount: 0,
    complete: true,
    completionMode: "validated_early_stop",
  };
}

function evaluatePreventureResearchReadiness(ledger, state, options = {}) {
  if (!isObject(ledger) || !isObject(ledger.authority) || !isObject(state)) {
    throw readinessError(
      "preventure_research_ledger_unavailable",
      "The exact research ledger and lifecycle state are required.",
      500,
    );
  }
  const authority = ledger.authority;
  const assignments = exactAssignments(authority, ledger.assignments);
  const terminalStopRecord = options.terminalStopRecord || ledger.terminalStopRecord || null;
  let validatedTerminalStop = null;
  if (terminalStopRecord) {
    const assignmentById = new Map(asArray(ledger.assignments).map((item) => [item.id, item]));
    const triggerAssignment = assignmentById.get(terminalStopRecord.triggerAssignmentId);
    try {
      validatedTerminalStop = validatePreventureResearchTerminalStop(terminalStopRecord, {
        authority,
        triggerAssignment,
        assignments: asArray(authority.assignments).map(
          (template) => assignmentById.get(template.id),
        ),
      });
    } catch (error) {
      throw readinessError(
        error?.code || "preventure_research_terminal_stop_invalid",
        `The validated early-stop record is invalid: ${String(error?.message || error)}`,
      );
    }
  }
  const costs = latestCostExposure(ledger.costEvents);
  const evidence = evidenceCoverage(authority, ledger);
  if (validatedTerminalStop) {
    evidence.receiptSetHash = sha256({
      authorityHash: authority.authorityHash,
      executionReceiptSetHash:
        validatedTerminalStop.actualCoverage.executionReceiptSetHash,
      earlyStopRecordHash: validatedTerminalStop.earlyStopRecordHash,
      skippedAssignmentRecordHashes: validatedTerminalStop.skippedAssignments
        .map((item) => item.skipRecordHash)
        .sort(),
    });
  }
  const execution = validatedTerminalStop
    ? terminalExecutionCompletion(ledger, validatedTerminalStop)
    : executionCompletion(ledger);
  const generatedAt = (options.generatedAt instanceof Date
    ? options.generatedAt
    : new Date(options.generatedAt || Date.now())).toISOString();
  const commercialEvidence = commercialEvidenceCoverage(authority, ledger, generatedAt);
  const completionBlockers = [];
  const buildBlockers = [];

  if (state.state !== "activated" || state.terminal || state.expired) {
    completionBlockers.push("The research authority is not active and unexpired.");
  }
  if (ledger.decision || state.decisionHash) {
    completionBlockers.push("This one-round authority already has a sealed decision.");
  }
  completionBlockers.push(...assignments.issues);
  if (!execution.complete) {
    completionBlockers.push(
      "Every exact assignment must have one known terminal immutable receipt before any diligence result can be sealed.",
    );
  }
  if (execution.dispatchableAssignmentCount > 0) {
    completionBlockers.push("One or more exact assignments remains dispatchable or unresolved.");
  }
  if (state.unknownProviderOutcomeCount !== 0) {
    completionBlockers.push("A provider outcome is unknown.");
  }
  if (state.unknownCostCount !== 0 || costs.unknownCount !== 0) {
    completionBlockers.push("A research cost is unknown.");
  }
  if (costs.pendingReservationCount !== 0) {
    completionBlockers.push("A research cost is still only reserved rather than known.");
  }
  if (costs.exposureAudCents > authority.internalAiSpendCapAudCents) {
    completionBlockers.push("Internal AI exposure exceeds the A$2 authority ceiling.");
  }
  const assignedCap = asArray(authority.assignments).reduce(
    (sum, assignment) => sum + assignment.maxCostAudCents,
    0,
  );
  if (costs.exposureAudCents > assignedCap) {
    completionBlockers.push("Research exposure exceeds the exact committed assignment caps.");
  }
  if (evidence.orphanSourceCount || evidence.orphanEvidenceCount) {
    completionBlockers.push("The research ledger contains orphan source or evidence records.");
  }
  if (!validatedTerminalStop && !commercialEvidence.exploratoryComparators.complete) {
    completionBlockers.push(
      "The bounded 10-15 comparator mix, seller, format, channel, or review-observation limit is incomplete.",
    );
  }

  if (evidence.capturedSourceCount === 0) {
    buildBlockers.push("No captured public source can support a build recommendation.");
  }
  if (validatedTerminalStop) {
    buildBlockers.push(
      "The round ended at a validated stop and can only record research_more with a separately approved next evidence action.",
    );
  }
  if (evidence.missingContraryQuestions.length > 0) {
    buildBlockers.push("The disconfirming evidence pass does not cover every approved research question.");
  }
  if (!commercialEvidence.capturedComparators.complete) {
    buildBlockers.push(
      "The decision-grade captured comparator sample does not meet the exact 10-15 coverage standard.",
    );
  }
  if (!commercialEvidence.buyerProblem.decisionGrade) {
    buildBlockers.push(
      "Captured buyer/problem evidence does not meet the 6-unit, 3-group, 3-consequence, and 2-workaround/trigger standard.",
    );
  }
  if (!commercialEvidence.directDemand.decisionGrade) {
    buildBlockers.push(
      "Captured purchaser-attributable demand does not meet the 6-signal, 3-offer, 2-seller, and 3-exact-workflow standard.",
    );
  }
  if (commercialEvidence.missingCapturedCriteria.length > 0) {
    buildBlockers.push(
      "One or more format, channel, economics, or readiness cases lacks captured decision-grade support.",
    );
  }
  if (!commercialEvidence.currentOfficialChannelIds.includes("etsy")
    || !commercialEvidence.currentOfficialChannelIds.includes("gumroad")) {
    buildBlockers.push(
      "Current captured Tier-1 Etsy and Gumroad policy or pricing evidence is incomplete.",
    );
  }
  if (!commercialEvidence.capturedComparatorSourcesFresh) {
    buildBlockers.push("One or more captured marketplace observations is older than 72 hours.");
  }
  if (completionBlockers.length > 0) buildBlockers.unshift(...completionBlockers);

  const terminalDecisionGradeBlockers = [
    !commercialEvidence.capturedComparators.complete
      ? "Terminal commercial outcomes require the complete captured comparator standard."
      : null,
    !commercialEvidence.buyerProblem.decisionGrade
      ? "Terminal commercial outcomes require decision-grade captured buyer/problem evidence."
      : null,
    !commercialEvidence.directDemand.decisionGrade
      ? "Terminal commercial outcomes require decision-grade purchaser-attributable demand evidence."
      : null,
    commercialEvidence.missingCapturedCriteria.length > 0
      ? "Terminal commercial outcomes require captured support for every exact decision case."
      : null,
    !commercialEvidence.currentOfficialChannelIds.includes("etsy")
      || !commercialEvidence.currentOfficialChannelIds.includes("gumroad")
      ? "Terminal commercial outcomes require current captured Tier-1 evidence for Etsy and Gumroad."
      : null,
  ].filter(Boolean);
  const reviseDecisionGradeBlockers = [
    !commercialEvidence.buyerProblem.decisionGrade
      ? "A terminal revise outcome requires decision-grade captured support for the core buyer problem."
      : null,
    !commercialEvidence.capturedComparators.complete
      ? "A terminal revise outcome requires the complete captured comparator standard."
      : null,
  ].filter(Boolean);
  const outcomeBlockers = {
    build: [...new Set(buildBlockers)],
    research_more: [],
    revise: validatedTerminalStop
      ? ["A validated early stop cannot support a terminal revise outcome."]
      : reviseDecisionGradeBlockers,
    reject: validatedTerminalStop
      ? ["A validated early stop cannot support a terminal reject outcome."]
      : terminalDecisionGradeBlockers,
    no_investment: validatedTerminalStop
      ? ["A validated early stop cannot support a terminal no-investment outcome."]
      : terminalDecisionGradeBlockers,
  };

  return {
    schema: PREVENTURE_RESEARCH_READINESS_SCHEMA,
    generatedAt,
    authorityHash: authority.authorityHash,
    lifecycleState: state.state,
    preparationOnly: true,
    assignments,
    execution,
    budget: {
      currency: "AUD",
      authorityCapAudCents: authority.internalAiSpendCapAudCents,
      assignedCapAudCents: assignedCap,
      externalCommercialSpendCapAudCents: 0,
      exposureAudCents: costs.exposureAudCents,
      reconciledAudCents: costs.reconciledAudCents,
      estimatedAudCents: costs.estimatedAudCents,
      reconciledInternalAiCostAudCents: costs.reconciledAudCents,
      estimatedInternalAiCostAudCents: costs.estimatedAudCents,
      exactBillingPending: costs.exactBillingPending,
      remainingAuthorityAudCents: Math.max(
        0,
        authority.internalAiSpendCapAudCents - costs.exposureAudCents,
      ),
      // Prefer immutable cost-chain heads for the owner-facing count. The
      // lower-level state also counts the matching model projection, which is
      // useful for integrity but would double-count one unresolved provider
      // charge after terminal custody.
      unknownCostCount: costs.unknownCount || state.unknownCostCount,
    },
    evidence,
    commercialEvidence,
    completionBlockers: [...new Set(completionBlockers)],
    buildBlockers: [...new Set(buildBlockers)],
    outcomeBlockers,
    canSealDecision: completionBlockers.length === 0,
    canRecommendBuild: buildBlockers.length === 0,
    buildAuthorized: false,
    commercialTestAuthorized: false,
    externalActionAuthorized: false,
  };
}

function preparePreventureResearchDecision(store, authorityHash, decisionInput, options = {}) {
  if (!isObject(store) || typeof store.verifyLedger !== "function") {
    throw readinessError(
      "preventure_research_store_invalid",
      "The immutable pre-venture research store is unavailable.",
      500,
    );
  }
  const verified = store.verifyLedger();
  if (!isObject(verified) || verified.ok !== true) {
    throw readinessError(
      "preventure_research_ledger_invalid",
      "The pre-venture research ledger could not be verified.",
      500,
    );
  }
  const ledger = store.readLedger(authorityHash);
  const state = store.readState(authorityHash);
  const readiness = evaluatePreventureResearchReadiness(ledger, state, options);
  if (!readiness.canSealDecision) {
    throw readinessError(
      "preventure_research_decision_blocked",
      `The diligence result cannot be sealed: ${readiness.completionBlockers.join(" ")}`,
    );
  }
  if (
    decisionInput.evidenceSetHash !== readiness.evidence.evidenceSetHash
    || decisionInput.receiptSetHash !== readiness.evidence.receiptSetHash
  ) {
    throw readinessError(
      "preventure_research_decision_evidence_changed",
      "Refresh the diligence result; its exact evidence or receipt set changed.",
    );
  }
  const outcomeBlockers = asArray(readiness.outcomeBlockers?.[decisionInput.outcome]);
  if (outcomeBlockers.length > 0) {
    throw readinessError(
      "preventure_research_outcome_not_supported",
      `The retained evidence cannot support ${String(decisionInput.outcome)}: ${outcomeBlockers.join(" ")}`,
    );
  }
  const decision = createPreventureResearchDecision(ledger.authority, decisionInput);
  if (decision.outcome === "build" && !readiness.canRecommendBuild) {
    throw readinessError(
      "preventure_research_build_recommendation_blocked",
      `A build recommendation is not supported: ${readiness.buildBlockers.join(" ")}`,
    );
  }
  return { decision, readiness };
}

function recordPreventureResearchDecision(
  store,
  authorityHash,
  decisionInput,
  completionInput = {},
  options = {},
) {
  if (!isObject(store) || typeof store.recordDecision !== "function") {
    throw readinessError(
      "preventure_research_decision_store_invalid",
      "The atomic diligence-decision store is unavailable.",
      500,
    );
  }
  const ledger = store.readLedger(authorityHash);
  const state = store.readState(authorityHash);
  const readiness = evaluatePreventureResearchReadiness(ledger, state, options);
  if (!readiness.canSealDecision) {
    throw readinessError(
      "preventure_research_decision_blocked",
      `The diligence result cannot be sealed: ${readiness.completionBlockers.join(" ")}`,
    );
  }
  const outcomeBlockers = asArray(readiness.outcomeBlockers?.[decisionInput?.outcome]);
  if (outcomeBlockers.length > 0) {
    throw readinessError(
      "preventure_research_outcome_not_supported",
      `The retained evidence cannot support ${String(decisionInput?.outcome)}: ${outcomeBlockers.join(" ")}`,
    );
  }
  if (decisionInput?.outcome === "build" && !readiness.canRecommendBuild) {
    throw readinessError(
      "preventure_research_build_recommendation_blocked",
      `A build recommendation is not supported: ${readiness.buildBlockers.join(" ")}`,
    );
  }
  const recorded = store.recordDecision(authorityHash, decisionInput, completionInput);
  const verified = store.verifyLedger();
  if (!isObject(verified) || verified.ok !== true) {
    throw readinessError(
      "preventure_research_ledger_invalid",
      "The decision was not returned from a verified immutable ledger.",
      500,
    );
  }
  return { ...recorded, readiness };
}

module.exports = {
  PREVENTURE_RESEARCH_READINESS_SCHEMA,
  evaluatePreventureResearchReadiness,
  executionCompletion,
  latestCostExposure,
  preparePreventureResearchDecision,
  recordPreventureResearchDecision,
};
