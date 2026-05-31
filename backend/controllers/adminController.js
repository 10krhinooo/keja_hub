 const { getDB, saveDB } = require('../database');

const dashboard = (req, res) => {
  const db = getDB();

  const usersResult = db.exec(`SELECT COUNT(*) as count FROM users WHERE role != 'admin'`);
  const housesResult = db.exec(`SELECT COUNT(*) as count FROM houses`);
  const pendingResult = db.exec(`SELECT COUNT(*) as count FROM houses WHERE status='pending'`);
  const bookingsResult = db.exec(`SELECT COUNT(*) as count FROM bookings`);

  const stats = {
    users: usersResult[0].values[0][0],
    houses: housesResult[0].values[0][0],
    pending: pendingResult[0].values[0][0],
    bookings: bookingsResult[0].values[0][0]
  };

  const listingsResult = db.exec(`
    SELECT h.*, u.name as landlord_name, u.email as landlord_email
    FROM houses h JOIN users u ON h.landlord_id = u.id
    ORDER BY h.created_at DESC
  `);
  const listings = listingsResult.length === 0 ? [] : listingsResult[0].values.map(function(row) {
    return Object.fromEntries(listingsResult[0].columns.map(function(c, i) { return [c, row[i]]; }));
  });

  res.render('admin/dashboard', { stats, listings });
};

const approveHouse = (req, res) => {
  const db = getDB();
  db.run(`UPDATE houses SET status='approved' WHERE id=?`, [req.params.id]);
  saveDB();
  res.redirect('/admin/dashboard');
};

const rejectHouse = (req, res) => {
  const db = getDB();
  db.run(`UPDATE houses SET status='rejected' WHERE id=?`, [req.params.id]);
  saveDB();
  res.redirect('/admin/dashboard');
};

const manageUsers = (req, res) => {
  const db = getDB();
  const result = db.exec(`SELECT * FROM users WHERE role != 'admin' ORDER BY created_at DESC`);
  const users = result.length === 0 ? [] : result[0].values.map(function(row) {
    return Object.fromEntries(result[0].columns.map(function(c, i) { return [c, row[i]]; }));
  });
  res.render('admin/users', { users });
};

const toggleUser = (req, res) => {
  const db = getDB();
  const result = db.exec(`SELECT is_active FROM users WHERE id=${req.params.id}`);
  const current = result[0].values[0][0];
  db.run(`UPDATE users SET is_active=? WHERE id=?`, [current ? 0 : 1, req.params.id]);
  saveDB();
  res.redirect('/admin/users');
};

const manageReports = (req, res) => {
  const db = getDB();
  const result = db.exec(`
    SELECT r.*, h.title as house_title, u.name as reported_by_name
    FROM reports r
    JOIN houses h ON r.house_id = h.id
    JOIN users u ON r.reported_by = u.id
    ORDER BY r.created_at DESC
  `);
  const reports = result.length === 0 ? [] : result[0].values.map(function(row) {
    return Object.fromEntries(result[0].columns.map(function(c, i) { return [c, row[i]]; }));
  });
  res.render('admin/reports', { reports });
};

const resolveReport = (req, res) => {
  const db = getDB();
  db.run(`UPDATE reports SET status='resolved' WHERE id=?`, [req.params.id]);
  saveDB();
  res.redirect('/admin/reports');
};

module.exports = { dashboard, approveHouse, rejectHouse, manageUsers, toggleUser, manageReports, resolveReport };
