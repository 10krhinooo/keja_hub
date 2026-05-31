 const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (!roles.includes(req.session.user.role)) return res.redirect('/login');
  next();
};

module.exports = { requireLogin, requireRole };
