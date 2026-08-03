const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDB, getDistinctLocations } = require('../database');
const { sendPasswordResetEmail, sendVerificationEmail } = require('../utils/mailer');
const { buildBaseUrl } = require('../utils/url');
const logger = require('../utils/logger');

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Issues a fresh verification token for a user (replacing any earlier one)
// and emails it. Shared by registration and the resend action.
async function issueVerificationEmail(db, req, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + VERIFICATION_TTL_MS;

  db.prepare(`DELETE FROM email_verifications WHERE user_id = ?`).run(user.id);
  db.prepare(
    `INSERT INTO email_verifications (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`
  ).run(crypto.randomUUID(), user.id, hashToken(token), expiresAt);

  const verifyUrl = `${buildBaseUrl(req)}/verify-email?token=${token}`;
  const result = await sendVerificationEmail(user.email, verifyUrl);

  // Local development only: with no SMTP configured, surface the link so the
  // flow stays testable, the same way forgotPassword does.
  const isProduction = process.env.NODE_ENV === 'production';
  return !isProduction && !result.delivered ? `/verify-email?token=${token}` : null;
}

// Emails are compared with `WHERE email = ?`, which is case-sensitive in SQLite.
// Normalising on every read and write keeps Bob@x.com and bob@x.com one account.
function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Reset tokens are stored hashed, so a database leak can't be replayed to take
// over accounts. The raw token only ever exists in the emailed link.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const showHome = (req, res) => {
  const locations = getDistinctLocations();
  res.render('home', { locations });
};

const showRegister = (req, res) => {
  res.render('auth/register', { error: null, values: {} });
};

const showLogin = (req, res) => {
  res.render('auth/login', { error: null });
};

const register = async (req, res) => {
  const values = req.body;
  try {
    const { name, password, confirm_password, role } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!name || !email || !password || !role)
      return res.render('auth/register', {
        error: 'Please fill in every field to create your account.',
        values,
      });

    if (!EMAIL_RE.test(email))
      return res.render('auth/register', {
        error: 'That email address does not look valid. Please check it and try again.',
        values,
      });

    if (password.length < 8)
      return res.render('auth/register', {
        error: 'Your password must be at least 8 characters long.',
        values,
      });

    if (password !== confirm_password)
      return res.render('auth/register', {
        error: 'The two passwords do not match. Please retype them.',
        values,
      });

    if (!['student', 'landlord'].includes(role))
      return res.render('auth/register', {
        error: 'Please choose whether you are a student or a landlord.',
        values,
      });

    const db = getDB();

    const exists = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (exists)
      return res.render('auth/register', {
        error: 'That email is already registered. Try logging in instead, or reset your password.',
        values,
      });

    const hashed = await bcrypt.hash(password, 10);
    const { lastInsertRowid: userId } = db
      .prepare(`INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`)
      .run(name.trim(), email, hashed, role);
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);

    if (role === 'student') {
      db.prepare(`INSERT INTO student_profiles (user_id, phone) VALUES (?, ?)`).run(
        user.id,
        req.body.phone || ''
      );
    } else if (role === 'landlord') {
      db.prepare(`INSERT INTO landlord_profiles (user_id, phone) VALUES (?, ?)`).run(
        user.id,
        req.body.phone || ''
      );
    }

    // Best-effort: a mailer outage should not stop the account from being
    // created. The pending page offers a resend action either way.
    let verifyLink = null;
    try {
      verifyLink = await issueVerificationEmail(db, req, user);
    } catch (mailErr) {
      logger.error('Send verification email error', { req, err: mailErr });
    }

    req.session.regenerate((err) => {
      try {
        if (err) throw err;
        req.session.user = {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          email_verified: false,
        };
        req.session.verifyLink = verifyLink;
        res.redirect('/verify-email/pending');
      } catch (cbErr) {
        logger.error('Register session error', { req, err: cbErr });
        res.render('auth/register', { error: 'Session error, please retry', values });
      }
    });
  } catch (err) {
    logger.error('Register error', { req, err });
    res.render('auth/register', {
      error: 'We could not create your account just now. Please try again in a moment.',
      values,
    });
  }
};

const login = async (req, res) => {
  try {
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!email || !password)
      return res.render('auth/login', { error: 'Please enter both your email and password.' });

    const db = getDB();

    const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);

    // Same message for unknown email and wrong password, so the form can't be
    // used to discover which addresses have accounts.
    const badCredentials =
      'Incorrect email or password. Check for typos, or use "Forgot password" to reset it.';

    if (!user) return res.render('auth/login', { error: badCredentials });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.render('auth/login', { error: badCredentials });

    if (!user.is_active)
      return res.render('auth/login', {
        error:
          'This account has been deactivated. Contact support@kejahub.com if you think this is a mistake.',
      });

    req.session.regenerate((err) => {
      try {
        if (err) throw err;
        req.session.user = {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          email_verified: Boolean(user.email_verified),
        };
        if (user.role === 'admin') return res.redirect('/admin/dashboard?success=welcome');
        if (!user.email_verified) return res.redirect('/verify-email/pending');
        if (user.role === 'landlord') return res.redirect('/landlord/dashboard?success=welcome');
        res.redirect('/student/dashboard?success=welcome');
      } catch (cbErr) {
        logger.error('Login session error', { req, err: cbErr });
        res.status(500).send('Something went wrong. Please try again.');
      }
    });
  } catch (err) {
    logger.error('Login error', { req, err });
    res.render('auth/login', {
      error: 'We could not sign you in just now. Please try again in a moment.',
    });
  }
};

const logout = (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
};

const showForgotPassword = (req, res) => {
  res.render('auth/forgot-password', { error: null, resetLink: null, info: null });
};

// Always the same reply, whether or not the address exists, otherwise this form
// becomes a way to enumerate registered accounts.
const RESET_SENT_INFO =
  'If that email is registered, we have sent a reset link. It expires in 1 hour. ' +
  'check your spam folder if it does not arrive within a few minutes.';

const forgotPassword = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) {
    return res.render('auth/forgot-password', {
      error: 'Please enter the email address you signed up with.',
      resetLink: null,
      info: null,
    });
  }

  try {
    const db = getDB();

    // Opportunistic cleanup: expired tokens are dead weight and extra exposure.
    db.prepare(`DELETE FROM password_resets WHERE expires_at < ?`).run(Date.now());

    const user = db
      .prepare(`SELECT id, email FROM users WHERE email = ? AND is_active = 1`)
      .get(email);

    if (!user) {
      return res.render('auth/forgot-password', {
        error: null,
        resetLink: null,
        info: RESET_SENT_INFO,
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 3600000; // 1 hour

    db.prepare(`DELETE FROM password_resets WHERE user_id = ?`).run(user.id);
    db.prepare(
      `INSERT INTO password_resets (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`
    ).run(crypto.randomUUID(), user.id, hashToken(token), expiresAt);

    const isProduction = process.env.NODE_ENV === 'production';
    const resetUrl = `${buildBaseUrl(req)}/reset-password?token=${token}`;

    const result = await sendPasswordResetEmail(user.email, resetUrl);

    if (!result.delivered && isProduction) {
      // Showing the token in the response would let anyone reset any account.
      logger.error('Password reset email could not be sent: mailer not configured', { req });
      return res.render('auth/forgot-password', {
        error: 'We could not send the reset email just now. Please try again in a few minutes.',
        resetLink: null,
        info: null,
      });
    }

    // Local development only: with no SMTP configured the link is surfaced in
    // the page so the flow stays testable.
    res.render('auth/forgot-password', {
      error: null,
      resetLink: !isProduction && !result.delivered ? `/reset-password?token=${token}` : null,
      info: RESET_SENT_INFO,
    });
  } catch (err) {
    logger.error('Forgot password error', { req, err });
    res.render('auth/forgot-password', {
      error: 'We could not send the reset email just now. Please try again in a few minutes.',
      resetLink: null,
      info: null,
    });
  }
};

const showResetPassword = (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.render('auth/reset-password', {
      error: 'No reset token provided.',
      valid: false,
      token: '',
    });
  }

  const db = getDB();
  const reset = db.prepare(`SELECT * FROM password_resets WHERE token = ?`).get(hashToken(token));

  if (!reset || reset.expires_at < Date.now()) {
    return res.render('auth/reset-password', {
      error:
        'This reset link has expired or has already been used. Request a new one from the "Forgot password" page.',
      valid: false,
      token: '',
    });
  }

  res.render('auth/reset-password', { error: null, valid: true, token });
};

const resetPassword = async (req, res) => {
  const { token, new_password, confirm_password } = req.body;
  if (!token) return res.redirect('/forgot-password');

  try {
    const db = getDB();
    const tokenHash = hashToken(token);
    const reset = db.prepare(`SELECT * FROM password_resets WHERE token = ?`).get(tokenHash);

    if (!reset || reset.expires_at < Date.now()) {
      return res.render('auth/reset-password', {
        error:
          'This reset link has expired or has already been used. Request a new one from the "Forgot password" page.',
        valid: false,
        token: '',
      });
    }

    if (!new_password || new_password.length < 8) {
      return res.render('auth/reset-password', {
        error: 'Your new password must be at least 8 characters long.',
        valid: true,
        token,
      });
    }

    if (new_password !== confirm_password) {
      return res.render('auth/reset-password', {
        error: 'The two passwords do not match. Please retype them.',
        valid: true,
        token,
      });
    }

    const hashed = await bcrypt.hash(new_password, 10);
    db.prepare(`UPDATE users SET password = ? WHERE id = ?`).run(hashed, reset.user_id);
    db.prepare(`DELETE FROM password_resets WHERE token = ?`).run(tokenHash);

    res.redirect('/login?success=password_reset');
  } catch (err) {
    logger.error('Reset password error', { req, err });
    res.render('auth/reset-password', {
      error: 'We could not reset your password just now. Please try again in a moment.',
      valid: true,
      token,
    });
  }
};

function dashboardFor(role) {
  if (role === 'admin') return '/admin/dashboard';
  if (role === 'landlord') return '/landlord/dashboard';
  return '/student/dashboard';
}

const showVerifyPending = (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.email_verified) return res.redirect(dashboardFor(req.session.user.role));

  // One-shot: the dev-mode link (surfaced only when SMTP isn't configured) is
  // shown once, the same way forgotPassword's resetLink works, rather than
  // living in the session indefinitely.
  const verifyLink = req.session.verifyLink || null;
  delete req.session.verifyLink;

  res.render('auth/verify-email-pending', {
    email: req.session.user.email,
    verifyLink,
    error: null,
    info: null,
  });
};

const resendVerification = async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.email_verified) return res.redirect(dashboardFor(req.session.user.role));

  try {
    const db = getDB();
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.session.user.id);
    const verifyLink = await issueVerificationEmail(db, req, user);

    res.render('auth/verify-email-pending', {
      email: user.email,
      verifyLink,
      error: null,
      info: 'We have sent a new verification link. Check your inbox (and your spam folder).',
    });
  } catch (err) {
    logger.error('Resend verification error', { req, err });
    res.render('auth/verify-email-pending', {
      email: req.session.user.email,
      verifyLink: null,
      error: 'We could not resend the verification email just now. Please try again in a moment.',
      info: null,
    });
  }
};

const verifyEmail = (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.render('auth/verify-email-pending', {
      email: req.session.user ? req.session.user.email : null,
      verifyLink: null,
      error: 'No verification token provided. Use the "Resend Verification Email" button below.',
      info: null,
    });
  }

  try {
    const db = getDB();
    const tokenHash = hashToken(token);
    const verification = db
      .prepare(`SELECT * FROM email_verifications WHERE token = ?`)
      .get(tokenHash);

    if (!verification || verification.expires_at < Date.now()) {
      return res.render('auth/verify-email-pending', {
        email: req.session.user ? req.session.user.email : null,
        verifyLink: null,
        error:
          'This verification link has expired or has already been used. Request a new one below.',
        info: null,
      });
    }

    db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).run(verification.user_id);
    db.prepare(`DELETE FROM email_verifications WHERE token = ?`).run(tokenHash);

    // No re-login required if the verifying browser is already the account's
    // own session.
    if (req.session.user && req.session.user.id === verification.user_id) {
      req.session.user.email_verified = true;
    }

    const user = db.prepare(`SELECT role FROM users WHERE id = ?`).get(verification.user_id);
    res.redirect(dashboardFor(user.role) + '?success=verified');
  } catch (err) {
    logger.error('Verify email error', { req, err });
    res.render('auth/verify-email-pending', {
      email: req.session.user ? req.session.user.email : null,
      verifyLink: null,
      error: 'We could not verify your email just now. Please try again in a moment.',
      info: null,
    });
  }
};

module.exports = {
  showHome,
  showRegister,
  showLogin,
  register,
  login,
  logout,
  showForgotPassword,
  forgotPassword,
  showVerifyPending,
  resendVerification,
  verifyEmail,
  showResetPassword,
  resetPassword,
};
