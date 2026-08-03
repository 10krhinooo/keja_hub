const crypto = require('crypto');

// Test output would otherwise be drowned in log lines that have nothing to do
// with what a failing assertion is about. Mirrors the isQuiet() gate
// database.js already used for its own startup/seed logging.
function isQuiet() {
  return process.env.NODE_ENV === 'test';
}

// One id per request, attached before anything else runs, so every log line
// from a single request can be correlated after the fact.
function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  next();
}

// Pure and side-effect-free on purpose: this is the part worth unit testing
// directly, separately from whether the quiet gate suppresses output.
function format(level, message, { req, err, ...meta } = {}) {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(req && req.id ? { requestId: req.id } : {}),
    ...meta,
  };
  if (err) entry.err = { message: err.message, stack: err.stack };
  return entry;
}

function write(level, message, opts) {
  if (isQuiet()) return;

  const line = JSON.stringify(format(level, message, opts));
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  requestId,
  format,
  info: (message, opts) => write('info', message, opts),
  warn: (message, opts) => write('warn', message, opts),
  error: (message, opts) => write('error', message, opts),
};
