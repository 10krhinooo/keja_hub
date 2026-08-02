const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, CREDENTIALS } = require('../helpers/app');
const { createAgent, loginAs } = require('../helpers/agent');

describe('app boots', () => {
  let app, cleanup;

  before(async () => {
    ({ app, cleanup } = await createTestApp());
  });

  after(() => cleanup());

  test('healthz reports ok', async () => {
    const client = createAgent(app);
    const res = await client.get('/healthz');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });

  test('unknown path renders the 404 view', async () => {
    const client = createAgent(app);
    const res = await client.get('/definitely-not-a-page');
    assert.equal(res.status, 404);
  });

  test('login page exposes a csrf token', async () => {
    const client = createAgent(app);
    const token = await client.csrf('/login');
    assert.match(token, /^[a-f0-9]{64}$/);
  });

  test('a POST without a csrf token is rejected', async () => {
    const client = createAgent(app);
    const res = await client.agent.post('/login').type('form').send({
      email: 'brian@student.com',
      password: CREDENTIALS.seedPassword,
    });
    assert.equal(res.status, 403);
  });

  test('seeded student can log in and reach their dashboard', async () => {
    const client = await loginAs(app, 'student');
    const res = await client.get('/student/dashboard');
    assert.equal(res.status, 200);
  });
});
