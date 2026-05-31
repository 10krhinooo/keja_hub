 const { getDB, saveDB } = require('../database');

const dashboard = (req, res) => {
  const db = getDB();
  const result = db.exec(`
    SELECT h.*,
      (SELECT image_path FROM house_images WHERE house_id=h.id AND is_primary=1 LIMIT 1) as primary_image,
      (SELECT AVG(rating) FROM reviews WHERE house_id=h.id) as avg_rating,
      (SELECT COUNT(*) FROM reviews WHERE house_id=h.id) as review_count
    FROM houses h
    WHERE h.status='approved' AND h.is_available=1
    ORDER BY h.created_at DESC
    LIMIT 6
  `);
  const houses = result.length === 0 ? [] : result[0].values.map(function(row) {
    return Object.fromEntries(result[0].columns.map(function(c, i) { return [c, row[i]]; }));
  });
  res.render('student/dashboard', { houses });
};

const searchHouses = (req, res) => {
  const { keyword, location, min_rent, max_rent, bedrooms } = req.query;
  const db = getDB();

  let query = `
    SELECT h.*,
      (SELECT image_path FROM house_images WHERE house_id=h.id AND is_primary=1 LIMIT 1) as primary_image,
      (SELECT AVG(rating) FROM reviews WHERE house_id=h.id) as avg_rating,
      (SELECT COUNT(*) FROM reviews WHERE house_id=h.id) as review_count
    FROM houses h
    WHERE h.status='approved' AND h.is_available=1
  `;

  if (keyword) query += ` AND (h.title LIKE '%${keyword}%' OR h.description LIKE '%${keyword}%' OR h.location LIKE '%${keyword}%')`;
  if (location) query += ` AND h.location LIKE '%${location}%'`;
  if (min_rent) query += ` AND h.rent >= ${min_rent}`;
  if (max_rent) query += ` AND h.rent <= ${max_rent}`;
  if (bedrooms) query += ` AND h.bedrooms = ${bedrooms}`;

  query += ` ORDER BY h.created_at DESC`;

  const result = db.exec(query);
  const houses = result.length === 0 ? [] : result[0].values.map(function(row) {
    return Object.fromEntries(result[0].columns.map(function(c, i) { return [c, row[i]]; }));
  });

  res.render('student/search', { houses, filters: req.query });
};

const viewHouse = (req, res) => {
  const db = getDB();

  const houseResult = db.exec(`SELECT * FROM houses WHERE id=${req.params.id} AND status='approved'`);
  if (houseResult.length === 0) return res.redirect('/student/search');
  const house = Object.fromEntries(houseResult[0].columns.map(function(c, i) { return [c, houseResult[0].values[0][i]]; }));

  const imgResult = db.exec(`SELECT * FROM house_images WHERE house_id=${req.params.id}`);
  const images = imgResult.length === 0 ? [] : imgResult[0].values.map(function(row) {
    return Object.fromEntries(imgResult[0].columns.map(function(c, i) { return [c, row[i]]; }));
  });

  const amenResult = db.exec(`SELECT * FROM amenities WHERE house_id=${req.params.id}`);
  const amenities = amenResult.length === 0 ? [] : amenResult[0].values.map(function(row) {
    return Object.fromEntries(amenResult[0].columns.map(function(c, i) { return [c, row[i]]; }));
  });

  const reviewResult = db.exec(`
    SELECT r.*, u.name as student_name
    FROM reviews r JOIN users u ON r.student_id = u.id
    WHERE r.house_id=${req.params.id}
    ORDER BY r.created_at DESC
  `);
  const reviews = reviewResult.length === 0 ? [] : reviewResult[0].values.map(function(row) {
    return Object.fromEntries(reviewResult[0].columns.map(function(c, i) { return [c, row[i]]; }));
  });

  const avgResult = db.exec(`SELECT AVG(rating) as avg FROM reviews WHERE house_id=${req.params.id}`);
  const avgRating = avgResult[0].values[0][0] ? Number(avgResult[0].values[0][0]).toFixed(1) : null;

  const landlordResult = db.exec(`
    SELECT u.name, u.email, lp.phone
    FROM users u
    LEFT JOIN landlord_profiles lp ON u.id = lp.user_id
    WHERE u.id=${house.landlord_id}
  `);
  const landlord = landlordResult.length === 0 ? {} : Object.fromEntries(
    landlordResult[0].columns.map(function(c, i) { return [c, landlordResult[0].values[0][i]]; })
  );

  res.render('student/house-detail', { house, images, amenities, reviews, avgRating, landlord });
};

const sendBooking = (req, res) => {
  const { house_id, type, message, visit_date } = req.body;
  const db = getDB();

  const existing = db.exec(`
    SELECT id FROM bookings
    WHERE house_id=${house_id} AND student_id=${req.session.user.id} AND status='pending'
  `);
  if (existing.length > 0) return res.redirect(`/student/house/${house_id}?error=already_requested`);

  db.run(
    `INSERT INTO bookings (house_id, student_id, type, message, visit_date) VALUES (?, ?, ?, ?, ?)`,
    [house_id, req.session.user.id, type || 'viewing', message, visit_date]
  );
  saveDB();
  res.redirect(`/student/house/${house_id}?success=requested`);
};

const myBookings = (req, res) => {
  const db = getDB();
  const result = db.exec(`
    SELECT b.*, h.title as house_title, h.location, h.rent,
      (SELECT image_path FROM house_images WHERE house_id=h.id AND is_primary=1 LIMIT 1) as primary_image
    FROM bookings b JOIN houses h ON b.house_id = h.id
    WHERE b.student_id=${req.session.user.id}
    ORDER BY b.created_at DESC
  `);
  const bookings = result.length === 0 ? [] : result[0].values.map(function(row) {
    return Object.fromEntries(result[0].columns.map(function(c, i) { return [c, row[i]]; }));
  });
  res.render('student/bookings', { bookings });
};

const addReview = (req, res) => {
  const { house_id, rating, comment } = req.body;
  const db = getDB();

  const existing = db.exec(`SELECT id FROM reviews WHERE house_id=${house_id} AND student_id=${req.session.user.id}`);
  if (existing.length > 0) return res.redirect(`/student/house/${house_id}?error=already_reviewed`);

  db.run(
    `INSERT INTO reviews (house_id, student_id, rating, comment) VALUES (?, ?, ?, ?)`,
    [house_id, req.session.user.id, rating, comment]
  );
  saveDB();
  res.redirect(`/student/house/${house_id}?success=reviewed`);
};

const reportHouse = (req, res) => {
  const { house_id, reason } = req.body;
  const db = getDB();
  db.run(
    `INSERT INTO reports (house_id, reported_by, reason) VALUES (?, ?, ?)`,
    [house_id, req.session.user.id, reason]
  );
  saveDB();
  res.redirect(`/student/house/${house_id}?success=reported`);
};

module.exports = { dashboard, searchHouses, viewHouse, sendBooking, myBookings, addReview, reportHouse };
