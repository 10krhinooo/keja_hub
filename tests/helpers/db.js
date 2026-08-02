const Database = require('better-sqlite3');

/**
 * A bare in-memory database with just the tables a unit test needs. Much
 * cheaper than booting the full seeded app, and it lets a test control the
 * exact rows under test.
 */
async function memoryDb() {
  const db = new Database(':memory:');

  db.exec(`CREATE TABLE house_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER NOT NULL,
    image_path TEXT NOT NULL,
    thumbnail_path TEXT,
    is_primary INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0
  )`);

  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, email TEXT, password TEXT, role TEXT,
    is_active INTEGER DEFAULT 1
  )`);

  return db;
}

// Inserts images for a house and returns their ids in insertion order.
function addImages(db, houseId, specs) {
  const insert = db.prepare(
    `INSERT INTO house_images (house_id, image_path, thumbnail_path, is_primary, sort_order)
     VALUES (?,?,?,?,?)`
  );
  const ids = [];
  for (const spec of specs) {
    const {
      path: imagePath = `/uploads/houses/${Math.random()}.jpg`,
      thumbnail: thumbnailPath = null,
      primary = 0,
      order = 0,
    } = spec;
    const { lastInsertRowid } = insert.run(houseId, imagePath, thumbnailPath, primary, order);
    ids.push(lastInsertRowid);
  }
  return ids;
}

function readImages(db, houseId) {
  return db
    .prepare(
      `SELECT id, image_path, thumbnail_path, is_primary, sort_order FROM house_images
       WHERE house_id = ? ORDER BY sort_order ASC, id ASC`
    )
    .all(houseId);
}

module.exports = { memoryDb, addImages, readImages };
