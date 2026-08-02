const { test, describe, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { memoryDb, addImages, readImages } = require('../helpers/db');
const houseImages = require('../../backend/utils/houseImages');

const {
  MAX_IMAGES_PER_HOUSE,
  deleteImageFiles,
  deleteUploadedFiles,
  getHouseImagePaths,
  getHouseImages,
  normalizePrimary,
  applyImageOrder,
  nextSortOrder,
  countHouseImages,
} = houseImages;

const PROJECT_ROOT = path.join(__dirname, '../../');
const UPLOAD_ROOT = path.join(PROJECT_ROOT, 'uploads');

// A short wait: the delete helpers are deliberately fire-and-forget, so the
// unlink lands on a later tick than the call. fs.promises.unlink resolves
// off the libuv threadpool, which a single setImmediate is not reliably
// past under load (observed flaking on Node 22 in CI).
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('houseImages', () => {
  let db;

  before(async () => {
    db = await memoryDb();
  });
  beforeEach(() => {
    db.exec('DELETE FROM house_images');
  });

  test('caps galleries at ten images', () => {
    assert.equal(MAX_IMAGES_PER_HOUSE, 10);
  });

  describe('getHouseImages', () => {
    test('returns an empty array for a house with no images', () => {
      assert.deepEqual(getHouseImages(db, 1), []);
    });

    test('orders by sort_order, then by id as a tie-break', () => {
      const [a, b, c] = addImages(db, 1, [{ order: 5 }, { order: 1 }, { order: 1 }]);
      const got = getHouseImages(db, 1).map((i) => i.id);
      assert.deepEqual(got, [b, c, a]);
    });

    test('does not leak images belonging to another house', () => {
      addImages(db, 1, [{}, {}]);
      addImages(db, 2, [{}]);
      assert.equal(getHouseImages(db, 1).length, 2);
    });
  });

  describe('getHouseImagePaths', () => {
    test('returns just the paths', () => {
      addImages(db, 1, [{ path: '/uploads/houses/a.jpg' }, { path: '/uploads/houses/b.jpg' }]);
      const paths = getHouseImagePaths(db, 1);
      assert.equal(paths.length, 2);
      assert.ok(paths.includes('/uploads/houses/a.jpg'));
    });

    test('is empty for an unknown house', () => {
      assert.deepEqual(getHouseImagePaths(db, 999), []);
    });
  });

  describe('countHouseImages', () => {
    test('counts zero for an empty gallery', () => {
      assert.equal(countHouseImages(db, 1), 0);
    });

    test('counts only this house', () => {
      addImages(db, 1, [{}, {}, {}]);
      addImages(db, 2, [{}]);
      assert.equal(countHouseImages(db, 1), 3);
    });
  });

  describe('nextSortOrder', () => {
    test('starts at 0 on an empty gallery', () => {
      assert.equal(nextSortOrder(db, 1), 0);
    });

    test('is one past the current maximum', () => {
      addImages(db, 1, [{ order: 0 }, { order: 7 }, { order: 3 }]);
      assert.equal(nextSortOrder(db, 1), 8);
    });

    test('ignores other houses', () => {
      addImages(db, 2, [{ order: 99 }]);
      assert.equal(nextSortOrder(db, 1), 0);
    });
  });

  describe('normalizePrimary', () => {
    test('does nothing when there are no images', () => {
      normalizePrimary(db, 1, undefined);
      assert.deepEqual(readImages(db, 1), []);
    });

    test('promotes the preferred image', () => {
      const [a, b] = addImages(db, 1, [{ primary: 1 }, {}]);
      normalizePrimary(db, 1, b);
      const rows = readImages(db, 1);
      assert.equal(rows.find((r) => r.id === b).is_primary, 1);
      assert.equal(rows.find((r) => r.id === a).is_primary, 0);
    });

    test('keeps the existing primary when the preferred id is unknown', () => {
      const [, b] = addImages(db, 1, [{}, { primary: 1 }]);
      normalizePrimary(db, 1, 99999);
      assert.equal(readImages(db, 1).find((r) => r.id === b).is_primary, 1);
    });

    test('falls back to the first image when nothing is primary', () => {
      addImages(db, 1, [{ order: 1 }, { order: 0 }]);
      normalizePrimary(db, 1, undefined);
      const rows = readImages(db, 1);
      assert.equal(rows[0].is_primary, 1);
    });

    test('always leaves exactly one primary', () => {
      addImages(db, 1, [{ primary: 1 }, { primary: 1 }, { primary: 1 }]);
      normalizePrimary(db, 1, undefined);
      const primaries = readImages(db, 1).filter((r) => r.is_primary);
      assert.equal(primaries.length, 1);
    });

    test('will not promote an image from another house', () => {
      const [mine] = addImages(db, 1, [{ primary: 1 }]);
      const [theirs] = addImages(db, 2, [{}]);
      normalizePrimary(db, 1, theirs);
      assert.equal(readImages(db, 1).find((r) => r.id === mine).is_primary, 1);
      assert.equal(readImages(db, 2).find((r) => r.id === theirs).is_primary, 0);
    });
  });

  describe('applyImageOrder', () => {
    test('ignores a non-array argument', () => {
      const ids = addImages(db, 1, [{ order: 0 }, { order: 1 }]);
      applyImageOrder(db, 1, 'not-an-array');
      assert.deepEqual(
        readImages(db, 1).map((r) => r.id),
        ids
      );
    });

    test('ignores an empty array', () => {
      const ids = addImages(db, 1, [{ order: 0 }, { order: 1 }]);
      applyImageOrder(db, 1, []);
      assert.deepEqual(
        readImages(db, 1).map((r) => r.id),
        ids
      );
    });

    test('applies the requested order', () => {
      const [a, b, c] = addImages(db, 1, [{ order: 0 }, { order: 1 }, { order: 2 }]);
      applyImageOrder(db, 1, [c, a, b]);
      assert.deepEqual(
        readImages(db, 1).map((r) => r.id),
        [c, a, b]
      );
    });

    test('accepts ids as strings, as a form post sends them', () => {
      const [a, b] = addImages(db, 1, [{ order: 0 }, { order: 1 }]);
      applyImageOrder(db, 1, [String(b), String(a)]);
      assert.deepEqual(
        readImages(db, 1).map((r) => r.id),
        [b, a]
      );
    });

    test('drops ids belonging to another house', () => {
      const [a, b] = addImages(db, 1, [{ order: 0 }, { order: 1 }]);
      const [foreign] = addImages(db, 2, [{}]);
      applyImageOrder(db, 1, [foreign, b, a]);
      assert.deepEqual(
        readImages(db, 1).map((r) => r.id),
        [b, a]
      );
      // The foreign image keeps its own position.
      assert.equal(readImages(db, 2)[0].id, foreign);
    });

    test('ignores duplicate ids', () => {
      const [a, b] = addImages(db, 1, [{ order: 0 }, { order: 1 }]);
      applyImageOrder(db, 1, [b, b, b, a]);
      assert.deepEqual(
        readImages(db, 1).map((r) => r.id),
        [b, a]
      );
    });

    test('ignores unparseable ids', () => {
      const [a, b] = addImages(db, 1, [{ order: 0 }, { order: 1 }]);
      applyImageOrder(db, 1, ['abc', null, undefined, b, a]);
      assert.deepEqual(
        readImages(db, 1).map((r) => r.id),
        [b, a]
      );
    });

    test('appends images the client omitted, after the ones it listed', () => {
      const [a, b, c] = addImages(db, 1, [{ order: 0 }, { order: 1 }, { order: 2 }]);
      applyImageOrder(db, 1, [c]);
      const got = readImages(db, 1).map((r) => r.id);
      assert.equal(got[0], c);
      assert.deepEqual(got.slice(1).sort(), [a, b].sort());
    });

    test('produces contiguous sort_order values from zero', () => {
      const [a, b, c] = addImages(db, 1, [{ order: 40 }, { order: 50 }, { order: 60 }]);
      applyImageOrder(db, 1, [c, b, a]);
      assert.deepEqual(
        readImages(db, 1).map((r) => r.sort_order),
        [0, 1, 2]
      );
    });
  });

  describe('resolveUploadPath guard', () => {
    // resolveUploadPath is not exported, so it is exercised through
    // deleteImageFiles, which is the only caller and the one that matters:
    // image_path comes from the database and must never unlink outside uploads/.
    const tmpOutside = path.join(os.tmpdir(), `kejahub-guard-${Date.now()}.txt`);

    after(() => {
      try {
        fs.unlinkSync(tmpOutside);
      } catch {
        /* fine */
      }
    });

    test('deletes a file that really is inside uploads/', async () => {
      fs.mkdirSync(path.join(UPLOAD_ROOT, 'houses'), { recursive: true });
      const target = path.join(UPLOAD_ROOT, 'houses', `unit-test-${Date.now()}.jpg`);
      fs.writeFileSync(target, 'x');
      deleteImageFiles(['/uploads/houses/' + path.basename(target)]);
      await settle();
      assert.equal(fs.existsSync(target), false);
    });

    test('refuses a traversal escape', async () => {
      fs.writeFileSync(tmpOutside, 'do not delete me');
      const escape = '/uploads/../../../../..' + tmpOutside;
      deleteImageFiles([escape]);
      await settle();
      assert.equal(fs.existsSync(tmpOutside), true);
    });

    test('refuses a seeded static asset outside uploads/', async () => {
      // Seeded listings point at /images/background.jpg, a tracked static file.
      const asset = path.join(PROJECT_ROOT, 'frontend/public/images/background.jpg');
      const existedBefore = fs.existsSync(asset);
      deleteImageFiles(['/images/background.jpg']);
      await settle();
      assert.equal(fs.existsSync(asset), existedBefore);
    });

    test('skips null and empty paths', async () => {
      deleteImageFiles([null, undefined, '']);
      await settle();
    });

    test('tolerates a null list', async () => {
      deleteImageFiles(null);
      await settle();
    });

    test('swallows an unlink failure for a file that is already gone', async () => {
      deleteImageFiles(['/uploads/houses/never-existed-at-all.jpg']);
      await settle();
    });
  });

  describe('deleteUploadedFiles', () => {
    test('unlinks each multer temp file', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kejahub-multer-'));
      const files = [1, 2].map((n) => {
        const p = path.join(dir, `up-${n}.jpg`);
        fs.writeFileSync(p, 'x');
        return { path: p };
      });

      deleteUploadedFiles(files);
      await settle();

      for (const f of files) assert.equal(fs.existsSync(f.path), false);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test('tolerates an empty or missing list', async () => {
      deleteUploadedFiles([]);
      deleteUploadedFiles(undefined);
      await settle();
    });

    test('swallows a failure rather than throwing at the caller', async () => {
      // The whole point: cleanup must never turn a successful request into a 500.
      deleteUploadedFiles([{ path: '/nonexistent/dir/file.jpg' }]);
      await settle();
    });
  });
});
