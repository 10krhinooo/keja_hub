 const bcrypt = require('bcryptjs');
const { getDB, saveDB } = require('../database');

const showHome = (req, res) => {
  res.render('home');
};

const showRegister = (req, res) => {
  res.render('auth/register', { error: null });
};

const showLogin = (req, res) => {
  res.render('auth/login', { error: null });
};

const register = async (req, res) => {
  try {
    const { name, email, password, confirm_password, role } = req.body;

    if (!name || !email || !password || !role)
      return res.render('auth/register', { error: 'All fields are required' });

    if (password !== confirm_password)
      return res.render('auth/register', { error: 'Passwords do not match' });

    if (!['student', 'landlord'].includes(role))
      return res.render('auth/register', { error: 'Invalid role selected' });

    const db = getDB();
    const existing = db.exec(`SELECT id FROM users WHERE email='${email}'`);
    if (existing.length > 0)
      return res.render('auth/register', { error: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
      [name, email, hashed, role]
    );

    const newUser = db.exec(`SELECT * FROM users WHERE email='${email}'`);
    const cols = newUser[0].columns;
    const vals = newUser[0].values[0];
    const user = Object.fromEntries(cols.map((c, i) => [c, vals[i]]));

   if (role === 'student') {
  db.run(`INSERT INTO student_profiles (user_id, phone) VALUES (?, ?)`, [user.id, req.body.phone || '']);
} else if (role === 'landlord') {
  db.run(`INSERT INTO landlord_profiles (user_id, phone) VALUES (?, ?)`, [user.id, req.body.phone || '']);
}

    saveDB();

    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    res.redirect(role === 'student' ? '/student/dashboard' : '/landlord/dashboard');

  } catch (err) {
    res.render('auth/register', { error: err.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.render('auth/login', { error: 'All fields are required' });

    const db = getDB();
    const result = db.exec(`SELECT * FROM users WHERE email='${email}'`);

    if (result.length === 0)
      return res.render('auth/login', { error: 'Invalid email or password' });

    const cols = result[0].columns;
    const vals = result[0].values[0];
    const user = Object.fromEntries(cols.map((c, i) => [c, vals[i]]));

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.render('auth/login', { error: 'Invalid email or password' });

    if (!user.is_active)
      return res.render('auth/login', { error: 'Your account has been deactivated' });

    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };

    if (user.role === 'admin') return res.redirect('/admin/dashboard');
    if (user.role === 'landlord') return res.redirect('/landlord/dashboard');
    res.redirect('/student/dashboard');

  } catch (err) {
    res.render('auth/login', { error: err.message });
  }
};

const logout = (req, res) => {
  req.session.destroy();
  res.redirect('/login');
};

module.exports = { showHome, showRegister, showLogin, register, login, logout };
