const REVIEWED_RETRYABLE_ERROR_KINDS = new Set([
  "provider_output_invalid",
  "malformed_structured_output",
  "approved_provider_tool_activity_missing",
  "local_processing_after_provider_success",
]);

function isReviewedRetryableErrorKind(errorKind) {
  return REVIEWED_RETRYABLE_ERROR_KINDS.has(String(errorKind || ""));
}

function canPrepareReviewedRetry(task, errorKind) {
  return Boolean(
    task
    && task.kind === "live_ai_worker_execution"
    && task.agent === "demand_validator"
    && task.status === "needs_attention"
    && task.outcome_status === "known_provider_result_needs_review"
    && isReviewedRetryableErrorKind(errorKind),
  );
}

module.exports = {
  REVIEWED_RETRYABLE_ERROR_KINDS,
  canPrepareReviewedRetry,
  isReviewedRetryableErrorKind,
};
