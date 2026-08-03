// Lets landlords reorder listing photos. Backfilled by id so existing
// galleries keep their original upload order. try/catch guards a database
// that already has this column from an older checkout's ad-hoc ALTER TABLE.
module.exports = {
  version: 3,
  up(db) {
    try {
      db.exec(`ALTER TABLE house_images ADD COLUMN sort_order INTEGER DEFAULT 0`);
      db.exec(`UPDATE house_images SET sort_order = id`);
    } catch (_) {
      /* column already exists */
    }
  },
};
