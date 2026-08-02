const fs = require('fs');
const path = require('path');
const storage = require('../storage');
const { processImage } = require('./imageProcessing');

const MAX_IMAGES_PER_HOUSE = 10;

// Fire-and-forget: a failed delete leaves an orphan file, which must never
// block or fail the request that removed the database row. Delegates to the
// active storage driver, so this works the same for local and s3.
function deleteImageFiles(imagePaths) {
  for (const imagePath of imagePaths || []) {
    if (!imagePath) continue;
    storage.remove(imagePath);
  }
}

// Multer writes uploads to a local temp dir before the handler runs, so every
// early return (validation failure, over-cap, ownership rejection) must clean
// up after itself, regardless of which storage driver will ultimately be used.
function deleteUploadedFiles(files) {
  for (const file of files || []) {
    fs.promises.unlink(file.path).catch(() => {});
  }
}

// Resizes and re-encodes each multer temp file (strip EXIF, cap the long edge,
// webp @ q80, plus a thumbnail), stores both through the active driver, then
// removes the temp original. Runs before the DB transaction that records the
// resulting paths, since storing is async and better-sqlite3 transactions must
// be synchronous.
async function processAndStoreUploads(files) {
  const results = [];
  try {
    for (const file of files || []) {
      const { main, thumbnail } = await processImage(file.path);
      const base = path.basename(file.filename, path.extname(file.filename));
      const imagePath = await storage.put(main, `${base}.webp`);
      const thumbnailPath = await storage.put(thumbnail, `${base}-thumb.webp`);
      await fs.promises.unlink(file.path).catch(() => {});
      results.push({ imagePath, thumbnailPath });
    }
    return results;
  } catch (err) {
    // Roll back anything already stored in this batch; the caller's
    // deleteUploadedFiles(req.files) handles the remaining temp originals.
    for (const stored of results) {
      storage.remove(stored.imagePath);
      storage.remove(stored.thumbnailPath);
    }
    throw err;
  }
}

function getHouseImagePaths(db, houseId) {
  return db
    .prepare(`SELECT image_path FROM house_images WHERE house_id = ?`)
    .all(houseId)
    .map((row) => row.image_path);
}

// Every stored asset (main + thumbnail) for a house's gallery, for cleanup
// on delete. Unlike getHouseImagePaths, this includes thumbnails.
function getHouseAssetPaths(db, houseId) {
  return db
    .prepare(`SELECT image_path, thumbnail_path FROM house_images WHERE house_id = ?`)
    .all(houseId)
    .flatMap((row) => [row.image_path, row.thumbnail_path])
    .filter(Boolean);
}

function getHouseImages(db, houseId) {
  return db
    .prepare(`SELECT * FROM house_images WHERE house_id = ? ORDER BY sort_order ASC, id ASC`)
    .all(houseId);
}

// Guarantees exactly one primary image. Called after any delete/insert/reorder so
// a listing can never end up with zero primaries (which would blank its thumbnail).
function normalizePrimary(db, houseId, preferredImageId) {
  const images = getHouseImages(db, houseId);
  if (images.length === 0) return;

  let target = images.find((img) => img.id === preferredImageId);
  if (!target) target = images.find((img) => img.is_primary) || images[0];

  db.prepare(`UPDATE house_images SET is_primary = 0 WHERE house_id = ?`).run(houseId);
  db.prepare(`UPDATE house_images SET is_primary = 1 WHERE id = ? AND house_id = ?`).run(
    target.id,
    houseId
  );
}

// Applies a client-supplied display order. Ids not belonging to this house are
// dropped, and any image the client omitted keeps its place at the end.
function applyImageOrder(db, houseId, orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;

  const owned = new Set(getHouseImages(db, houseId).map((img) => img.id));
  const seen = new Set();
  let position = 0;
  const setOrder = db.prepare(
    `UPDATE house_images SET sort_order = ? WHERE id = ? AND house_id = ?`
  );

  for (const rawId of orderedIds) {
    const id = parseInt(rawId, 10);
    if (isNaN(id) || !owned.has(id) || seen.has(id)) continue;
    seen.add(id);
    setOrder.run(position++, id, houseId);
  }

  for (const id of owned) {
    if (!seen.has(id)) {
      setOrder.run(position++, id, houseId);
    }
  }
}

function nextSortOrder(db, houseId) {
  const { max_order } = db
    .prepare(`SELECT MAX(sort_order) as max_order FROM house_images WHERE house_id = ?`)
    .get(houseId);
  return max_order === null || max_order === undefined ? 0 : max_order + 1;
}

function countHouseImages(db, houseId) {
  const { cnt } = db
    .prepare(`SELECT COUNT(*) as cnt FROM house_images WHERE house_id = ?`)
    .get(houseId);
  return cnt || 0;
}

module.exports = {
  MAX_IMAGES_PER_HOUSE,
  deleteImageFiles,
  deleteUploadedFiles,
  processAndStoreUploads,
  getHouseImagePaths,
  getHouseAssetPaths,
  getHouseImages,
  normalizePrimary,
  applyImageOrder,
  nextSortOrder,
  countHouseImages,
};
