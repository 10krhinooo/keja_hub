const bcrypt = require('bcryptjs');
const { getDB } = require('../database');
const { deleteImageFiles, getHouseImagePaths, getHouseImages } = require('../utils/houseImages');

const PER_PAGE = 15;

function redirectAfterHouseAction(req, res, houseId, success) {
  let refPath = '';
  try {
    refPath = new URL(req.headers.referer || '').pathname;
  } catch (_) {}
  const dest =
    refPath === `/admin/house/${houseId}`
      ? `/admin/house/${houseId}?success=${success}`
      : `/admin/listings?success=${success}`;
  res.redirect(dest);
}

const dashboard = (req, res) => {
  try {
    const db = getDB();

    const count = (sql) => db.prepare(sql).get()['COUNT(*)'] || 0;

    const statusRows = db
      .prepare(`SELECT status, COUNT(*) as count FROM houses GROUP BY status`)
      .all();
    const listingsByStatus = { approved: 0, pending: 0, rejected: 0 };
    statusRows.forEach((r) => {
      if (Object.prototype.hasOwnProperty.call(listingsByStatus, r.status))
        listingsByStatus[r.status] = r.count;
    });

    const stats = {
      students: count(`SELECT COUNT(*) FROM users WHERE role='student'`),
      landlords: count(`SELECT COUNT(*) FROM users WHERE role='landlord'`),
      totalHouses: count(`SELECT COUNT(*) FROM houses`),
      pending: listingsByStatus.pending,
      activeBookings: count(`SELECT COUNT(*) FROM bookings WHERE status='pending'`),
      openReports: count(`SELECT COUNT(*) FROM reports WHERE status='open'`),
    };

    const topHouses = db
      .prepare(
        `
      SELECT h.id, h.title, h.location,
        ROUND(AVG(rv.rating), 1) as avg_rating,
        COUNT(rv.id) as review_count,
        u.name as landlord_name
      FROM houses h
      JOIN reviews rv ON h.id = rv.house_id
      JOIN users u ON h.landlord_id = u.id
      WHERE h.status = 'approved'
      GROUP BY h.id
      ORDER BY avg_rating DESC, review_count DESC
      LIMIT 5
    `
      )
      .all();

    const bookingStatusRows = db
      .prepare(`SELECT status, COUNT(*) as count FROM bookings GROUP BY status`)
      .all();
    const bookingsByStatus = { pending: 0, accepted: 0, declined: 0 };
    bookingStatusRows.forEach((r) => {
      if (Object.prototype.hasOwnProperty.call(bookingsByStatus, r.status))
        bookingsByStatus[r.status] = r.count;
    });

    const activityFeed = db
      .prepare(
        `
      SELECT 'booking' as event_type, b.created_at as ts,
        u.name as actor, (b.type || ' request') as action, h.title as house_title
      FROM bookings b JOIN houses h ON b.house_id=h.id JOIN users u ON b.student_id=u.id
      UNION ALL
      SELECT 'report', r.created_at, u.name, 'report filed', h.title
      FROM reports r JOIN houses h ON r.house_id=h.id JOIN users u ON r.reported_by=u.id
      ORDER BY ts DESC LIMIT 10
    `
      )
      .all();

    res.render('admin/dashboard', {
      stats,
      topHouses,
      listingsByStatus,
      bookingsByStatus,
      activityFeed,
      query: req.query,
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const adminListings = (req, res) => {
  try {
    const db = getDB();
    const filter = req.query.filter || '';
    const keyword = (req.query.keyword || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const conditions = [];
    const params = [];
    if (filter && ['pending', 'approved', 'rejected'].includes(filter)) {
      conditions.push(`h.status = ?`);
      params.push(filter);
    }
    if (keyword) {
      conditions.push(`(h.title LIKE ? OR h.location LIKE ? OR u.name LIKE ?)`);
      const kw = `%${keyword}%`;
      params.push(kw, kw, kw);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalCount =
      db
        .prepare(
          `SELECT COUNT(*) FROM houses h JOIN users u ON h.landlord_id = u.id ${whereClause}`
        )
        .get(...params)['COUNT(*)'] || 0;
    const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * PER_PAGE;

    const listings = db
      .prepare(
        `
      SELECT h.*, u.name as landlord_name, u.email as landlord_email
      FROM houses h JOIN users u ON h.landlord_id = u.id
      ${whereClause}
      ORDER BY h.created_at DESC
      LIMIT ? OFFSET ?
    `
      )
      .all(...params, PER_PAGE, offset);

    res.render('admin/listings', {
      listings,
      filter,
      keyword,
      page: safePage,
      totalPages,
      totalCount,
      query: req.query,
    });
  } catch (err) {
    console.error('Admin listings error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const analytics = (req, res) => {
  try {
    const db = getDB();

    const listingsPerMonth = db
      .prepare(
        `
      SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
      FROM houses
      WHERE created_at >= date('now', '-6 months')
      GROUP BY month ORDER BY month ASC
    `
      )
      .all();

    const reviewsByRating = db
      .prepare(`SELECT rating, COUNT(*) as count FROM reviews GROUP BY rating ORDER BY rating ASC`)
      .all();

    const topLocations = db
      .prepare(
        `
      SELECT location, COUNT(*) as count FROM houses
      WHERE status='approved'
      GROUP BY location ORDER BY count DESC LIMIT 8
    `
      )
      .all();

    res.render('admin/analytics', { listingsPerMonth, reviewsByRating, topLocations });
  } catch (err) {
    console.error('Admin analytics error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const viewHouse = (req, res) => {
  try {
    const houseId = parseInt(req.params.id, 10);
    if (isNaN(houseId)) return res.redirect('/admin/dashboard');
    const db = getDB();

    const house = db
      .prepare(
        `SELECT h.*, u.name as landlord_name, u.email as landlord_email, lp.phone as landlord_phone FROM houses h JOIN users u ON h.landlord_id = u.id LEFT JOIN landlord_profiles lp ON u.id = lp.user_id WHERE h.id = ?`
      )
      .get(houseId);
    if (!house) return res.redirect('/admin/dashboard');

    const images = getHouseImages(db, houseId);

    const amenities = db.prepare(`SELECT * FROM amenities WHERE house_id = ?`).all(houseId);

    const bookings = db
      .prepare(
        `
      SELECT b.*, u.name as student_name, u.email as student_email
      FROM bookings b JOIN users u ON b.student_id = u.id
      WHERE b.house_id = ? ORDER BY b.created_at DESC
    `
      )
      .all(houseId);

    const reviews = db
      .prepare(
        `
      SELECT r.*, u.name as student_name
      FROM reviews r JOIN users u ON r.student_id = u.id
      WHERE r.house_id = ? ORDER BY r.created_at DESC
    `
      )
      .all(houseId);

    const { avg: avgRating } = db
      .prepare(`SELECT ROUND(AVG(rating),1) as avg FROM reviews WHERE house_id = ?`)
      .get(houseId);

    res.render('admin/house-detail', {
      house,
      images,
      amenities,
      bookings,
      reviews,
      avgRating: avgRating || null,
      query: req.query,
    });
  } catch (err) {
    console.error('Admin view house error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const approveHouse = (req, res) => {
  try {
    const houseId = parseInt(req.params.id, 10);
    if (isNaN(houseId)) return res.redirect('/admin/dashboard');
    const db = getDB();
    db.prepare(`UPDATE houses SET status='approved', rejection_reason=NULL WHERE id=?`).run(
      houseId
    );
    redirectAfterHouseAction(req, res, houseId, 'listing_approved');
  } catch (err) {
    console.error('Approve house error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const rejectHouse = (req, res) => {
  try {
    const houseId = parseInt(req.params.id, 10);
    if (isNaN(houseId)) return res.redirect('/admin/dashboard');
    const reason = (req.body.rejection_reason || '').trim().slice(0, 500) || null;
    const db = getDB();
    db.prepare(`UPDATE houses SET status='rejected', rejection_reason=? WHERE id=?`).run(
      reason,
      houseId
    );
    redirectAfterHouseAction(req, res, houseId, 'listing_rejected');
  } catch (err) {
    console.error('Reject house error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const deleteHouse = (req, res) => {
  try {
    const houseId = parseInt(req.params.id, 10);
    if (isNaN(houseId)) return res.redirect('/admin/dashboard');
    const db = getDB();
    // Collect file paths before the rows go, so the images don't outlive the listing.
    const imgPaths = getHouseImagePaths(db, houseId);

    const deleteAll = db.transaction(() => {
      db.prepare(`DELETE FROM amenities   WHERE house_id = ?`).run(houseId);
      db.prepare(`DELETE FROM house_images WHERE house_id = ?`).run(houseId);
      db.prepare(`DELETE FROM bookings    WHERE house_id = ?`).run(houseId);
      db.prepare(`DELETE FROM reviews     WHERE house_id = ?`).run(houseId);
      db.prepare(`DELETE FROM reports     WHERE house_id = ?`).run(houseId);
      db.prepare(`DELETE FROM houses      WHERE id = ?`).run(houseId);
    });
    deleteAll();

    deleteImageFiles(imgPaths);
    res.redirect('/admin/listings?success=listing_deleted');
  } catch (err) {
    console.error('Delete house error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const manageUsers = (req, res) => {
  try {
    const db = getDB();
    const keyword = (req.query.keyword || '').trim();

    // Each tab paginates independently, since a student list page has no
    // relationship to how far a landlord list has been paged.
    const buildPage = (role, pageParam) => {
      const conds = [`u.role = ?`];
      const params = [role];
      if (keyword) {
        conds.push(`(u.name LIKE ? OR u.email LIKE ?)`);
        const kw = `%${keyword}%`;
        params.push(kw, kw);
      }
      const fromClause = `FROM users u LEFT JOIN landlord_profiles lp ON lp.user_id = u.id`;
      const whereClause = `WHERE ${conds.join(' AND ')}`;

      const totalCount =
        db.prepare(`SELECT COUNT(*) ${fromClause} ${whereClause}`).get(...params)['COUNT(*)'] ||
        0;
      const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));
      const page = Math.min(Math.max(1, parseInt(req.query[pageParam], 10) || 1), totalPages);
      const offset = (page - 1) * PER_PAGE;

      const rows = db
        .prepare(
          `SELECT u.*, lp.is_verified ${fromClause} ${whereClause} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
        )
        .all(...params, PER_PAGE, offset);

      return { rows, page, totalPages, totalCount };
    };

    const students = buildPage('student', 'student_page');
    const landlords = buildPage('landlord', 'landlord_page');

    res.render('admin/users', { students, landlords, keyword, query: req.query });
  } catch (err) {
    console.error('Manage users error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const toggleUser = (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.redirect('/admin/users');
    const db = getDB();
    const user = db.prepare(`SELECT is_active FROM users WHERE id = ?`).get(userId);
    if (!user) return res.redirect('/admin/users');
    db.prepare(`UPDATE users SET is_active = ? WHERE id = ?`).run(user.is_active ? 0 : 1, userId);
    res.redirect('/admin/users');
  } catch (err) {
    console.error('Toggle user error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const toggleVerified = (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.redirect('/admin/users');
    const db = getDB();
    const profile = db
      .prepare(`SELECT is_verified FROM landlord_profiles WHERE user_id = ?`)
      .get(userId);
    if (!profile) return res.redirect('/admin/users');
    db.prepare(`UPDATE landlord_profiles SET is_verified = ? WHERE user_id = ?`).run(
      profile.is_verified ? 0 : 1,
      userId
    );
    res.redirect('/admin/users');
  } catch (err) {
    console.error('Toggle verified error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const manageReports = (req, res) => {
  try {
    const db = getDB();
    const status = req.query.status || '';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const conditions = [];
    const params = [];
    if (status && ['open', 'resolved'].includes(status)) {
      conditions.push(`r.status = ?`);
      params.push(status);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalCount =
      db
        .prepare(
          `SELECT COUNT(*) FROM reports r
           JOIN houses h ON r.house_id = h.id
           JOIN users u ON r.reported_by = u.id
           ${whereClause}`
        )
        .get(...params)['COUNT(*)'] || 0;
    const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * PER_PAGE;

    const reports = db
      .prepare(
        `
      SELECT r.*, h.title as house_title, u.name as reported_by_name
      FROM reports r
      JOIN houses h ON r.house_id = h.id
      JOIN users u ON r.reported_by = u.id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `
      )
      .all(...params, PER_PAGE, offset);

    res.render('admin/reports', {
      reports,
      status,
      page: safePage,
      totalPages,
      totalCount,
      query: req.query,
    });
  } catch (err) {
    console.error('Manage reports error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const resolveReport = (req, res) => {
  try {
    const reportId = parseInt(req.params.id, 10);
    if (isNaN(reportId)) return res.redirect('/admin/reports');
    const db = getDB();
    db.prepare(`UPDATE reports SET status='resolved' WHERE id=?`).run(reportId);
    res.redirect('/admin/reports?success=report_resolved');
  } catch (err) {
    console.error('Resolve report error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const allBookings = (req, res) => {
  try {
    const db = getDB();
    const status = req.query.status || '';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPg = 20;
    const conditions = [];
    const params = [];
    if (status && ['pending', 'accepted', 'declined'].includes(status)) {
      conditions.push(`b.status = ?`);
      params.push(status);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalCount =
      db.prepare(`SELECT COUNT(*) FROM bookings b ${whereClause}`).get(...params)['COUNT(*)'] || 0;
    const totalPages = Math.max(1, Math.ceil(totalCount / perPg));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * perPg;

    const bookings = db
      .prepare(
        `
      SELECT b.*, h.title as house_title, h.location,
        u.name as student_name, u.email as student_email,
        ll.name as landlord_name
      FROM bookings b
      JOIN houses h ON b.house_id = h.id
      JOIN users u  ON b.student_id = u.id
      JOIN users ll ON h.landlord_id = ll.id
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `
      )
      .all(...params, perPg, offset);

    res.render('admin/bookings', {
      bookings,
      status,
      page: safePage,
      totalPages,
      totalCount,
      query: req.query,
    });
  } catch (err) {
    console.error('All bookings error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const showProfile = (req, res) => {
  res.render('admin/profile', { query: req.query });
};

const updateProfile = (req, res) => {
  try {
    const db = getDB();
    const { name } = req.body;
    if (name && name.trim()) {
      db.prepare(`UPDATE users SET name = ? WHERE id = ?`).run(name.trim(), req.session.user.id);
      req.session.user = { ...req.session.user, name: name.trim() };
    }
    res.redirect('/admin/profile?success=profile_updated');
  } catch (err) {
    console.error('Update admin profile error:', err);
    res.status(500).send('Something went wrong.');
  }
};

const changePassword = async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;
    if (new_password !== confirm_password)
      return res.redirect('/admin/profile?error=passwords_dont_match');
    if (!new_password || new_password.length < 8)
      return res.redirect('/admin/profile?error=password_too_short');
    const db = getDB();
    const { password: hash } = db
      .prepare(`SELECT password FROM users WHERE id = ?`)
      .get(req.session.user.id);
    const match = await bcrypt.compare(current_password || '', hash);
    if (!match) return res.redirect('/admin/profile?error=wrong_password');
    const newHash = await bcrypt.hash(new_password, 10);
    db.prepare(`UPDATE users SET password = ? WHERE id = ?`).run(newHash, req.session.user.id);
    res.redirect('/admin/profile?success=password_changed');
  } catch (err) {
    console.error('Change admin password error:', err);
    res.status(500).send('Something went wrong.');
  }
};

module.exports = {
  dashboard,
  adminListings,
  analytics,
  viewHouse,
  approveHouse,
  rejectHouse,
  deleteHouse,
  manageUsers,
  toggleUser,
  toggleVerified,
  manageReports,
  resolveReport,
  allBookings,
  showProfile,
  updateProfile,
  changePassword,
};
