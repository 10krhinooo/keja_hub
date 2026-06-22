const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { getDB, saveDB, rowsToObjects, getDistinctLocations } = require('../database');

const dashboard = (req, res) => {
  try {
    const db = getDB();
    const stmt = db.prepare(`
      SELECT h.*, COUNT(b.id) as booking_count,
        (SELECT image_path FROM house_images WHERE house_id=h.id AND is_primary=1 LIMIT 1) as primary_image
      FROM houses h
      LEFT JOIN bookings b ON h.id = b.house_id
      WHERE h.landlord_id = ?
      GROUP BY h.id
      ORDER BY h.created_at DESC
    `);
    stmt.bind([req.session.user.id]);
    const houses = [];
    while (stmt.step()) houses.push(stmt.getAsObject());
    stmt.free();
    res.render('landlord/dashboard', { houses, query: req.query });
  } catch (err) {
    console.error('Landlord dashboard error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const showAddHouse = (req, res) => {
  const locations = getDistinctLocations();
  res.render('landlord/add-house', { error: null, locations });
};

const addHouse = (req, res) => {
  try {
    const { title, description, rent, location_select, location_new, estate, bedrooms, bathrooms, amenities } = req.body;

    const location = (location_select === '__new__'
      ? (location_new || '').trim()
      : (location_select || '').trim()
    ).slice(0, 60);

    if (!location) {
      const locations = getDistinctLocations();
      return res.render('landlord/add-house', { error: 'Location is required', locations });
    }

    const db = getDB();

    db.run(
      `INSERT INTO houses (landlord_id, title, description, rent, location, estate, bedrooms, bathrooms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.session.user.id, title, description || null, parseFloat(rent), location, estate || null,
       parseInt(bedrooms) || 1, parseInt(bathrooms) || 1]
    );

    const houseId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];

    if (amenities) {
      const list = Array.isArray(amenities) ? amenities : [amenities];
      list.forEach(a => {
        if (a.trim()) db.run(`INSERT INTO amenities (house_id, name) VALUES (?, ?)`, [houseId, a.trim()]);
      });
    }

    if (req.files && req.files.length > 0) {
      req.files.forEach((file, index) => {
        db.run(
          `INSERT INTO house_images (house_id, image_path, is_primary) VALUES (?, ?, ?)`,
          [houseId, '/uploads/houses/' + file.filename, index === 0 ? 1 : 0]
        );
      });
    }

    saveDB();
    res.redirect('/landlord/dashboard?success=listing_submitted');
  } catch (err) {
    const locations = getDistinctLocations();
    res.render('landlord/add-house', { error: err.message, locations });
  }
};

const showHouse = (req, res) => {
  try {
    const houseId = parseInt(req.params.id, 10);
    if (isNaN(houseId)) return res.redirect('/landlord/dashboard');

    const db = getDB();

    const houseStmt = db.prepare(`SELECT * FROM houses WHERE id = ? AND landlord_id = ?`);
    houseStmt.bind([houseId, req.session.user.id]);
    const house = houseStmt.step() ? houseStmt.getAsObject() : null;
    houseStmt.free();
    if (!house) return res.redirect('/landlord/dashboard');

    const imgStmt = db.prepare(`SELECT * FROM house_images WHERE house_id = ?`);
    imgStmt.bind([houseId]);
    const images = [];
    while (imgStmt.step()) images.push(imgStmt.getAsObject());
    imgStmt.free();

    const amenStmt = db.prepare(`SELECT * FROM amenities WHERE house_id = ?`);
    amenStmt.bind([houseId]);
    const amenities = [];
    while (amenStmt.step()) amenities.push(amenStmt.getAsObject());
    amenStmt.free();

    const bookStmt = db.prepare(`
      SELECT b.*, u.name as student_name, u.email as student_email
      FROM bookings b JOIN users u ON b.student_id = u.id
      WHERE b.house_id = ?
      ORDER BY b.created_at DESC
    `);
    bookStmt.bind([houseId]);
    const bookings = [];
    while (bookStmt.step()) bookings.push(bookStmt.getAsObject());
    bookStmt.free();

    res.render('landlord/house-detail', { house, images, amenities, bookings, query: req.query });
  } catch (err) {
    console.error('Show house error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const updateBooking = (req, res) => {
  try {
    const { status } = req.body;
    if (!['accepted', 'declined'].includes(status)) return res.redirect('back');

    const bookingId = parseInt(req.params.id, 10);
    if (isNaN(bookingId)) return res.redirect('back');

    const db = getDB();

    const bStmt = db.prepare(`SELECT house_id FROM bookings WHERE id = ? AND house_id IN (SELECT id FROM houses WHERE landlord_id = ?)`);
    bStmt.bind([bookingId, req.session.user.id]);
    const found = bStmt.step();
    const { house_id } = found ? bStmt.getAsObject() : {};
    bStmt.free();
    if (!house_id) return res.redirect('back');

    db.run(`UPDATE bookings SET status = ? WHERE id = ?`, [status, bookingId]);
    saveDB();
    res.redirect(`/landlord/house/${house_id}?success=booking_${status}`);
  } catch (err) {
    console.error('Update booking error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const showEditHouse = (req, res) => {
  try {
    const houseId = parseInt(req.params.id, 10);
    if (isNaN(houseId)) return res.redirect('/landlord/dashboard');
    const db = getDB();

    const houseStmt = db.prepare(`SELECT * FROM houses WHERE id = ? AND landlord_id = ?`);
    houseStmt.bind([houseId, req.session.user.id]);
    const house = houseStmt.step() ? houseStmt.getAsObject() : null;
    houseStmt.free();
    if (!house) return res.redirect('/landlord/dashboard');

    const imgStmt = db.prepare(`SELECT * FROM house_images WHERE house_id = ?`);
    imgStmt.bind([houseId]);
    const images = [];
    while (imgStmt.step()) images.push(imgStmt.getAsObject());
    imgStmt.free();

    const amenStmt = db.prepare(`SELECT name FROM amenities WHERE house_id = ?`);
    amenStmt.bind([houseId]);
    const amenities = [];
    while (amenStmt.step()) amenities.push(amenStmt.getAsObject().name);
    amenStmt.free();

    const locations = getDistinctLocations();
    res.render('landlord/edit-house', { house, images, amenities, locations, error: null });
  } catch (err) {
    console.error('Show edit house error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const editHouse = (req, res) => {
  try {
    const houseId = parseInt(req.params.id, 10);
    if (isNaN(houseId)) return res.redirect('/landlord/dashboard');
    const db = getDB();

    const checkStmt = db.prepare(`SELECT id FROM houses WHERE id = ? AND landlord_id = ?`);
    checkStmt.bind([houseId, req.session.user.id]);
    const exists = checkStmt.step();
    checkStmt.free();
    if (!exists) return res.redirect('/landlord/dashboard');

    const { title, description, rent, location_select, location_new, estate, bedrooms, bathrooms, amenities, delete_images } = req.body;

    const location = (location_select === '__new__'
      ? (location_new || '').trim()
      : (location_select || '').trim()
    ).slice(0, 60);

    if (!location) {
      const locations = getDistinctLocations();
      const imgStmt = db.prepare(`SELECT * FROM house_images WHERE house_id = ?`);
      imgStmt.bind([houseId]);
      const images = [];
      while (imgStmt.step()) images.push(imgStmt.getAsObject());
      imgStmt.free();
      const houseStmt = db.prepare(`SELECT * FROM houses WHERE id = ?`);
      houseStmt.bind([houseId]);
      const house = houseStmt.step() ? houseStmt.getAsObject() : {};
      houseStmt.free();
      return res.render('landlord/edit-house', {
        house, images,
        amenities: Array.isArray(amenities) ? amenities : (amenities ? [amenities] : []),
        locations, error: 'Location is required'
      });
    }

    db.run(
      `UPDATE houses SET title=?, description=?, rent=?, location=?, estate=?, bedrooms=?, bathrooms=?,
       status='pending', rejection_reason=NULL WHERE id=?`,
      [title, description || null, parseFloat(rent), location, estate || null,
       parseInt(bedrooms) || 1, parseInt(bathrooms) || 1, houseId]
    );

    db.run(`DELETE FROM amenities WHERE house_id = ?`, [houseId]);
    if (amenities) {
      const list = Array.isArray(amenities) ? amenities : [amenities];
      list.forEach(a => {
        if (a.trim()) db.run(`INSERT INTO amenities (house_id, name) VALUES (?, ?)`, [houseId, a.trim()]);
      });
    }

    if (delete_images) {
      const toDelete = Array.isArray(delete_images) ? delete_images : [delete_images];
      toDelete.forEach(imgId => {
        const pathStmt = db.prepare(`SELECT image_path FROM house_images WHERE id = ? AND house_id = ?`);
        pathStmt.bind([parseInt(imgId, 10), houseId]);
        if (pathStmt.step()) {
          const imgPath = pathStmt.getAsObject().image_path;
          try { fs.unlinkSync(path.join(__dirname, '../../', imgPath)); } catch (_) {}
        }
        pathStmt.free();
        db.run(`DELETE FROM house_images WHERE id = ? AND house_id = ?`, [parseInt(imgId, 10), houseId]);
      });
    }

    if (req.files && req.files.length > 0) {
      const cntStmt = db.prepare(`SELECT COUNT(*) as cnt FROM house_images WHERE house_id = ?`);
      cntStmt.bind([houseId]);
      cntStmt.step();
      const cnt = cntStmt.getAsObject().cnt || 0;
      cntStmt.free();
      req.files.forEach((file, index) => {
        db.run(
          `INSERT INTO house_images (house_id, image_path, is_primary) VALUES (?, ?, ?)`,
          [houseId, '/uploads/houses/' + file.filename, (cnt === 0 && index === 0) ? 1 : 0]
        );
      });
    }

    saveDB();
    res.redirect(`/landlord/house/${houseId}?success=listing_updated`);
  } catch (err) {
    console.error('Edit house error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const deleteHouse = (req, res) => {
  try {
    const houseId = parseInt(req.params.id, 10);
    if (isNaN(houseId)) return res.redirect('/landlord/dashboard');

    const db = getDB();

    const ownerStmt = db.prepare(`SELECT id FROM houses WHERE id = ? AND landlord_id = ?`);
    ownerStmt.bind([houseId, req.session.user.id]);
    const owned = ownerStmt.step();
    ownerStmt.free();
    if (!owned) return res.redirect('/landlord/dashboard');

    const imgPathStmt = db.prepare(`SELECT image_path FROM house_images WHERE house_id = ?`);
    imgPathStmt.bind([houseId]);
    const imgPaths = [];
    while (imgPathStmt.step()) imgPaths.push(imgPathStmt.getAsObject().image_path);
    imgPathStmt.free();

    db.run(`DELETE FROM bookings     WHERE house_id = ?`, [houseId]);
    db.run(`DELETE FROM reviews      WHERE house_id = ?`, [houseId]);
    db.run(`DELETE FROM amenities    WHERE house_id = ?`, [houseId]);
    db.run(`DELETE FROM house_images WHERE house_id = ?`, [houseId]);
    db.run(`DELETE FROM houses       WHERE id = ?`,       [houseId]);
    saveDB();

    imgPaths.forEach(p => {
      try { fs.unlinkSync(path.join(__dirname, '../../', p)); } catch (_) {}
    });

    res.redirect('/landlord/dashboard');
  } catch (err) {
    console.error('Delete house error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const showProfile = (req, res) => {
  try {
    const db = getDB();
    const profStmt = db.prepare(`SELECT * FROM landlord_profiles WHERE user_id = ?`);
    profStmt.bind([req.session.user.id]);
    const profile = profStmt.step() ? profStmt.getAsObject() : {};
    profStmt.free();
    res.render('landlord/profile', { profile, query: req.query });
  } catch (err) {
    console.error('Landlord profile error:', err);
    res.status(500).send('Something went wrong.');
  }
};

const updateProfile = (req, res) => {
  try {
    const db = getDB();
    const userId = req.session.user.id;
    const { name, phone, id_number } = req.body;
    if (name && name.trim()) {
      db.run(`UPDATE users SET name = ? WHERE id = ?`, [name.trim(), userId]);
      req.session.user = { ...req.session.user, name: name.trim() };
    }
    db.run(`UPDATE landlord_profiles SET phone=?, id_number=? WHERE user_id=?`,
      [phone || '', id_number || '', userId]);
    saveDB();
    res.redirect('/landlord/profile?success=profile_updated');
  } catch (err) {
    console.error('Update landlord profile error:', err);
    res.status(500).send('Something went wrong.');
  }
};

const changePassword = async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;
    if (new_password !== confirm_password)
      return res.redirect('/landlord/profile?error=passwords_dont_match');
    if (!new_password || new_password.length < 8)
      return res.redirect('/landlord/profile?error=password_too_short');
    const db = getDB();
    const s = db.prepare(`SELECT password FROM users WHERE id = ?`);
    s.bind([req.session.user.id]); s.step();
    const { password: hash } = s.getAsObject(); s.free();
    const match = await bcrypt.compare(current_password || '', hash);
    if (!match) return res.redirect('/landlord/profile?error=wrong_password');
    const newHash = await bcrypt.hash(new_password, 10);
    db.run(`UPDATE users SET password = ? WHERE id = ?`, [newHash, req.session.user.id]);
    saveDB();
    res.redirect('/landlord/profile?success=password_changed');
  } catch (err) {
    console.error('Change landlord password error:', err);
    res.status(500).send('Something went wrong.');
  }
};

module.exports = { dashboard, showAddHouse, addHouse, showHouse, showEditHouse, editHouse, updateBooking, deleteHouse, showProfile, updateProfile, changePassword };
