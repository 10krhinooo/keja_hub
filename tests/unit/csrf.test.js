const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { csrfProtection, csrfVerify } = require('../../backend/middleware/csrf');

// Minimal express-shaped doubles. The middleware only touches session, method,
// headers, body, res.locals and res.status/send.
function mockReq({ method = 'GET', session = {}, headers = {}, body = {} } = {}) {
  return { method, session, headers, body };
}

function mockRes() {
  const res = {
    locals: {},
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function run(middleware, req, res) {
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return nextCalled;
}

describe('csrfProtection', () => {
  test('mints a token on first use and puts it on res.locals', () => {
    const req = mockReq();
    const res = mockRes();
    assert.equal(run(csrfProtection, req, res), true);
    assert.match(req.session.csrfToken, /^[a-f0-9]{64}$/);
    assert.equal(res.locals.csrfToken, req.session.csrfToken);
  });

  test('reuses an existing session token', () => {
    const existing = 'a'.repeat(64);
    const req = mockReq({ session: { csrfToken: existing } });
    const res = mockRes();
    run(csrfProtection, req, res);
    assert.equal(req.session.csrfToken, existing);
    assert.equal(res.locals.csrfToken, existing);
  });

  test('lets GET through without a token', () => {
    assert.equal(run(csrfProtection, mockReq({ method: 'GET' }), mockRes()), true);
  });

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    test(`rejects ${method} with no token`, () => {
      const req = mockReq({ method, session: { csrfToken: 'tok' } });
      const res = mockRes();
      assert.equal(run(csrfProtection, req, res), false);
      assert.equal(res.statusCode, 403);
      assert.match(res.body, /CSRF/);
    });

    test(`accepts ${method} with the matching body token`, () => {
      const req = mockReq({ method, session: { csrfToken: 'tok' }, body: { _csrf: 'tok' } });
      assert.equal(run(csrfProtection, req, mockRes()), true);
    });
  }

  test('rejects a mismatched token', () => {
    const req = mockReq({
      method: 'POST',
      session: { csrfToken: 'right' },
      body: { _csrf: 'wrong' },
    });
    const res = mockRes();
    assert.equal(run(csrfProtection, req, res), false);
    assert.equal(res.statusCode, 403);
  });

  test('accepts the token from the x-csrf-token header', () => {
    const req = mockReq({
      method: 'POST',
      session: { csrfToken: 'tok' },
      headers: { 'x-csrf-token': 'tok' },
    });
    assert.equal(run(csrfProtection, req, mockRes()), true);
  });

  test('skips the check for multipart, which multer parses later', () => {
    // The body is empty at this point because multer has not run yet, so the
    // check here would always fail. csrfVerify runs after multer instead.
    const req = mockReq({
      method: 'POST',
      session: { csrfToken: 'tok' },
      headers: { 'content-type': 'multipart/form-data; boundary=----x' },
    });
    assert.equal(run(csrfProtection, req, mockRes()), true);
  });

  test('still enforces the check for urlencoded posts', () => {
    const req = mockReq({
      method: 'POST',
      session: { csrfToken: 'tok' },
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    assert.equal(run(csrfProtection, req, mockRes()), false);
  });

  test('treats a missing content-type as non-multipart', () => {
    const req = mockReq({ method: 'POST', session: { csrfToken: 'tok' } });
    assert.equal(run(csrfProtection, req, mockRes()), false);
  });
});

describe('csrfVerify', () => {
  test('accepts a matching body token', () => {
    const req = mockReq({ method: 'POST', session: { csrfToken: 'tok' }, body: { _csrf: 'tok' } });
    assert.equal(run(csrfVerify, req, mockRes()), true);
  });

  test('accepts a matching header token', () => {
    const req = mockReq({
      method: 'POST',
      session: { csrfToken: 'tok' },
      headers: { 'x-csrf-token': 'tok' },
    });
    assert.equal(run(csrfVerify, req, mockRes()), true);
  });

  test('rejects a missing token', () => {
    const req = mockReq({ method: 'POST', session: { csrfToken: 'tok' } });
    const res = mockRes();
    assert.equal(run(csrfVerify, req, res), false);
    assert.equal(res.statusCode, 403);
  });

  test('rejects a mismatched token', () => {
    const req = mockReq({ method: 'POST', session: { csrfToken: 'right' }, body: { _csrf: 'no' } });
    const res = mockRes();
    assert.equal(run(csrfVerify, req, res), false);
    assert.equal(res.statusCode, 403);
  });

  test('rejects when the session has no token at all', () => {
    const req = mockReq({ method: 'POST', session: {}, body: { _csrf: 'anything' } });
    const res = mockRes();
    assert.equal(run(csrfVerify, req, res), false);
    assert.equal(res.statusCode, 403);
  });

  test('does not skip multipart, since that is the whole point of it', () => {
    const req = mockReq({
      method: 'POST',
      session: { csrfToken: 'tok' },
      headers: { 'content-type': 'multipart/form-data; boundary=----x' },
    });
    assert.equal(run(csrfVerify, req, mockRes()), false);
  });
});
