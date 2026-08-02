const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '../../');
const UPLOAD_ROOT = path.join(PROJECT_ROOT, 'uploads');
const HOUSES_DIR = path.join(UPLOAD_ROOT, 'houses');

// Only ever touch a path that resolves inside uploads/. Seeded listings point
// at /images/background.jpg (a static asset), and image_path ultimately comes
// from the database, so refuse anything that escapes the upload directory.
function resolveUploadPath(imagePath) {
  if (!imagePath) return null;
  const abs = path.resolve(PROJECT_ROOT, '.' + imagePath);
  return abs.startsWith(UPLOAD_ROOT + path.sep) ? abs : null;
}

async function put(buffer, filename) {
  fs.mkdirSync(HOUSES_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(HOUSES_DIR, filename), buffer);
  return '/uploads/houses/' + filename;
}

// Fire-and-forget: a failed unlink leaves an orphan file, which must never
// block or fail the request that removed the database row.
function remove(imagePath) {
  const abs = resolveUploadPath(imagePath);
  if (!abs) return;
  fs.promises.unlink(abs).catch(() => {});
}

// image_path is already a browser-usable relative URL for the local driver.
function urlFor(imagePath) {
  return imagePath;
}

module.exports = { put, remove, urlFor, resolveUploadPath };
