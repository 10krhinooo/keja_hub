const { getDB } = require('../database');

const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  const db = getDB();
  const row = db.prepare(`SELECT is_active FROM users WHERE id = ?`).get(req.session.user.id);
  if (!row || !row.is_active) return req.session.destroy(() => res.redirect('/login'));
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
