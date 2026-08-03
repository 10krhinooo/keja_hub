// Never build a link from the Host header: an attacker who sets
// Host: evil.com would receive a working link (password reset, email
// verification, booking notification) meant for someone else's account.
// APP_URL is mandatory in production (enforced at startup in app.js).
function buildBaseUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

module.exports = { buildBaseUrl };
