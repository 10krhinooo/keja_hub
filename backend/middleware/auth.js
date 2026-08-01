const { getDB } = require('../database');

const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  const db = getDB();
  const stmt = db.prepare(`SELECT is_active FROM users WHERE id = ?`);
  stmt.bind([req.session.user.id]);
  const active = stmt.step() ? stmt.getAsObject().is_active : 0;
  stmt.free();
  if (!active) return req.session.destroy(() => res.redirect('/login'));
  next();
};

const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (!roles.includes(req.session.user.role)) return res.redirect('/login');
    requireLogin(req, res, next);
  };

module.exports = { requireLogin, requireRole };
