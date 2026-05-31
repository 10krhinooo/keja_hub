require('dotenv').config({ path: '../.env' });
const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDB } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../frontend/views'));
app.use(express.static(path.join(__dirname, '../frontend/public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'kejahub_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.use('/', require('./routes/authRoutes'));
app.use('/student', require('./routes/studentRoutes'));
app.use('/landlord', require('./routes/landlordRoutes'));
app.use('/admin', require('./routes/adminRoutes'));

app.get('/', (req, res) => res.redirect('/home'));

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`KejaHub running on http://localhost:${PORT}`);
  });
}).catch(console.error);