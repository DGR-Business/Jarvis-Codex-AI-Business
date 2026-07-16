const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const CONFIG = require("../config");
const { all, fromJson, get, now, randomId, run, toJson } = require("../db");

function safeSlug(value) {
  return String(value || "artifact")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "artifact";
}

function relativeOrAbsolute(filePath) {
  const relative = path.relative(CONFIG.rootDir, filePath);
  return relative.startsWith("..") || path.isAbsolute(relative)
    ? filePath
    : relative.replace(/\\/g, "/");
}

function artifactPath(deliverable, options = {}) {
  const key = deliverable.artifact_key || safeSlug(deliverable.id);
  return path.join(options.artifactRoot || CONFIG.artifactRoot, "workflows", safeSlug(deliverable.workflow_id), `${safeSlug(key)}.md`);
}

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sectionMarkdown(section) {
  const content = fromJson(section.content, {});
  const evidence = Array.isArray(content.evidence) ? content.evidence : [];
  const risks = Array.isArray(content.risks) ? content.risks : [];
  const details = content.details && typeof content.details === "object" ? content.details : {};
  return [
    `## ${content.heading || "Work update"}`,
    "",
    content.summary || "No summary was recorded.",
    "",
    ...(evidence.length ? ["### Evidence", "", ...evidence.map((item) => `- ${item}`), ""] : []),
    ...(Object.keys(details).length ? ["### Details", "", ...Object.entries(details).map(([key, value]) => `- **${key}:** ${value}`), ""] : []),
    ...(risks.length ? ["### Risks", "", ...risks.map((item) => `- ${item}`), ""] : []),
    "### Recommended next step",
    "",
    content.nextAction || "Review the evidence before taking the next commercial action.",
    "",
  ].join("\n");
}

function renderDeliverable(db, deliverableId, options = {}) {
  const deliverable = get(db, "SELECT * FROM deliverables WHERE id = ?", [deliverableId]);
  if (!deliverable) throw new Error(`Deliverable not found: ${deliverableId}`);
  const workflow = get(db, "SELECT * FROM workflows WHERE id = ?", [deliverable.workflow_id]);
  const command = get(db, "SELECT * FROM commands WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1", [deliverable.workflow_id]);
  const sections = all(
    db,
    "SELECT * FROM deliverable_sections WHERE deliverable_id = ? ORDER BY sequence, created_at, id",
    [deliverableId],
  );
  const metadata = fromJson(deliverable.metadata, {});
  const content = [
    `# ${deliverable.human_name}`,
    "",
    `**Business stage:** ${workflow?.status || "Planned"}`,
    `**Purpose:** ${deliverable.summary}`,
    "",
    "## Instruction",
    "",
    command?.raw_text || "Prepared from the active venture case.",
    "",
    "## What this pack covers",
    "",
    ...(metadata.sections || []).map((section) => `- ${section}`),
    "",
    ...sections.map(sectionMarkdown),
    ...(sections.length ? [] : ["## Current position", "", "This pack is planned. No worker result has been recorded yet.", ""]),
  ].join("\n");
  const contentHash = hashText(content);
  const filePath = artifactPath(deliverable, options);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomId().slice(0, 8)}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, filePath);
  const version = deliverable.content_hash && deliverable.content_hash !== contentHash
    ? Number(deliverable.version || 1) + 1
    : Number(deliverable.version || 1);
  run(
    db,
    `UPDATE deliverables SET file_path = ?, content_hash = ?, version = ?, updated_at = ? WHERE id = ?`,
    [relativeOrAbsolute(filePath), contentHash, version, now(), deliverableId],
  );
  return { filePath, storedPath: relativeOrAbsolute(filePath), contentHash, version };
}

function upsertDeliverableSection(db, deliverableId, task, output, sequence = 0, options = {}) {
  const id = `section_${safeSlug(deliverableId)}_${safeSlug(task.id)}`;
  const ts = now();
  run(
    db,
    `INSERT INTO deliverable_sections (id, deliverable_id, task_id, sequence, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(deliverable_id, task_id) DO UPDATE SET
       sequence = excluded.sequence,
       content = excluded.content,
       updated_at = excluded.updated_at`,
    [
      id,
      deliverableId,
      task.id,
      sequence,
      toJson({
        heading: output.heading,
        summary: output.summary,
        evidence: output.evidence || [],
        details: output.details || {},
        risks: output.risks || [],
        nextAction: output.nextAction,
        modelGenerated: Boolean(output.modelGenerated),
      }),
      ts,
      ts,
    ],
  );
  return renderDeliverable(db, deliverableId, options);
}

module.exports = {
  artifactPath,
  renderDeliverable,
  upsertDeliverableSection,
};
