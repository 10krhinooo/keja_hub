const crypto = require('crypto');

const csrfProtection = (req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const contentType = req.headers['content-type'] || '';
    // Multipart forms are parsed by multer inside route handlers, so those routes
    // use csrfVerify (below) after multer, so skip the check here.
    if (contentType.startsWith('multipart/form-data')) return next();

    const token = req.body._csrf || req.headers['x-csrf-token'];
    if (!token || token !== req.session.csrfToken) {
      return res.status(403).send('Invalid or missing CSRF token.');
    }
  }
  next();
};

// Use this middleware in routes that use multer (after upload middleware).
const csrfVerify = (req, res, next) => {
  const token = req.body._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).send('Invalid or missing CSRF token.');
  }
  next();
};

module.exports = { csrfProtection, csrfVerify };
