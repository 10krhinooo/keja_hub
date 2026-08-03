const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const logger = require('../../backend/utils/logger');

function mockReq() {
  return {};
}

function run(middleware, req, res) {
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return nextCalled;
}

describe('logger', () => {
  describe('requestId', () => {
    test('attaches a uuid to req and calls next', () => {
      const req = mockReq();
      assert.equal(run(logger.requestId, req, {}), true);
      assert.match(req.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    test('gives each request a different id', () => {
      const a = mockReq();
      const b = mockReq();
      run(logger.requestId, a, {});
      run(logger.requestId, b, {});
      assert.notEqual(a.id, b.id);
    });
  });

  describe('format', () => {
    test('includes level, message and an ISO timestamp', () => {
      const entry = logger.format('info', 'Something happened');
      assert.equal(entry.level, 'info');
      assert.equal(entry.message, 'Something happened');
      assert.ok(!isNaN(Date.parse(entry.timestamp)));
    });

    test('carries the request id when a request is given', () => {
      const req = { id: 'abc-123' };
      const entry = logger.format('info', 'msg', { req });
      assert.equal(entry.requestId, 'abc-123');
    });

    test('omits requestId when no request is given', () => {
      const entry = logger.format('info', 'msg');
      assert.equal('requestId' in entry, false);
    });

    test('serializes an error to message and stack', () => {
      const err = new Error('boom');
      const entry = logger.format('error', 'Something failed', { err });
      assert.equal(entry.err.message, 'boom');
      assert.equal(typeof entry.err.stack, 'string');
    });

    test('spreads extra metadata onto the entry', () => {
      const entry = logger.format('info', 'msg', { userId: 42 });
      assert.equal(entry.userId, 42);
    });
  });

  describe('quiet gate', () => {
    // logger.info/warn/error no-op under NODE_ENV=test (the gate every test in
    // this suite runs under), matching database.js's isQuiet() precedent.
    // Flip it off just for this block to assert the emitting side too.
    test('does not write to the console under NODE_ENV=test', () => {
      let called = false;
      const original = console.log;
      console.log = () => {
        called = true;
      };
      try {
        logger.info('quiet please');
      } finally {
        console.log = original;
      }
      assert.equal(called, false);
    });

    test('writes a JSON line when not under test', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalLog = console.log;
      let logged = null;
      console.log = (line) => {
        logged = line;
      };
      process.env.NODE_ENV = 'development';
      try {
        logger.info('hello', { foo: 'bar' });
      } finally {
        process.env.NODE_ENV = originalEnv;
        console.log = originalLog;
      }
      assert.ok(logged);
      const parsed = JSON.parse(logged);
      assert.equal(parsed.message, 'hello');
      assert.equal(parsed.foo, 'bar');
    });

    test('error() writes with console.error, warn() with console.warn', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalError = console.error;
      const originalWarn = console.warn;
      let errored = null;
      let warned = null;
      console.error = (line) => {
        errored = line;
      };
      console.warn = (line) => {
        warned = line;
      };
      process.env.NODE_ENV = 'development';
      try {
        logger.error('bad', { err: new Error('x') });
        logger.warn('careful');
      } finally {
        process.env.NODE_ENV = originalEnv;
        console.error = originalError;
        console.warn = originalWarn;
      }
      assert.ok(errored);
      assert.ok(warned);
    });
  });
});
