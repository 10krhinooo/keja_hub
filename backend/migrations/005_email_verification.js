// Same shape as password_resets: a hashed, single-use, expiring token per
// user. email_verified defaults to 0 so every new registration is gated
// until the link is clicked; existing accounts are backfilled to verified
// by the seed data / an operator running an UPDATE, not by this migration,
// since a fresh install has no way to know which existing emails are real.
module.exports = {
  version: 5,
  up(db) {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0`);
    } catch (_) {
      /* column already exists */
    }

    db.exec(`CREATE TABLE IF NOT EXISTS email_verifications (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
  },
};
