const { DatabaseSync } = require("node:sqlite");
const {
  LAST_RELEASED_SCHEMA_VERSION,
} = require("../../src/runtime/backup");

const RELEASED_SCHEMA_VERSION = LAST_RELEASED_SCHEMA_VERSION;

function downgradeDatabaseToReleasedSchema24(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      DROP TABLE commercial_test_proof_evaluations;
      DROP TABLE commercial_test_evidence_records;
      DROP TABLE commercial_test_evidence_receipts;
      DROP TABLE commercial_test_lifecycle_events;
      DROP TABLE commercial_test_contracts;
      DROP TRIGGER trg_venture_kits_content_hash_insert;
      DROP TRIGGER trg_venture_kits_definition_immutable_update;
      DROP TRIGGER trg_venture_kits_definition_immutable_delete;
      DROP INDEX idx_venture_kits_content_identity;
      ALTER TABLE venture_kits DROP COLUMN content_hash;
      DELETE FROM schema_migrations WHERE version > ${RELEASED_SCHEMA_VERSION};
    `);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.prepare("PRAGMA journal_mode = DELETE").get();
  } finally {
    db.close();
  }
}

module.exports = {
  RELEASED_SCHEMA_VERSION,
  downgradeDatabaseToReleasedSchema24,
};
