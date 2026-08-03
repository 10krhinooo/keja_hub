const migrations = [
  require('./001_initial_schema'),
  require('./002_house_rejection_reason'),
  require('./003_house_images_sort_order'),
  require('./004_house_images_thumbnail_path'),
].sort((a, b) => a.version - b.version);

// Records which migrations have already run so a restart doesn't redo work
// (and so an ALTER TABLE that isn't itself idempotent could be added safely
// in the future). CREATE TABLE IF NOT EXISTS keeps this self-bootstrapping:
// there's no separate "install the migration runner" step.
function ensureMigrationsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

function appliedVersions(db) {
  return new Set(
    db
      .prepare(`SELECT version FROM schema_migrations`)
      .all()
      .map((r) => r.version)
  );
}

function runMigrations(db) {
  ensureMigrationsTable(db);
  const applied = appliedVersions(db);
  const recordApplied = db.prepare(`INSERT INTO schema_migrations (version) VALUES (?)`);

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      migration.up(db);
      recordApplied.run(migration.version);
    })();
  }
}

module.exports = { migrations, runMigrations };
