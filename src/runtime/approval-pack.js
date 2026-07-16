const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const CONFIG = require("../config");
const { all, fromJson, get, insertEvent, now, run, toJson } = require("../db");
const { getWorkflowScorecard } = require("./scorecard");

function safeFileName(value) {
  return String(value || "Approval Pack")
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function slugForId(value) {
  return String(value || "approval-pack")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "approval-pack";
}

function parseRows(rows, fields = ["metadata", "payload", "result"]) {
  return rows.map((row) => {
    const copy = { ...row };
    for (const field of fields) {
      if (field in copy) copy[field] = fromJson(copy[field]);
    }
    return copy;
  });
}

function readExcerpt(filePath) {
  if (!filePath) return "";
  const absolute = path.join(CONFIG.rootDir, filePath);
  if (!absolute.startsWith(CONFIG.rootDir) || !fs.existsSync(absolute)) return "";
  return fs.readFileSync(absolute, "utf8").replace(/\s+/g, " ").trim().slice(0, 1800);
}

function approvalPackName(workflow, deliverables) {
  const decisionPack = deliverables.find((item) => /Decision Pack/i.test(item.title || item.human_name));
  if (decisionPack) {
    return decisionPack.human_name.replace(/Decision Pack/i, "Approval Pack");
  }
  return `${workflow.title} Approval Pack (for approval)`;
}

function resolvePython() {
  if (process.env.JARVIS_PYTHON) return process.env.JARVIS_PYTHON;
  const candidates = [];
  const dependencyRoot = path.resolve(path.dirname(process.execPath), "..", "..");
  candidates.push(path.join(dependencyRoot, "python", "python.exe"));
  for (const home of [process.env.USERPROFILE, process.env.HOME].filter(Boolean)) {
    candidates.push(path.join(home, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe"));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return process.platform === "win32" ? "python" : "python3";
}

function outputDirectory(options = {}) {
  return options.outputDir || process.env.JARVIS_APPROVAL_PACK_DIR || path.join(CONFIG.rootDir, "output", "pdf");
}

function relativeToRootOrAbsolute(filePath) {
  const rel = path.relative(CONFIG.rootDir, filePath);
  return rel.startsWith("..") ? filePath : rel.replace(/\\/g, "/");
}

function generateApprovalPack(db, workflowId, options = {}) {
  const workflowRow = get(db, "SELECT * FROM workflows WHERE id = ?", [workflowId]);
  if (!workflowRow) throw new Error(`Workflow not found: ${workflowId}`);

  const workflow = { ...workflowRow, metadata: fromJson(workflowRow.metadata) };
  const command = get(db, "SELECT * FROM commands WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1", [workflowId]) || {};
  const tasks = parseRows(all(db, "SELECT * FROM tasks WHERE workflow_id = ? ORDER BY priority ASC, created_at ASC", [workflowId]));
  const deliverables = parseRows(all(db, "SELECT * FROM deliverables WHERE workflow_id = ? ORDER BY created_at ASC", [workflowId]));
  const scorecard = getWorkflowScorecard(db, workflowId);
  const ts = now();
  const humanName = approvalPackName(workflow, deliverables);
  const approvalPackId = `deliv_pdf_${slugForId(workflowId)}`;
  const outDir = outputDirectory(options);
  fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, `${safeFileName(humanName)}.pdf`);
  const tempDir = path.join(CONFIG.rootDir, "tmp", "pdfs");
  fs.mkdirSync(tempDir, { recursive: true });
  const payloadPath = path.join(tempDir, `${approvalPackId}.json`);

  const payload = {
    approvalPackId,
    humanName,
    generatedAt: ts,
    workflow,
    command,
    scorecard,
    tasks,
    deliverables: deliverables.map((item) => ({ ...item, excerpt: readExcerpt(item.file_path) })),
  };
  fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), "utf8");

  const renderer = path.join(CONFIG.rootDir, "scripts", "render-approval-pack.py");
  const rendered = spawnSync(resolvePython(), [renderer, payloadPath, outputPath], {
    cwd: CONFIG.rootDir,
    encoding: "utf8",
  });
  if (rendered.status !== 0) {
    throw new Error(`Approval pack PDF render failed: ${rendered.stderr || rendered.stdout || "unknown error"}`);
  }
  const stats = fs.statSync(outputPath);
  if (stats.size < 1000) throw new Error("Approval pack PDF render produced an unexpectedly small file.");

  const relPath = relativeToRootOrAbsolute(outputPath);
  const sourcePaths = deliverables.map((item) => item.file_path).filter(Boolean);
  run(
    db,
    `INSERT INTO deliverables (id, workflow_id, command_id, task_id, title, human_name, audience, format, status, file_path, summary, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       task_id = excluded.task_id,
       human_name = excluded.human_name,
       status = excluded.status,
       file_path = excluded.file_path,
       summary = excluded.summary,
       metadata = excluded.metadata,
       updated_at = excluded.updated_at`,
    [
      approvalPackId,
      workflowId,
      command.id || null,
      options.taskId || null,
      "Approval Pack",
      humanName,
      "operator",
      "pdf",
      "ready_for_review",
      relPath,
      "Polished PDF approval pack generated from workflow deliverables and task evidence.",
      toJson({ generatedAt: ts, sourceDeliverables: deliverables.map((item) => item.id), sourcePaths, bytes: stats.size }),
      ts,
      ts,
    ],
  );

  insertEvent(db, {
    actor: "approval-pack-generator",
    type: "approval_pack.generated",
    entityType: "workflow",
    entityId: workflowId,
    message: `Generated PDF approval pack: ${humanName}.`,
    metadata: { deliverableId: approvalPackId, filePath: relPath, bytes: stats.size },
  });

  return {
    id: approvalPackId,
    humanName,
    filePath: relPath,
    bytes: stats.size,
  };
}

module.exports = {
  generateApprovalPack,
};
