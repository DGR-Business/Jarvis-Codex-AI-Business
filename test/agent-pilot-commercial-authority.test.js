const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  get,
  openDatabase,
  seedDatabase,
} = require("../src/db");
const {
  ensureDemandValidatorPilotFixture,
  prepareDemandValidatorPilot,
} = require("../src/runtime/agent-pilot");

function counts(db) {
  return Object.fromEntries(
    [
      "workflows",
      "commands",
      "tasks",
      "approvals",
      "costs",
      "events",
    ].map((table) => [
      table,
      get(db, `SELECT COUNT(*) AS count FROM ${table}`).count,
    ]),
  );
}

test("Demand Validator pilot authority is checked before any workflow or decision write", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pantheon-agent-pilot-authority-"),
  );
  const db = openDatabase(path.join(root, "runtime.sqlite"));
  seedDatabase(db);
  try {
    const fixture = ensureDemandValidatorPilotFixture(db);
    const before = counts(db);
    assert.throws(
      () => prepareDemandValidatorPilot(db, fixture.id),
      (error) => error.statusCode === 409
        && error.code === "commercial_binding_required",
    );
    assert.deepEqual(counts(db), before);
    assert.equal(
      get(
        db,
        "SELECT status FROM agent_pilot_fixtures WHERE id = ?",
        [fixture.id],
      ).status,
      "ready",
    );
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
