const fs = require('fs');
const path = require('path');

const MAX_IMAGES_PER_HOUSE = 10;
const PROJECT_ROOT = path.join(__dirname, '../../');
const UPLOAD_ROOT = path.join(PROJECT_ROOT, 'uploads');

// Only ever unlink files that resolve inside uploads/. Seeded listings point at
// /images/background.jpg (a static asset), and image_path ultimately comes from
// the database, so refuse anything that escapes the upload directory.
function resolveUploadPath(imagePath) {
  if (!imagePath) return null;
  const abs = path.resolve(PROJECT_ROOT, '.' + imagePath);
  return abs.startsWith(UPLOAD_ROOT + path.sep) ? abs : null;
}

// Fire-and-forget: a failed unlink leaves an orphan file, which must never
// block or fail the request that removed the database row.
function deleteImageFiles(imagePaths) {
  for (const imagePath of imagePaths || []) {
    const abs = resolveUploadPath(imagePath);
    if (!abs) continue;
    fs.promises.unlink(abs).catch(() => {});
  }
}

// Multer writes uploads to disk before the handler runs, so every early return
// (validation failure, over-cap, ownership rejection) must clean up after itself.
function deleteUploadedFiles(files) {
  for (const file of files || []) {
    fs.promises.unlink(file.path).catch(() => {});
  }
}

function getHouseImagePaths(db, houseId) {
  const stmt = db.prepare(`SELECT image_path FROM house_images WHERE house_id = ?`);
  stmt.bind([houseId]);
  const paths = [];
  while (stmt.step()) paths.push(stmt.getAsObject().image_path);
  stmt.free();
  return paths;
}

function getHouseImages(db, houseId) {
  const stmt = db.prepare(
    `SELECT * FROM house_images WHERE house_id = ? ORDER BY sort_order ASC, id ASC`
  );
  stmt.bind([houseId]);
  const images = [];
  while (stmt.step()) images.push(stmt.getAsObject());
  stmt.free();
  return images;
}

// Guarantees exactly one primary image. Called after any delete/insert/reorder so
// a listing can never end up with zero primaries (which would blank its thumbnail).
function normalizePrimary(db, houseId, preferredImageId) {
  const images = getHouseImages(db, houseId);
  if (images.length === 0) return;

  let target = images.find((img) => img.id === preferredImageId);
  if (!target) target = images.find((img) => img.is_primary) || images[0];

  db.run(`UPDATE house_images SET is_primary = 0 WHERE house_id = ?`, [houseId]);
  db.run(`UPDATE house_images SET is_primary = 1 WHERE id = ? AND house_id = ?`, [
    target.id,
    houseId,
  ]);
}

// Applies a client-supplied display order. Ids not belonging to this house are
// dropped, and any image the client omitted keeps its place at the end.
function applyImageOrder(db, houseId, orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;

  const owned = new Set(getHouseImages(db, houseId).map((img) => img.id));
  const seen = new Set();
  let position = 0;

  for (const rawId of orderedIds) {
    const id = parseInt(rawId, 10);
    if (isNaN(id) || !owned.has(id) || seen.has(id)) continue;
    seen.add(id);
    db.run(`UPDATE house_images SET sort_order = ? WHERE id = ? AND house_id = ?`, [
      position++,
      id,
      houseId,
    ]);
  }

  for (const id of owned) {
    if (!seen.has(id)) {
      db.run(`UPDATE house_images SET sort_order = ? WHERE id = ? AND house_id = ?`, [
        position++,
        id,
        houseId,
      ]);
    }
  }
}

function nextSortOrder(db, houseId) {
  const stmt = db.prepare(
    `SELECT MAX(sort_order) as max_order FROM house_images WHERE house_id = ?`
  );
  stmt.bind([houseId]);
  stmt.step();
  const max = stmt.getAsObject().max_order;
  stmt.free();
  return max === null || max === undefined ? 0 : max + 1;
}

function countHouseImages(db, houseId) {
  const stmt = db.prepare(`SELECT COUNT(*) as cnt FROM house_images WHERE house_id = ?`);
  stmt.bind([houseId]);
  stmt.step();
  const cnt = stmt.getAsObject().cnt || 0;
  stmt.free();
  return cnt;
}

module.exports = {
  MAX_IMAGES_PER_HOUSE,
  deleteImageFiles,
  deleteUploadedFiles,
  getHouseImagePaths,
  getHouseImages,
  normalizePrimary,
  applyImageOrder,
  nextSortOrder,
  countHouseImages,
};
