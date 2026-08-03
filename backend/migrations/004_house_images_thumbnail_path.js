// The resized 400px card image. Existing rows are left NULL; templates fall
// back to image_path for those. try/catch guards a database that already has
// this column from an older checkout's ad-hoc ALTER TABLE.
module.exports = {
  version: 4,
  up(db) {
    try {
      db.exec(`ALTER TABLE house_images ADD COLUMN thumbnail_path TEXT`);
    } catch (_) {
      /* column already exists */
    }
  },
};
