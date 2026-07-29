const { all, fromJson, get } = require("../db");
const { getCommercialExperiment } = require("./commercial-results");

const FRAMEWORKS = Object.freeze([
  "Money Move Contract",
  "AARRR funnel",
  "ICE prioritisation",
  "Unit Economics Gate",
  "Build Measure Learn",
]);
const LEGACY_COMMERCIAL_PATH_RETIRED_CODE = "legacy_commercial_path_retired";

function legacyCommercialPathRetired(pathName) {
  const error = new Error(
    "This legacy commercial creation path is permanently retired. "
      + "Use the accepted immutable v2 commercial-test contract and evidence ledger.",
  );
  error.name = "LegacyCommercialPathRetiredError";
  error.statusCode = 410;
  error.code = LEGACY_COMMERCIAL_PATH_RETIRED_CODE;
  error.details = {
    path: pathName,
    replacement: "pantheon.commercial-test-contract.v2",
  };
  return error;
}

function parseRows(rows) {
  return rows.map((row) => ({ ...row, metadata: fromJson(row.metadata) }));
}

function getBrief(db, id) {
  const row = get(db, "SELECT * FROM commercial_briefs WHERE id = ?", [id]);
  return row ? parseRows([row])[0] : null;
}

function getCandidate(db, id) {
  const row = get(db, "SELECT * FROM commercial_test_candidates WHERE id = ?", [id]);
  return row ? parseRows([row])[0] : null;
}

function candidatesForBrief(db, briefId) {
  return parseRows(
    all(
      db,
      "SELECT * FROM commercial_test_candidates WHERE brief_id = ? ORDER BY rank ASC, evidence_score DESC, created_at DESC",
      [briefId],
    ),
  );
}

function inspectHistoricalResearchToExperimentPlan(db, briefId) {
  const brief = getBrief(db, briefId);
  if (!brief) return null;
  const candidates = candidatesForBrief(db, brief.id);
  return {
    retired: true,
    readOnly: true,
    brief,
    candidates,
    recommended: candidates[0] || null,
  };
}

function inspectHistoricalCandidatePromotion(db, candidateId) {
  const candidate = getCandidate(db, candidateId);
  if (!candidate) return null;
  return {
    retired: true,
    readOnly: true,
    candidate,
    experiment: candidate.promoted_experiment_id
      ? getCommercialExperiment(db, candidate.promoted_experiment_id)
      : null,
  };
}

function createResearchToExperimentPlan(db, input = {}) {
  void db;
  void input;
  throw legacyCommercialPathRetired("research_to_experiment_plan");
}

function createResearchToExperimentPlanFromResearch(db, researchRunId, options = {}) {
  void db;
  void researchRunId;
  void options;
  throw legacyCommercialPathRetired("research_to_experiment_live_research_plan");
}

function createRevisionPlanFromLearning(db, learningId, options = {}) {
  void db;
  void learningId;
  void options;
  throw legacyCommercialPathRetired("research_to_experiment_learning_revision_plan");
}

function promoteCandidateToExperiment(db, candidateId, options = {}) {
  void db;
  void candidateId;
  void options;
  throw legacyCommercialPathRetired("research_to_experiment_candidate_promotion");
}

module.exports = {
  FRAMEWORKS,
  LEGACY_COMMERCIAL_PATH_RETIRED_CODE,
  createResearchToExperimentPlan,
  createResearchToExperimentPlanFromResearch,
  createRevisionPlanFromLearning,
  getBrief,
  getCandidate,
  inspectHistoricalCandidatePromotion,
  inspectHistoricalResearchToExperimentPlan,
  promoteCandidateToExperiment,
};
