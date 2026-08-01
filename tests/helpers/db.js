const initSqlJs = require('sql.js');

/**
 * A bare in-memory database with just the tables a unit test needs. Much
 * cheaper than booting the full seeded app, and it lets a test control the
 * exact rows under test.
 */
async function memoryDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`CREATE TABLE house_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER NOT NULL,
    image_path TEXT NOT NULL,
    is_primary INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, email TEXT, password TEXT, role TEXT,
    is_active INTEGER DEFAULT 1
  )`);

  return db;
}

// Inserts images for a house and returns their ids in insertion order.
function addImages(db, houseId, specs) {
  const ids = [];
  for (const spec of specs) {
    const {
      path: imagePath = `/uploads/houses/${Math.random()}.jpg`,
      primary = 0,
      order = 0,
    } = spec;
    db.run(
      `INSERT INTO house_images (house_id, image_path, is_primary, sort_order) VALUES (?,?,?,?)`,
      [houseId, imagePath, primary, order]
    );
    ids.push(db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]);
  }
  return ids;
}

function readImages(db, houseId) {
  const stmt = db.prepare(
    `SELECT id, image_path, is_primary, sort_order FROM house_images
     WHERE house_id = ? ORDER BY sort_order ASC, id ASC`
  );
  stmt.bind([houseId]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

module.exports = { memoryDb, addImages, readImages };
