const request = require('supertest');

/**
 * A supertest agent that persists the session cookie and knows how to satisfy
 * CSRF. Every mutating request needs a token: csrfProtection rejects a POST
 * without one with 403, and the token lives in the session, so it has to be
 * scraped from a page fetched by this same agent.
 */
function createAgent(app) {
  const agent = request.agent(app);

  // The token is stable for the life of the session, so one fetch is enough.
  let cachedToken = null;

  async function csrf(fromPath = '/login') {
    if (cachedToken) return cachedToken;
    const res = await agent.get(fromPath);
    const match = res.text.match(/name="_csrf"\s+value="([^"]+)"/);
    if (!match) {
      throw new Error(`No _csrf input found on ${fromPath} (status ${res.status})`);
    }
    cachedToken = match[1];
    return cachedToken;
  }

  // Login calls req.session.regenerate() to prevent session fixation, which
  // throws away the CSRF token along with the rest of the old session. Drop the
  // cached token so the next mutating request fetches the new one.
  async function login(email, password) {
    const _csrf = await csrf('/login');
    const res = await agent.post('/login').type('form').send({ email, password, _csrf });
    cachedToken = null;
    return res;
  }

  async function logout() {
    const _csrf = await csrf('/login');
    const res = await agent.post('/logout').type('form').send({ _csrf });
    cachedToken = null;
    return res;
  }

  // Form POST with the CSRF token filled in.
  async function post(url, body = {}, tokenSource = '/login') {
    const _csrf = await csrf(tokenSource);
    return agent
      .post(url)
      .type('form')
      .send({ ...body, _csrf });
  }

  return { agent, csrf, login, logout, post, get: (url) => agent.get(url) };
}

// Passwords come from the harness, which generates them per run. Nothing here
// is a literal a secret scanner could mistake for a real credential.
const DEMO = {
  student: { email: 'brian@student.com', password: () => process.env.SEED_PASSWORD },
  landlord: { email: 'james@landlord.com', password: () => process.env.SEED_PASSWORD },
  admin: { email: 'admin@kejahub.com', password: () => process.env.ADMIN_PASSWORD },
};

async function loginAs(app, role) {
  const client = createAgent(app);
  const creds = DEMO[role];
  if (!creds) throw new Error(`Unknown demo role: ${role}`);
  await client.login(creds.email, creds.password());
  return client;
}

module.exports = { createAgent, loginAs, DEMO };
