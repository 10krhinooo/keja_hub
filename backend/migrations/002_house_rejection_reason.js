// try/catch guards a database that already has this column from an older
// checkout that ran the pre-migrations ad-hoc ALTER TABLE directly.
module.exports = {
  version: 2,
  up(db) {
    try {
      db.exec(`ALTER TABLE houses ADD COLUMN rejection_reason TEXT`);
    } catch (_) {
      /* column already exists */
    }
  },
};
