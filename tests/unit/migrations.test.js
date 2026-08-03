const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { migrations, runMigrations } = require('../../backend/migrations');

function columns(db, table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

describe('migrations', () => {
  test('builds the full schema from an empty database', () => {
    const db = new Database(':memory:');
    runMigrations(db);

    for (const table of [
      'users',
      'student_profiles',
      'landlord_profiles',
      'houses',
      'amenities',
      'house_images',
      'bookings',
      'reviews',
      'reports',
      'password_resets',
      'schema_migrations',
    ]) {
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(table);
      assert.ok(row, `${table} should exist`);
    }

    assert.ok(columns(db, 'houses').includes('rejection_reason'));
    assert.ok(columns(db, 'house_images').includes('sort_order'));
    assert.ok(columns(db, 'house_images').includes('thumbnail_path'));
  });

  test('records one schema_migrations row per migration', () => {
    const db = new Database(':memory:');
    runMigrations(db);

    const rows = db.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all();
    assert.deepEqual(
      rows.map((r) => r.version),
      migrations.map((m) => m.version)
    );
  });

  test('a second run is a no-op', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const before = db.prepare(`SELECT COUNT(*) AS c FROM schema_migrations`).get().c;

    runMigrations(db);
    const after = db.prepare(`SELECT COUNT(*) AS c FROM schema_migrations`).get().c;

    assert.equal(after, before);
  });

  test('backfills sort_order by id on a fresh database', () => {
    const db = new Database(':memory:');
    runMigrations(db);

    db.prepare(`INSERT INTO users (name, email, password, role) VALUES ('L','l@l.com','x','landlord')`).run();
    const landlordId = db.prepare(`SELECT id FROM users`).get().id;
    db.prepare(`INSERT INTO houses (landlord_id, title, rent, location) VALUES (?,'x',1,'y')`).run(
      landlordId
    );
    const houseId = db.prepare(`SELECT id FROM houses`).get().id;
    const insert = db.prepare(
      `INSERT INTO house_images (house_id, image_path, sort_order) VALUES (?,?,?)`
    );
    insert.run(houseId, '/a.jpg', 5);

    const row = db.prepare(`SELECT sort_order FROM house_images`).get();
    assert.equal(row.sort_order, 5);
  });

  test('tolerates a pre-migrations database that already has the later columns', () => {
    // Simulates an existing checkout: tables built directly (as the old ad-hoc
    // code did) with the later columns already present, and no
    // schema_migrations table yet.
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE houses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      landlord_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      rent REAL NOT NULL,
      location TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      is_available INTEGER DEFAULT 1,
      rejection_reason TEXT
    )`);
    db.exec(`CREATE TABLE house_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      house_id INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      thumbnail_path TEXT
    )`);

    assert.doesNotThrow(() => runMigrations(db));
    assert.ok(columns(db, 'houses').includes('rejection_reason'));
  });
});
