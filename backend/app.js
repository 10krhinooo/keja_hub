const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const noCache = require('./middleware/noCache');
const { csrfProtection } = require('./middleware/csrf');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Behind a reverse proxy (nginx, Render, Heroku) Express sees plain HTTP and
// would refuse to set a `secure` cookie, which locks everyone out of login.
if (isProduction) app.set('trust proxy', 1);

// Password reset links must be built from a trusted, configured origin rather
// than the request Host header, which an attacker controls. Fail fast instead
// of shipping a deployment that can leak reset tokens to another domain.
if (isProduction) {
  if (!process.env.APP_URL) {
    throw new Error('APP_URL must be set in production (used to build password reset links)');
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error(
      'SMTP_USER and SMTP_PASS must be set in production (password reset depends on email)'
    );
  }
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../frontend/views'));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // The views carry inline <script>/<style> blocks and Google Fonts.
        scriptSrc: ["'self'", "'unsafe-inline'"],
        // 31 inline onclick/onsubmit handlers remain across the views. Blocking
        // them (helmet's default) would break password toggles and delete
        // confirmations. Move them to addEventListener, then drop this line.
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    // Uploaded images are served from the same origin and embedded in pages.
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: isProduction ? undefined : false,
  })
);

app.use(express.static(path.join(__dirname, '../frontend/public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    // The default MemoryStore leaks sessions and drops every login on restart.
    // Tests are the one case where that does not matter and writing session files
    // to disk would leave litter behind, so they fall back to the in-memory store.
    store: isTest
      ? undefined
      : new FileStore({
          path: path.join(__dirname, '../.sessions'),
          ttl: 60 * 60 * 24 * 7,
          retries: 1,
          logFn: () => {},
        }),
    secret:
      process.env.SESSION_SECRET ||
      (() => {
        throw new Error('SESSION_SECRET must be set');
      })(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7,
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
    },
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// bcrypt is deliberately expensive, so unthrottled auth POSTs are both a
// credential-stuffing surface and a cheap way to peg the CPU. This runs before
// csrfProtection so a flood of bogus-token requests is throttled too.
//
// The limiter is disabled under NODE_ENV=test: a suite that exercises login
// failures, registration validation and password reset will blow through 20
// requests and start getting 429s that have nothing to do with the assertions.
// The limiter itself is covered by a dedicated test that builds its own app.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: 'Too many attempts. Please wait a few minutes before trying again.',
});
if (!isTest) {
  app.use(['/login', '/register', '/forgot-password', '/reset-password'], (req, res, next) =>
    req.method === 'POST' ? authLimiter(req, res, next) : next()
  );
}

app.use(csrfProtection);

app.get('/healthz', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.use('/', require('./routes/authRoutes'));
app.use('/student', noCache, require('./routes/studentRoutes'));
app.use('/landlord', noCache, require('./routes/landlordRoutes'));
app.use('/admin', noCache, require('./routes/adminRoutes'));

app.get('/', (req, res) => res.redirect('/home'));

app.use((req, res) => {
  res.status(404).render('404', { url: req.originalUrl });
});

// Express identifies error middleware by arity, so the fourth argument has to
// stay even though nothing calls it.
app.use((err, req, res, _next) => {
  if (process.env.NODE_ENV !== 'test') console.error(err.stack);

  // Multer rejects oversized or wrong-type files by throwing. Without this the
  // landlord gets a bare 500 and loses everything they typed.
  if (err instanceof multer.MulterError || err.message === 'Only image files are allowed') {
    // Going past the .array('images', 10) cap raises LIMIT_UNEXPECTED_FILE on
    // the eleventh file, not LIMIT_FILE_COUNT. Both mean the same thing to a
    // landlord, and 'images' is the only file field anywhere in the app, so an
    // unexpected field name is not a case worth a separate message.
    const key =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'file_too_large'
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'too_many_photos'
          : 'upload_type_error';
    const back = req.get('Referer') || '/landlord/dashboard';
    return res.redirect(back + (back.includes('?') ? '&' : '?') + 'error=' + key);
  }

  res.status(500).send('Something went wrong. Please try again.');
});

module.exports = app;
