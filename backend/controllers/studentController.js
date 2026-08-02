const bcrypt = require('bcryptjs');
const { getDB, saveDB, rowsToObjects, getDistinctLocations } = require('../database');

const dashboard = (req, res) => {
  try {
    const db = getDB();
    const result = db.exec(`
      SELECT h.*,
        (SELECT image_path FROM house_images WHERE house_id=h.id
           ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1) as primary_image,
        (SELECT AVG(rating) FROM reviews WHERE house_id=h.id) as avg_rating,
        (SELECT COUNT(*) FROM reviews WHERE house_id=h.id) as review_count
      FROM houses h
      WHERE h.status='approved' AND h.is_available=1
      ORDER BY h.created_at DESC
      LIMIT 6
    `);
    const houses = rowsToObjects(result);
    res.render('student/dashboard', { houses, query: req.query });
  } catch (err) {
    console.error('Student dashboard error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const SEARCH_PER_PAGE = 12;
const SORT_MAP = {
  price_asc: 'h.rent ASC',
  price_desc: 'h.rent DESC',
  rating_desc: 'avg_rating DESC',
  newest: 'h.created_at DESC',
};

const searchHouses = (req, res) => {
  try {
    const { keyword, min_rent, max_rent, bedrooms, bathrooms, sort, location } = req.query;
    const amenities = req.query.amenities
      ? Array.isArray(req.query.amenities)
        ? req.query.amenities
        : [req.query.amenities]
      : [];
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const db = getDB();

    const conditions = [`h.status='approved'`, `h.is_available=1`];
    const params = [];

    if (keyword) {
      conditions.push(
        `(h.title LIKE ? OR h.description LIKE ? OR h.location LIKE ? OR h.estate LIKE ?)`
      );
      const kw = `%${keyword}%`;
      params.push(kw, kw, kw, kw);
    }
    if (location) {
      conditions.push(`h.location = ?`);
      params.push(location);
    }
    if (min_rent) {
      const n = parseFloat(min_rent);
      if (!isNaN(n)) {
        conditions.push(`h.rent >= ?`);
        params.push(n);
      }
    }
    if (max_rent) {
      const n = parseFloat(max_rent);
      if (!isNaN(n)) {
        conditions.push(`h.rent <= ?`);
        params.push(n);
      }
    }
    if (bedrooms) {
      const n = parseInt(bedrooms, 10);
      if (!isNaN(n)) {
        if (n >= 4) {
          conditions.push(`h.bedrooms >= ?`);
          params.push(4);
        } else {
          conditions.push(`h.bedrooms = ?`);
          params.push(n);
        }
      }
    }
    if (bathrooms) {
      const n = parseInt(bathrooms, 10);
      if (!isNaN(n)) {
        if (n >= 3) {
          conditions.push(`h.bathrooms >= ?`);
          params.push(3);
        } else {
          conditions.push(`h.bathrooms = ?`);
          params.push(n);
        }
      }
    }
    for (const am of amenities) {
      conditions.push(`EXISTS (SELECT 1 FROM amenities a WHERE a.house_id=h.id AND a.name=?)`);
      params.push(am);
    }

    const orderBy = SORT_MAP[sort] || SORT_MAP.newest;
    const whereClause = conditions.join(' AND ');

    const countStmt = db.prepare(`SELECT COUNT(*) FROM houses h WHERE ${whereClause}`);
    if (params.length) countStmt.bind(params);
    countStmt.step();
    const totalCount = countStmt.getAsObject()['COUNT(*)'] || 0;
    countStmt.free();

    const totalPages = Math.max(1, Math.ceil(totalCount / SEARCH_PER_PAGE));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * SEARCH_PER_PAGE;

    const stmt = db.prepare(`
      SELECT h.*,
        (SELECT image_path FROM house_images WHERE house_id=h.id
           ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1) as primary_image,
        ROUND((SELECT AVG(rating) FROM reviews WHERE house_id=h.id), 1) as avg_rating,
        (SELECT COUNT(*) FROM reviews WHERE house_id=h.id) as review_count
      FROM houses h
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `);
    stmt.bind([...params, SEARCH_PER_PAGE, offset]);
    const houses = [];
    while (stmt.step()) houses.push(stmt.getAsObject());
    stmt.free();

    const locations = getDistinctLocations();

    res.render('student/search', {
      houses,
      filters: req.query,
      page: safePage,
      totalPages,
      totalCount,
      sort: sort || 'newest',
      amenities,
      locations,
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const viewHouse = (req, res) => {
  try {
    const houseId = parseInt(req.params.id, 10);
    if (isNaN(houseId)) return res.redirect('/student/search');

    const db = getDB();

    const houseStmt = db.prepare(`SELECT * FROM houses WHERE id = ? AND status = 'approved'`);
    houseStmt.bind([houseId]);
    const house = houseStmt.step() ? houseStmt.getAsObject() : null;
    houseStmt.free();
    if (!house) return res.redirect('/student/search');

    const imgStmt = db.prepare(
      `SELECT * FROM house_images WHERE house_id = ? ORDER BY is_primary DESC, sort_order ASC, id ASC`
    );
    imgStmt.bind([houseId]);
    const images = [];
    while (imgStmt.step()) images.push(imgStmt.getAsObject());
    imgStmt.free();

    const amenStmt = db.prepare(`SELECT * FROM amenities WHERE house_id = ?`);
    amenStmt.bind([houseId]);
    const amenities = [];
    while (amenStmt.step()) amenities.push(amenStmt.getAsObject());
    amenStmt.free();

    const reviewStmt = db.prepare(`
      SELECT r.*, u.name as student_name
      FROM reviews r JOIN users u ON r.student_id = u.id
      WHERE r.house_id = ?
      ORDER BY r.created_at DESC
    `);
    reviewStmt.bind([houseId]);
    const reviews = [];
    while (reviewStmt.step()) reviews.push(reviewStmt.getAsObject());
    reviewStmt.free();

    const avgStmt = db.prepare(`SELECT AVG(rating) as avg FROM reviews WHERE house_id = ?`);
    avgStmt.bind([houseId]);
    avgStmt.step();
    const avgRaw = avgStmt.getAsObject().avg;
    avgStmt.free();
    const avgRating = avgRaw ? Number(avgRaw).toFixed(1) : null;

    const landlordStmt = db.prepare(`
      SELECT u.name, lp.phone
      FROM users u
      LEFT JOIN landlord_profiles lp ON u.id = lp.user_id
      WHERE u.id = ?
    `);
    landlordStmt.bind([house.landlord_id]);
    const landlord = landlordStmt.step() ? landlordStmt.getAsObject() : {};
    landlordStmt.free();

    const bookingStmt = db.prepare(`
      SELECT * FROM bookings WHERE house_id = ? AND student_id = ? ORDER BY created_at DESC LIMIT 1
    `);
    bookingStmt.bind([houseId, req.session.user.id]);
    const existingBooking = bookingStmt.step() ? bookingStmt.getAsObject() : null;
    bookingStmt.free();

    const reviewCheckStmt = db.prepare(`
      SELECT * FROM reviews WHERE house_id = ? AND student_id = ? LIMIT 1
    `);
    reviewCheckStmt.bind([houseId, req.session.user.id]);
    const existingReview = reviewCheckStmt.step() ? reviewCheckStmt.getAsObject() : null;
    reviewCheckStmt.free();

    res.render('student/house-detail', {
      house,
      images,
      amenities,
      reviews,
      avgRating,
      landlord,
      existingBooking,
      existingReview,
      query: req.query,
    });
  } catch (err) {
    console.error('View house error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const sendBooking = (req, res) => {
  try {
    const { house_id, type, message, visit_date } = req.body;
    const houseId = parseInt(house_id, 10);
    if (isNaN(houseId)) return res.redirect('/student/dashboard');

    const db = getDB();

    const houseStmt = db.prepare(
      `SELECT id FROM houses WHERE id = ? AND status = 'approved' AND is_available = 1`
    );
    houseStmt.bind([houseId]);
    const houseExists = houseStmt.step();
    houseStmt.free();
    if (!houseExists) return res.redirect('/student/dashboard');

    const existStmt = db.prepare(`
      SELECT id FROM bookings WHERE house_id = ? AND student_id = ? AND status = 'pending'
    `);
    existStmt.bind([houseId, req.session.user.id]);
    const alreadyPending = existStmt.step();
    existStmt.free();
    if (alreadyPending) return res.redirect(`/student/house/${houseId}?error=already_requested`);

    const bookingType = ['viewing', 'booking'].includes(type) ? type : 'viewing';
    db.run(
      `INSERT INTO bookings (house_id, student_id, type, message, visit_date) VALUES (?, ?, ?, ?, ?)`,
      [houseId, req.session.user.id, bookingType, message || null, visit_date || null]
    );
    saveDB();
    res.redirect(`/student/house/${houseId}?success=booking_sent`);
  } catch (err) {
    console.error('Send booking error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const myBookings = (req, res) => {
  try {
    const db = getDB();
    const stmt = db.prepare(`
      SELECT b.*, h.title as house_title, h.location, h.rent,
        (SELECT image_path FROM house_images WHERE house_id=h.id
           ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1) as primary_image
      FROM bookings b JOIN houses h ON b.house_id = h.id
      WHERE b.student_id = ?
      ORDER BY b.created_at DESC
    `);
    stmt.bind([req.session.user.id]);
    const bookings = [];
    while (stmt.step()) bookings.push(stmt.getAsObject());
    stmt.free();
    res.render('student/bookings', { bookings });
  } catch (err) {
    console.error('My bookings error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const addReview = (req, res) => {
  try {
    const { house_id, rating, comment } = req.body;
    const houseId = parseInt(house_id, 10);
    const ratingNum = parseInt(rating, 10);
    if (isNaN(houseId)) return res.redirect('/student/dashboard');
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5)
      return res.redirect(`/student/house/${houseId}?error=invalid_rating`);

    const db = getDB();

    const houseStmt = db.prepare(`SELECT id FROM houses WHERE id = ? AND status = 'approved'`);
    houseStmt.bind([houseId]);
    const houseExists = houseStmt.step();
    houseStmt.free();
    if (!houseExists) return res.redirect('/student/dashboard');

    const existStmt = db.prepare(`SELECT id FROM reviews WHERE house_id = ? AND student_id = ?`);
    existStmt.bind([houseId, req.session.user.id]);
    const alreadyReviewed = existStmt.step();
    existStmt.free();
    if (alreadyReviewed) return res.redirect(`/student/house/${houseId}?error=already_reviewed`);

    db.run(`INSERT INTO reviews (house_id, student_id, rating, comment) VALUES (?, ?, ?, ?)`, [
      houseId,
      req.session.user.id,
      ratingNum,
      comment || null,
    ]);
    saveDB();
    res.redirect(`/student/house/${houseId}?success=review_posted`);
  } catch (err) {
    console.error('Add review error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const reportHouse = (req, res) => {
  try {
    const { house_id, reason } = req.body;
    const houseId = parseInt(house_id, 10);
    if (isNaN(houseId) || !reason || !reason.trim())
      return res.redirect(`/student/house/${houseId || ''}?error=invalid_report`);

    const db = getDB();
    db.run(`INSERT INTO reports (house_id, reported_by, reason) VALUES (?, ?, ?)`, [
      houseId,
      req.session.user.id,
      reason.trim(),
    ]);
    saveDB();
    res.redirect(`/student/house/${houseId}?success=report_filed`);
  } catch (err) {
    console.error('Report house error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const showProfile = (req, res) => {
  try {
    const db = getDB();
    const userId = req.session.user.id;
    const profStmt = db.prepare(`SELECT * FROM student_profiles WHERE user_id = ?`);
    profStmt.bind([userId]);
    const profile = profStmt.step() ? profStmt.getAsObject() : {};
    profStmt.free();
    res.render('student/profile', { profile, query: req.query });
  } catch (err) {
    console.error('Student profile error:', err);
    res.status(500).send('Something went wrong.');
  }
};

const updateProfile = (req, res) => {
  try {
    const db = getDB();
    const userId = req.session.user.id;
    const { name, phone, university, course } = req.body;
    if (name && name.trim()) {
      db.run(`UPDATE users SET name = ? WHERE id = ?`, [name.trim(), userId]);
      req.session.user = { ...req.session.user, name: name.trim() };
    }
    db.run(`UPDATE student_profiles SET phone=?, university=?, course=? WHERE user_id=?`, [
      phone || '',
      university || '',
      course || '',
      userId,
    ]);
    saveDB();
    res.redirect('/student/profile?success=profile_updated');
  } catch (err) {
    console.error('Update student profile error:', err);
    res.status(500).send('Something went wrong.');
  }
};

const changePassword = async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;
    if (new_password !== confirm_password)
      return res.redirect('/student/profile?error=passwords_dont_match');
    if (!new_password || new_password.length < 8)
      return res.redirect('/student/profile?error=password_too_short');
    const db = getDB();
    const s = db.prepare(`SELECT password FROM users WHERE id = ?`);
    s.bind([req.session.user.id]);
    s.step();
    const { password: hash } = s.getAsObject();
    s.free();
    const match = await bcrypt.compare(current_password || '', hash);
    if (!match) return res.redirect('/student/profile?error=wrong_password');
    const newHash = await bcrypt.hash(new_password, 10);
    db.run(`UPDATE users SET password = ? WHERE id = ?`, [newHash, req.session.user.id]);
    saveDB();
    res.redirect('/student/profile?success=password_changed');
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).send('Something went wrong.');
  }
};

module.exports = {
  dashboard,
  searchHouses,
  viewHouse,
  sendBooking,
  myBookings,
  addReview,
  reportHouse,
  showProfile,
  updateProfile,
  changePassword,
};
