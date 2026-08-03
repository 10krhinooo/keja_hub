const bcrypt = require('bcryptjs');
const { getDB, getDistinctLocations } = require('../database');
const { sendBookingRequestEmail } = require('../utils/mailer');
const { buildBaseUrl } = require('../utils/url');
const logger = require('../utils/logger');

const dashboard = (req, res) => {
  try {
    const db = getDB();
    const houses = db
      .prepare(
        `
      SELECT h.*,
        (SELECT image_path FROM house_images WHERE house_id=h.id
           ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1) as primary_image,
        (SELECT thumbnail_path FROM house_images WHERE house_id=h.id
           ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1) as primary_thumbnail,
        (SELECT AVG(rating) FROM reviews WHERE house_id=h.id) as avg_rating,
        (SELECT COUNT(*) FROM reviews WHERE house_id=h.id) as review_count
      FROM houses h
      WHERE h.status='approved' AND h.is_available=1
      ORDER BY h.created_at DESC
      LIMIT 6
    `
      )
      .all();
    res.render('student/dashboard', { houses, query: req.query });
  } catch (err) {
    logger.error('Student dashboard error', { req, err });
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

    const { total: totalCount } = db
      .prepare(`SELECT COUNT(*) as total FROM houses h WHERE ${whereClause}`)
      .get(...params);

    const totalPages = Math.max(1, Math.ceil(totalCount / SEARCH_PER_PAGE));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * SEARCH_PER_PAGE;

    const houses = db
      .prepare(
        `
      SELECT h.*,
        (SELECT image_path FROM house_images WHERE house_id=h.id
           ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1) as primary_image,
        (SELECT thumbnail_path FROM house_images WHERE house_id=h.id
           ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1) as primary_thumbnail,
        ROUND((SELECT AVG(rating) FROM reviews WHERE house_id=h.id), 1) as avg_rating,
        (SELECT COUNT(*) FROM reviews WHERE house_id=h.id) as review_count
      FROM houses h
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `
      )
      .all(...params, SEARCH_PER_PAGE, offset);

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
    logger.error('Search error', { req, err });
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const viewHouse = (req, res) => {
  try {
    const houseId = parseInt(req.params.id, 10);
    if (isNaN(houseId)) return res.redirect('/student/search');

    const db = getDB();

    const house = db
      .prepare(`SELECT * FROM houses WHERE id = ? AND status = 'approved'`)
      .get(houseId);
    if (!house) return res.redirect('/student/search');

    const images = db
      .prepare(
        `SELECT * FROM house_images WHERE house_id = ? ORDER BY is_primary DESC, sort_order ASC, id ASC`
      )
      .all(houseId);

    const amenities = db.prepare(`SELECT * FROM amenities WHERE house_id = ?`).all(houseId);

    const reviews = db
      .prepare(
        `
      SELECT r.*, u.name as student_name
      FROM reviews r JOIN users u ON r.student_id = u.id
      WHERE r.house_id = ?
      ORDER BY r.created_at DESC
    `
      )
      .all(houseId);

    const { avg: avgRaw } = db
      .prepare(`SELECT AVG(rating) as avg FROM reviews WHERE house_id = ?`)
      .get(houseId);
    const avgRating = avgRaw ? Number(avgRaw).toFixed(1) : null;

    const landlord =
      db
        .prepare(
          `
      SELECT u.name, lp.phone
      FROM users u
      LEFT JOIN landlord_profiles lp ON u.id = lp.user_id
      WHERE u.id = ?
    `
        )
        .get(house.landlord_id) || {};

    const existingBooking = db
      .prepare(
        `SELECT * FROM bookings WHERE house_id = ? AND student_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(houseId, req.session.user.id);

    const existingReview = db
      .prepare(`SELECT * FROM reviews WHERE house_id = ? AND student_id = ? LIMIT 1`)
      .get(houseId, req.session.user.id);

    res.render('student/house-detail', {
      house,
      images,
      amenities,
      reviews,
      avgRating,
      landlord,
      existingBooking: existingBooking || null,
      existingReview: existingReview || null,
      query: req.query,
    });
  } catch (err) {
    logger.error('View house error', { req, err });
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const sendBooking = async (req, res) => {
  try {
    const { house_id, type, message, visit_date } = req.body;
    const houseId = parseInt(house_id, 10);
    if (isNaN(houseId)) return res.redirect('/student/dashboard');

    const db = getDB();

    const house = db
      .prepare(
        `SELECT h.id, h.title, u.email AS landlord_email FROM houses h
         JOIN users u ON u.id = h.landlord_id
         WHERE h.id = ? AND h.status = 'approved' AND h.is_available = 1`
      )
      .get(houseId);
    if (!house) return res.redirect('/student/dashboard');

    const alreadyPending = db
      .prepare(
        `SELECT id FROM bookings WHERE house_id = ? AND student_id = ? AND status = 'pending'`
      )
      .get(houseId, req.session.user.id);
    if (alreadyPending) return res.redirect(`/student/house/${houseId}?error=already_requested`);

    const bookingType = ['viewing', 'booking'].includes(type) ? type : 'viewing';
    db.prepare(
      `INSERT INTO bookings (house_id, student_id, type, message, visit_date) VALUES (?, ?, ?, ?, ?)`
    ).run(houseId, req.session.user.id, bookingType, message || null, visit_date || null);

    // Best-effort: a mailer outage should not stop the booking from going
    // through. The landlord still sees the request in their dashboard.
    try {
      const houseUrl = `${buildBaseUrl(req)}/landlord/house/${houseId}`;
      await sendBookingRequestEmail(house.landlord_email, {
        studentName: req.session.user.name,
        houseTitle: house.title,
        houseUrl,
      });
    } catch (mailErr) {
      logger.error('Send booking request email error', { req, err: mailErr });
    }

    res.redirect(`/student/house/${houseId}?success=booking_sent`);
  } catch (err) {
    logger.error('Send booking error', { req, err });
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const myBookings = (req, res) => {
  try {
    const db = getDB();
    const bookings = db
      .prepare(
        `
      SELECT b.*, h.title as house_title, h.location, h.rent,
        (SELECT image_path FROM house_images WHERE house_id=h.id
           ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1) as primary_image,
        (SELECT thumbnail_path FROM house_images WHERE house_id=h.id
           ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1) as primary_thumbnail
      FROM bookings b JOIN houses h ON b.house_id = h.id
      WHERE b.student_id = ?
      ORDER BY b.created_at DESC
    `
      )
      .all(req.session.user.id);
    res.render('student/bookings', { bookings });
  } catch (err) {
    logger.error('My bookings error', { req, err });
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

    const houseExists = db
      .prepare(`SELECT id FROM houses WHERE id = ? AND status = 'approved'`)
      .get(houseId);
    if (!houseExists) return res.redirect('/student/dashboard');

    const alreadyReviewed = db
      .prepare(`SELECT id FROM reviews WHERE house_id = ? AND student_id = ?`)
      .get(houseId, req.session.user.id);
    if (alreadyReviewed) return res.redirect(`/student/house/${houseId}?error=already_reviewed`);

    db.prepare(
      `INSERT INTO reviews (house_id, student_id, rating, comment) VALUES (?, ?, ?, ?)`
    ).run(houseId, req.session.user.id, ratingNum, comment || null);
    res.redirect(`/student/house/${houseId}?success=review_posted`);
  } catch (err) {
    logger.error('Add review error', { req, err });
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
    db.prepare(`INSERT INTO reports (house_id, reported_by, reason) VALUES (?, ?, ?)`).run(
      houseId,
      req.session.user.id,
      reason.trim()
    );
    res.redirect(`/student/house/${houseId}?success=report_filed`);
  } catch (err) {
    logger.error('Report house error', { req, err });
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const showProfile = (req, res) => {
  try {
    const db = getDB();
    const userId = req.session.user.id;
    const profile =
      db.prepare(`SELECT * FROM student_profiles WHERE user_id = ?`).get(userId) || {};
    res.render('student/profile', { profile, query: req.query });
  } catch (err) {
    logger.error('Student profile error', { req, err });
    res.status(500).send('Something went wrong.');
  }
};

const updateProfile = (req, res) => {
  try {
    const db = getDB();
    const userId = req.session.user.id;
    const { name, phone, university, course } = req.body;
    if (name && name.trim()) {
      db.prepare(`UPDATE users SET name = ? WHERE id = ?`).run(name.trim(), userId);
      req.session.user = { ...req.session.user, name: name.trim() };
    }
    db.prepare(`UPDATE student_profiles SET phone=?, university=?, course=? WHERE user_id=?`).run(
      phone || '',
      university || '',
      course || '',
      userId
    );
    res.redirect('/student/profile?success=profile_updated');
  } catch (err) {
    logger.error('Update student profile error', { req, err });
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
    const { password: hash } = db
      .prepare(`SELECT password FROM users WHERE id = ?`)
      .get(req.session.user.id);
    const match = await bcrypt.compare(current_password || '', hash);
    if (!match) return res.redirect('/student/profile?error=wrong_password');
    const newHash = await bcrypt.hash(new_password, 10);
    db.prepare(`UPDATE users SET password = ? WHERE id = ?`).run(newHash, req.session.user.id);
    res.redirect('/student/profile?success=password_changed');
  } catch (err) {
    logger.error('Change password error', { req, err });
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
