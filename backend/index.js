const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const express = require('express');
const session = require('express-session');
const { initDB } = require('./database');
const noCache = require('./middleware/noCache');
const csrfProtection = require('./middleware/csrf');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../frontend/views'));
app.use(express.static(path.join(__dirname, '../frontend/public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || (() => { throw new Error('SESSION_SECRET must be set'); })(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.use(csrfProtection);

app.use('/', require('./routes/authRoutes'));
app.use('/student',  noCache, require('./routes/studentRoutes'));
app.use('/landlord', noCache, require('./routes/landlordRoutes'));
app.use('/admin',    noCache, require('./routes/adminRoutes'));

app.get('/', (req, res) => res.redirect('/home'));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong. Please try again.');
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`KejaHub running on http://localhost:${PORT}`);
  });
}).catch(console.error);
