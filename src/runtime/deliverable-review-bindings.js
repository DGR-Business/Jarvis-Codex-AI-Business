const crypto = require("node:crypto");
const { all, fromJson, get } = require("../db");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]),
    );
  }
  return value ?? null;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function deliverableReviewInput(db, workflowId, deliverableId) {
  const deliverable = get(
    db,
    `SELECT id, venture_id, workflow_id, title, human_name, audience, format,
            summary, content_hash, version, metadata
     FROM deliverables WHERE id = ? AND workflow_id = ?`,
    [deliverableId, workflowId],
  );
  if (!deliverable) throw new Error(`Review deliverable not found in this workflow: ${deliverableId}`);
  const sections = all(
    db,
    `SELECT task_id, sequence, content, updated_at
     FROM deliverable_sections WHERE deliverable_id = ?
     ORDER BY sequence ASC`,
    [deliverableId],
  ).map((section) => ({
    taskId: section.task_id,
    sequence: section.sequence,
    content: fromJson(section.content, {}),
    updatedAt: section.updated_at,
  }));
  const input = {
    schema: "jarvis.deliverable-review-input.v1",
    deliverable: {
      id: deliverable.id,
      title: deliverable.title,
      humanName: deliverable.human_name,
      audience: deliverable.audience,
      format: deliverable.format,
      summary: deliverable.summary,
      version: deliverable.version,
      contentHash: deliverable.content_hash || fromJson(deliverable.metadata, {}).sha256 || null,
    },
    sections,
  };
  return { deliverable, input, inputHash: hash(input) };
}

function buildDeliverableReviewBindings(db, workflowId, deliverableIds) {
  const ids = [...new Set((deliverableIds || []).filter(Boolean).map(String))];
  if (!ids.length) throw new Error("Quality review needs one or more exact deliverables.");
  return ids.slice(0, 4).map((id) => {
    const built = deliverableReviewInput(db, workflowId, id);
    return {
      deliverableId: id,
      inputHash: built.inputHash,
      format: built.deliverable.format,
      title: built.deliverable.human_name || built.deliverable.title,
    };
  });
}

function approvedDeliverableReviewTargets(db, task, payload, workerId) {
  if (workerId !== "quality_reviewer") return [];
  const bindings = Array.isArray(payload.liveSpendRequest?.parameters?.reviewBindings)
    ? payload.liveSpendRequest.parameters.reviewBindings
    : [];
  return bindings.slice(0, 4).map((binding) => {
    const current = deliverableReviewInput(db, task.workflow_id, binding.deliverableId);
    if (current.inputHash !== binding.inputHash) {
      throw new Error(
        `Quality review input changed after approval for deliverable ${binding.deliverableId}. Prepare a new review.`,
      );
    }
    return {
      deliverableId: binding.deliverableId,
      approvedInputHash: binding.inputHash,
      exactInput: current.input,
    };
  });
}

module.exports = {
  approvedDeliverableReviewTargets,
  buildDeliverableReviewBindings,
  deliverableReviewInput,
};
