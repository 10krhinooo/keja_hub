const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDB, saveDB, getDistinctLocations } = require('../database');

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
    const { name, email, password, confirm_password, role } = req.body;

    if (!name || !email || !password || !role)
      return res.render('auth/register', { error: 'All fields are required', values });

    if (password.length < 8)
      return res.render('auth/register', { error: 'Password must be at least 8 characters', values });

    if (password !== confirm_password)
      return res.render('auth/register', { error: 'Passwords do not match', values });

    if (!['student', 'landlord'].includes(role))
      return res.render('auth/register', { error: 'Invalid role selected', values });

    const db = getDB();

    const checkStmt = db.prepare(`SELECT id FROM users WHERE email = ?`);
    checkStmt.bind([email]);
    const exists = checkStmt.step();
    checkStmt.free();
    if (exists) return res.render('auth/register', { error: 'Email already registered', values });

    const hashed = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
      [name, email, hashed, role]
    );

    const userStmt = db.prepare(`SELECT * FROM users WHERE email = ?`);
    userStmt.bind([email]);
    userStmt.step();
    const user = userStmt.getAsObject();
    userStmt.free();

    if (role === 'student') {
      db.run(`INSERT INTO student_profiles (user_id, phone) VALUES (?, ?)`, [user.id, req.body.phone || '']);
    } else if (role === 'landlord') {
      db.run(`INSERT INTO landlord_profiles (user_id, phone) VALUES (?, ?)`, [user.id, req.body.phone || '']);
    }

    saveDB();

    req.session.regenerate((err) => {
      try {
        if (err) throw err;
        req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
        const dest = role === 'student' ? '/student/dashboard' : '/landlord/dashboard';
        res.redirect(dest + '?success=registered');
      } catch (cbErr) {
        console.error('Register session error:', cbErr);
        res.render('auth/register', { error: 'Session error, please retry', values });
      }
    });

  } catch (err) {
    res.render('auth/register', { error: err.message, values });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.render('auth/login', { error: 'All fields are required' });

    const db = getDB();

    const stmt = db.prepare(`SELECT * FROM users WHERE email = ?`);
    stmt.bind([email]);
    const found = stmt.step();
    const user = found ? stmt.getAsObject() : null;
    stmt.free();

    if (!user)
      return res.render('auth/login', { error: 'Invalid email or password' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.render('auth/login', { error: 'Invalid email or password' });

    if (!user.is_active)
      return res.render('auth/login', { error: 'Your account has been deactivated' });

    req.session.regenerate((err) => {
      try {
        if (err) throw err;
        req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
        if (user.role === 'admin') return res.redirect('/admin/dashboard?success=welcome');
        if (user.role === 'landlord') return res.redirect('/landlord/dashboard?success=welcome');
        res.redirect('/student/dashboard?success=welcome');
      } catch (cbErr) {
        console.error('Login session error:', cbErr);
        res.status(500).send('Something went wrong. Please try again.');
      }
    });

  } catch (err) {
    res.render('auth/login', { error: err.message });
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

const forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) {
    return res.render('auth/forgot-password', {
      error: 'Email address is required', resetLink: null, info: null
    });
  }

  try {
    const db = getDB();
    const stmt = db.prepare(`SELECT id FROM users WHERE email = ?`);
    stmt.bind([email.trim()]);
    const found = stmt.step();
    const user = found ? stmt.getAsObject() : null;
    stmt.free();

    if (!user) {
      return res.render('auth/forgot-password', {
        error: null, resetLink: null,
        info: 'If that email is registered, a reset link has been generated.'
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + 3600000; // 1 hour

    db.run(`DELETE FROM password_resets WHERE user_id = ?`, [user.id]);
    db.run(
      `INSERT INTO password_resets (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`,
      [id, user.id, token, expiresAt]
    );
    saveDB();

    // In production wire up email delivery; in dev surface the link in the console and UI
    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction) console.log(`[DEV] Password reset link: /reset-password?token=${token}`);
    const resetLink = isProduction ? null : `/reset-password?token=${token}`;
    const info = isProduction ? 'If that email is registered, a reset link has been sent to your inbox.' : null;
    res.render('auth/forgot-password', { error: null, resetLink, info });
  } catch (err) {
    res.render('auth/forgot-password', { error: err.message, resetLink: null, info: null });
  }
};

const showResetPassword = (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.render('auth/reset-password', {
      error: 'No reset token provided.', valid: false, token: ''
    });
  }

  const db = getDB();
  const stmt = db.prepare(`SELECT * FROM password_resets WHERE token = ?`);
  stmt.bind([token]);
  const found = stmt.step();
  const reset = found ? stmt.getAsObject() : null;
  stmt.free();

  if (!reset || reset.expires_at < Date.now()) {
    return res.render('auth/reset-password', {
      error: 'This reset link has expired or is invalid.', valid: false, token: ''
    });
  }

  res.render('auth/reset-password', { error: null, valid: true, token });
};

const resetPassword = async (req, res) => {
  const { token, new_password, confirm_password } = req.body;
  if (!token) return res.redirect('/forgot-password');

  try {
    const db = getDB();
    const stmt = db.prepare(`SELECT * FROM password_resets WHERE token = ?`);
    stmt.bind([token]);
    const found = stmt.step();
    const reset = found ? stmt.getAsObject() : null;
    stmt.free();

    if (!reset || reset.expires_at < Date.now()) {
      return res.render('auth/reset-password', {
        error: 'This reset link has expired or is invalid.', valid: false, token: ''
      });
    }

    if (!new_password || new_password.length < 8) {
      return res.render('auth/reset-password', {
        error: 'Password must be at least 8 characters.', valid: true, token
      });
    }

    if (new_password !== confirm_password) {
      return res.render('auth/reset-password', {
        error: 'Passwords do not match.', valid: true, token
      });
    }

    const hashed = await bcrypt.hash(new_password, 10);
    db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashed, reset.user_id]);
    db.run(`DELETE FROM password_resets WHERE token = ?`, [token]);
    saveDB();

    res.redirect('/login?success=password_reset');
  } catch (err) {
    res.render('auth/reset-password', { error: err.message, valid: true, token });
  }
};

module.exports = {
  showHome, showRegister, showLogin, register, login, logout,
  showForgotPassword, forgotPassword, showResetPassword, resetPassword
};
