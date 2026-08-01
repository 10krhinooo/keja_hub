const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

// The middleware calls getDB() from backend/database, so a database has to exist
// before it runs. Booting the shared test app is the cheapest way to get one
// that is really wired up the way production is.
const { createTestApp } = require('../helpers/app');
const { requireLogin, requireRole } = require('../../backend/middleware/auth');

function mockReq(session = {}) {
  return {
    session: {
      ...session,
      destroy(cb) {
        this.destroyed = true;
        cb();
      },
    },
  };
}

function mockRes() {
  return {
    redirectedTo: null,
    redirect(url) {
      this.redirectedTo = url;
      return this;
    },
  };
}

function run(middleware, req, res) {
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return nextCalled;
}

describe('auth middleware', () => {
  let db, activeStudentId, deactivatedId;

  before(async () => {
    ({ db } = await createTestApp());

    activeStudentId = db
      .prepare(`SELECT id FROM users WHERE email = ?`)
      .get('brian@student.com').id;

    const { lastInsertRowid } = db
      .prepare(`INSERT INTO users (name,email,password,role,is_active) VALUES (?,?,?,?,0)`)
      .run('Gone', 'deactivated@student.com', 'x', 'student');
    deactivatedId = lastInsertRowid;
  });

  describe('requireLogin', () => {
    test('redirects an anonymous visitor to login', () => {
      const res = mockRes();
      assert.equal(run(requireLogin, mockReq(), res), false);
      assert.equal(res.redirectedTo, '/login');
    });

    test('lets an active user through', () => {
      const req = mockReq({ user: { id: activeStudentId, role: 'student' } });
      assert.equal(run(requireLogin, req, mockRes()), true);
    });

    test('destroys the session of a deactivated user and sends them to login', () => {
      const req = mockReq({ user: { id: deactivatedId, role: 'student' } });
      const res = mockRes();
      assert.equal(run(requireLogin, req, res), false);
      assert.equal(req.session.destroyed, true);
      assert.equal(res.redirectedTo, '/login');
    });

    test('treats a user id that no longer exists as inactive', () => {
      // A session outliving its row would otherwise sail straight through.
      const req = mockReq({ user: { id: 9999999, role: 'student' } });
      const res = mockRes();
      assert.equal(run(requireLogin, req, res), false);
      assert.equal(res.redirectedTo, '/login');
    });
  });

  describe('requireRole', () => {
    test('redirects an anonymous visitor', () => {
      const res = mockRes();
      assert.equal(run(requireRole('student'), mockReq(), res), false);
      assert.equal(res.redirectedTo, '/login');
    });

    test('redirects a user holding the wrong role', () => {
      const req = mockReq({ user: { id: activeStudentId, role: 'student' } });
      const res = mockRes();
      assert.equal(run(requireRole('landlord'), req, res), false);
      assert.equal(res.redirectedTo, '/login');
    });

    test('lets the matching role through', () => {
      const req = mockReq({ user: { id: activeStudentId, role: 'student' } });
      assert.equal(run(requireRole('student'), req, mockRes()), true);
    });

    test('accepts any one of several allowed roles', () => {
      const req = mockReq({ user: { id: activeStudentId, role: 'student' } });
      assert.equal(run(requireRole('admin', 'student'), req, mockRes()), true);
    });

    test('still applies the is_active check on top of the role check', () => {
      const req = mockReq({ user: { id: deactivatedId, role: 'student' } });
      const res = mockRes();
      assert.equal(run(requireRole('student'), req, res), false);
      assert.equal(req.session.destroyed, true);
    });
  });
});
