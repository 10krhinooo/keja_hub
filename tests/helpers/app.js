const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// These have to be set before anything requires backend/app.js or
// backend/database.js, since both read process.env at module load. dotenv does
// not overwrite variables that are already set, so the real .env cannot clobber
// them.
//
// The three credentials below are generated per run rather than written down.
// A literal here is indistinguishable from a real credential to a secret
// scanner, and tests do not need a stable value: they read these back through
// the exports at the bottom of this file.
const random = () => crypto.randomBytes(18).toString('base64url');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || random();
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || random();
process.env.SEED_PASSWORD = process.env.SEED_PASSWORD || random();

// A developer's real .env usually has working Gmail credentials. Left alone,
// dotenv would load them and the password reset tests would try to send actual
// mail to actual people. Defining them as empty keeps dotenv from filling them
// in (it only sets keys that are absent) and leaves the mailer unconfigured,
// which is the path the reset tests exercise.
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.APP_URL = '';

const TMP_ROOT = path.join(os.tmpdir(), 'kejahub-tests');

function freshDbPath() {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  return path.join(TMP_ROOT, `db-${crypto.randomBytes(8).toString('hex')}.db`);
}

// `node --test` runs each test file in its own process, so one booted app per
// process is the right granularity: test files are isolated from each other by
// construction, and everything inside a file shares the seeded database.
//
// Memoized rather than cache-busted on purpose. database.js keeps the handle in
// a module-level singleton and the controllers captured their own reference to
// that module at require time, so clearing require.cache would leave the
// controllers talking to a different database than the tests.
let booted = null;

async function createTestApp() {
  if (booted) return booted;

  const dbPath = freshDbPath();
  process.env.DB_PATH = dbPath;

  const database = require('../../backend/database');
  await database.initDB();

  const app = require('../../backend/app');

  const cleanup = () => {
    for (const suffix of ['', '.tmp']) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        /* already gone */
      }
    }
  };

  booted = { app, db: database.getDB(), database, dbPath, cleanup };
  return booted;
}

// Credentials the seeded database was actually built with, for tests to log in.
const CREDENTIALS = {
  seedPassword: process.env.SEED_PASSWORD,
  adminPassword: process.env.ADMIN_PASSWORD,
};

module.exports = { createTestApp, freshDbPath, TMP_ROOT, CREDENTIALS };
