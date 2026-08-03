const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { createTestApp, CREDENTIALS, newPassword } = require('../helpers/app');
const { createAgent } = require('../helpers/agent');

// Passwords these tests set. Generated so no literal password lives in the repo.
const NEW_PASSWORD = newPassword();
const OTHER_PASSWORD = newPassword();

describe('auth', () => {
  let app, db, cleanup;

  const one = (sql, params = []) => db.prepare(sql).get(...params) ?? null;

  // The forgot-password page surfaces the reset link when SMTP is not
  // configured, which is exactly the case under test.
  const linkFromPage = (html) => {
    const match = html.match(/\/reset-password\?token=([a-f0-9]{64})/);
    return match ? match[1] : null;
  };

  before(async () => {
    ({ app, db, cleanup } = await createTestApp());
  });
  after(() => cleanup());

  describe('public pages', () => {
    for (const path of ['/', '/home', '/login', '/register', '/forgot-password']) {
      test(`${path} renders`, async () => {
        const res = await createAgent(app).get(path);
        assert.equal(res.status, 200);
      });
    }
  });

  describe('register', () => {
    const form = (over = {}) => ({
      name: 'New Person',
      email: `new-${Math.random().toString(16).slice(2)}@student.com`,
      password: CREDENTIALS.seedPassword,
      confirm_password: CREDENTIALS.seedPassword,
      role: 'student',
      phone: '0700000000',
      ...over,
    });

    test('creates a student and sends them to verify their email', async () => {
      const client = createAgent(app);
      const body = form();
      const res = await client.post('/register', body, '/register');
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/verify-email/pending');

      const user = one(`SELECT role, email_verified FROM users WHERE email = ?`, [body.email]);
      assert.equal(user.role, 'student');
      assert.equal(user.email_verified, 0);
    });

    test('creates a landlord with a landlord profile', async () => {
      const client = createAgent(app);
      const body = form({
        role: 'landlord',
        email: `ll-${Math.random().toString(16).slice(2)}@landlord.com`,
      });
      const res = await client.post('/register', body, '/register');
      assert.equal(res.headers.location, '/verify-email/pending');

      const user = one(`SELECT id FROM users WHERE email = ?`, [body.email]);
      assert.ok(one(`SELECT id FROM landlord_profiles WHERE user_id = ?`, [user.id]));
    });

    test('lowercases and trims the email', async () => {
      const client = createAgent(app);
      const raw = `  MiXeD-${Math.random().toString(16).slice(2)}@Student.COM  `;
      await client.post('/register', form({ email: raw }), '/register');
      assert.ok(one(`SELECT id FROM users WHERE email = ?`, [raw.trim().toLowerCase()]));
    });

    test('rejects a missing field', async () => {
      const client = createAgent(app);
      const res = await client.post('/register', form({ name: '' }), '/register');
      assert.equal(res.status, 200);
      assert.match(res.text, /fill in every field/);
    });

    test('rejects a malformed email', async () => {
      const client = createAgent(app);
      const res = await client.post('/register', form({ email: 'not-an-email' }), '/register');
      assert.match(res.text, /does not look valid/);
    });

    test('rejects a short password', async () => {
      const client = createAgent(app);
      const res = await client.post(
        '/register',
        form({ password: 'short', confirm_password: 'short' }),
        '/register'
      );
      assert.match(res.text, /at least 8 characters/);
    });

    test('rejects a mismatched confirmation', async () => {
      const client = createAgent(app);
      const res = await client.post(
        '/register',
        form({ confirm_password: OTHER_PASSWORD }),
        '/register'
      );
      assert.match(res.text, /do not match/);
    });

    test('rejects an invalid role', async () => {
      const client = createAgent(app);
      const res = await client.post('/register', form({ role: 'admin' }), '/register');
      assert.match(res.text, /student or a landlord/);
    });

    test('rejects a duplicate email', async () => {
      const client = createAgent(app);
      const res = await client.post('/register', form({ email: 'brian@student.com' }), '/register');
      assert.match(res.text, /already registered/);
    });
  });

  describe('login', () => {
    test('sends a student to their dashboard', async () => {
      const client = createAgent(app);
      const res = await client.login('brian@student.com', CREDENTIALS.seedPassword);
      assert.match(res.headers.location, /\/student\/dashboard/);
    });

    test('sends a landlord to their dashboard', async () => {
      const client = createAgent(app);
      const res = await client.login('james@landlord.com', CREDENTIALS.seedPassword);
      assert.match(res.headers.location, /\/landlord\/dashboard/);
    });

    test('sends an admin to the admin dashboard', async () => {
      const client = createAgent(app);
      const res = await client.login('admin@kejahub.com', CREDENTIALS.adminPassword);
      assert.match(res.headers.location, /\/admin\/dashboard/);
    });

    test('accepts a differently cased email', async () => {
      const client = createAgent(app);
      const res = await client.login('BRIAN@STUDENT.COM', CREDENTIALS.seedPassword);
      assert.equal(res.status, 302);
    });

    test('rejects a wrong password', async () => {
      const client = createAgent(app);
      const res = await client.login('brian@student.com', 'wrong-password');
      assert.equal(res.status, 200);
      assert.match(res.text, /Incorrect email or password/);
    });

    test('gives an unknown email the same message as a wrong password', async () => {
      // Otherwise the form becomes an account enumeration oracle.
      const client = createAgent(app);
      const res = await client.login('nobody@nowhere.com', CREDENTIALS.seedPassword);
      assert.match(res.text, /Incorrect email or password/);
    });

    test('rejects empty credentials', async () => {
      const client = createAgent(app);
      const res = await client.post('/login', { email: '', password: '' }, '/login');
      assert.match(res.text, /enter both your email and password/);
    });

    test('refuses a deactivated account with a distinct message', async () => {
      const bcrypt = require('bcryptjs');
      const hash = bcrypt.hashSync(CREDENTIALS.seedPassword, 10);
      db.prepare(`INSERT INTO users (name,email,password,role,is_active) VALUES (?,?,?,?,0)`).run(
        'Blocked',
        'blocked@student.com',
        hash,
        'student'
      );

      const client = createAgent(app);
      const res = await client.login('blocked@student.com', CREDENTIALS.seedPassword);
      assert.match(res.text, /deactivated/);
    });

    test('logout ends the session', async () => {
      const client = createAgent(app);
      await client.login('brian@student.com', CREDENTIALS.seedPassword);
      const res = await client.logout();
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/login');

      const after = await client.get('/student/dashboard');
      assert.equal(after.headers.location, '/login');
    });
  });

  describe('forgot password', () => {
    test('issues a token for a known address', async () => {
      const client = createAgent(app);
      const res = await client.post(
        '/forgot-password',
        { email: 'brian@student.com' },
        '/forgot-password'
      );
      assert.equal(res.status, 200);
      assert.ok(linkFromPage(res.text), 'a reset link is surfaced with no SMTP configured');
    });

    test('gives an unknown address the identical response', async () => {
      const client = createAgent(app);
      const known = await client.post(
        '/forgot-password',
        { email: 'brian@student.com' },
        '/forgot-password'
      );
      const unknown = await client.post(
        '/forgot-password',
        { email: 'nobody@nowhere.com' },
        '/forgot-password'
      );
      assert.match(known.text, /we have sent a reset link/);
      assert.match(unknown.text, /we have sent a reset link/);
      assert.equal(linkFromPage(unknown.text), null, 'no token for an address with no account');
    });

    test('rejects an empty address', async () => {
      const client = createAgent(app);
      const res = await client.post('/forgot-password', { email: '' }, '/forgot-password');
      assert.match(res.text, /enter the email address/);
    });

    test('stores the token hashed, never in the clear', async () => {
      const client = createAgent(app);
      const res = await client.post(
        '/forgot-password',
        { email: 'amina@student.com' },
        '/forgot-password'
      );
      const raw = linkFromPage(res.text);
      assert.ok(raw);
      assert.equal(one(`SELECT id FROM password_resets WHERE token = ?`, [raw]), null);

      const crypto = require('crypto');
      const hashed = crypto.createHash('sha256').update(raw).digest('hex');
      assert.ok(one(`SELECT id FROM password_resets WHERE token = ?`, [hashed]));
    });

    test('replaces an earlier token for the same account', async () => {
      const client = createAgent(app);
      await client.post('/forgot-password', { email: 'kevin@student.com' }, '/forgot-password');
      await client.post('/forgot-password', { email: 'kevin@student.com' }, '/forgot-password');

      const user = one(`SELECT id FROM users WHERE email='kevin@student.com'`);
      const count = one(`SELECT COUNT(*) as c FROM password_resets WHERE user_id = ?`, [user.id]);
      assert.equal(count.c, 1);
    });

    test('will not issue a token for a deactivated account', async () => {
      const client = createAgent(app);
      const res = await client.post(
        '/forgot-password',
        { email: 'blocked@student.com' },
        '/forgot-password'
      );
      assert.equal(linkFromPage(res.text), null);
    });
  });

  describe('reset password', () => {
    const tokenFor = async (email) => {
      const client = createAgent(app);
      const res = await client.post('/forgot-password', { email }, '/forgot-password');
      return linkFromPage(res.text);
    };

    test('the reset form rejects a missing token', async () => {
      const res = await createAgent(app).get('/reset-password');
      assert.match(res.text, /No reset token provided/);
    });

    test('the reset form rejects an unknown token', async () => {
      const res = await createAgent(app).get('/reset-password?token=' + 'f'.repeat(64));
      assert.match(res.text, /expired or has already been used/);
    });

    test('the reset form accepts a valid token', async () => {
      const token = await tokenFor('faith@student.com');
      const res = await createAgent(app).get('/reset-password?token=' + token);
      assert.equal(res.status, 200);
      assert.match(res.text, /name="new_password"/);
    });

    test('changes the password and consumes the token', async () => {
      const token = await tokenFor('michael@student.com');
      const client = createAgent(app);
      const res = await client.post(
        '/reset-password',
        { token, new_password: NEW_PASSWORD, confirm_password: NEW_PASSWORD },
        '/login'
      );

      assert.equal(res.status, 302);
      assert.match(res.headers.location, /success=password_reset/);

      const login = await createAgent(app).login('michael@student.com', NEW_PASSWORD);
      assert.equal(login.status, 302);

      const reuse = await createAgent(app).post(
        '/reset-password',
        { token, new_password: OTHER_PASSWORD, confirm_password: OTHER_PASSWORD },
        '/login'
      );
      assert.match(reuse.text, /expired or has already been used/);
    });

    test('rejects a short new password', async () => {
      const token = await tokenFor('sandra@student.com');
      const res = await createAgent(app).post(
        '/reset-password',
        { token, new_password: 'short', confirm_password: 'short' },
        '/login'
      );
      assert.match(res.text, /at least 8 characters/);
    });

    test('rejects a mismatched confirmation', async () => {
      const token = await tokenFor('patrick@student.com');
      const res = await createAgent(app).post(
        '/reset-password',
        { token, new_password: NEW_PASSWORD, confirm_password: OTHER_PASSWORD },
        '/login'
      );
      assert.match(res.text, /do not match/);
    });

    test('redirects when no token is posted at all', async () => {
      const res = await createAgent(app).post(
        '/reset-password',
        { new_password: NEW_PASSWORD, confirm_password: NEW_PASSWORD },
        '/login'
      );
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/forgot-password');
    });

    test('rejects an expired token', async () => {
      const token = await tokenFor('lydia@student.com');
      const crypto = require('crypto');
      const hashed = crypto.createHash('sha256').update(token).digest('hex');
      db.prepare(`UPDATE password_resets SET expires_at = ? WHERE token = ?`).run(
        Date.now() - 1000,
        hashed
      );

      const res = await createAgent(app).post(
        '/reset-password',
        { token, new_password: NEW_PASSWORD, confirm_password: NEW_PASSWORD },
        '/login'
      );
      assert.match(res.text, /expired or has already been used/);
    });
  });

  describe('email verification', () => {
    const verifyLinkFromPage = (html) => {
      const match = html.match(/\/verify-email\?token=([a-f0-9]{64})/);
      return match ? match[1] : null;
    };

    const registerAndGetLink = async () => {
      const client = createAgent(app);
      const email = `verify-${Math.random().toString(16).slice(2)}@student.com`;
      await client.register({
        name: 'Verify Me',
        email,
        password: CREDENTIALS.seedPassword,
        confirm_password: CREDENTIALS.seedPassword,
        role: 'student',
        phone: '0700000000',
      });
      const pending = await client.get('/verify-email/pending');
      return { client, email, token: verifyLinkFromPage(pending.text) };
    };

    test('registering blocks the dashboard until verified', async () => {
      const { client } = await registerAndGetLink();
      const res = await client.get('/student/dashboard');
      assert.equal(res.headers.location, '/verify-email/pending');
    });

    test('stores the token hashed, never in the clear', async () => {
      const { email, token } = await registerAndGetLink();
      assert.ok(token, 'a verification link is surfaced with no SMTP configured');
      assert.equal(one(`SELECT id FROM email_verifications WHERE token = ?`, [token]), null);

      const crypto = require('crypto');
      const hashed = crypto.createHash('sha256').update(token).digest('hex');
      const user = one(`SELECT id FROM users WHERE email = ?`, [email]);
      assert.ok(
        one(`SELECT id FROM email_verifications WHERE token = ? AND user_id = ?`, [hashed, user.id])
      );
    });

    test('consuming a valid token verifies the account and unblocks the dashboard', async () => {
      const { client, token, email } = await registerAndGetLink();
      const res = await client.get(`/verify-email?token=${token}`);
      assert.equal(res.status, 302);
      assert.match(res.headers.location, /\/student\/dashboard\?success=verified/);

      assert.equal(
        one(`SELECT email_verified FROM users WHERE email = ?`, [email]).email_verified,
        1
      );

      const dashboard = await client.get('/student/dashboard');
      assert.equal(dashboard.status, 200);
    });

    test('a token can only be used once', async () => {
      const { client, token } = await registerAndGetLink();
      await client.get(`/verify-email?token=${token}`);
      const reuse = await createAgent(app).get(`/verify-email?token=${token}`);
      assert.match(reuse.text, /expired or has already been used/);
    });

    test('rejects an expired token', async () => {
      const { token } = await registerAndGetLink();
      const crypto = require('crypto');
      const hashed = crypto.createHash('sha256').update(token).digest('hex');
      db.prepare(`UPDATE email_verifications SET expires_at = ? WHERE token = ?`).run(
        Date.now() - 1000,
        hashed
      );

      const res = await createAgent(app).get(`/verify-email?token=${token}`);
      assert.match(res.text, /expired or has already been used/);
    });

    test('resend issues a new token and replaces the old one', async () => {
      const { client, email } = await registerAndGetLink();
      const res = await client.post('/verify-email/resend', {}, '/verify-email/pending');
      assert.equal(res.status, 200);
      const token = verifyLinkFromPage(res.text);
      assert.ok(token);

      const user = one(`SELECT id FROM users WHERE email = ?`, [email]);
      const count = one(`SELECT COUNT(*) as c FROM email_verifications WHERE user_id = ?`, [
        user.id,
      ]);
      assert.equal(count.c, 1);
    });

    test('rejects an unauthenticated verify-email/resend', async () => {
      const res = await createAgent(app).post('/verify-email/resend', {}, '/login');
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/login');
    });
  });
});
