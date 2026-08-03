const bcrypt = require('bcryptjs');
const { getDB, getDistinctLocations } = require('../database');
const { AMENITY_OPTIONS, validateHouseInput } = require('../utils/validateHouse');
const {
  MAX_IMAGES_PER_HOUSE,
  deleteImageFiles,
  deleteUploadedFiles,
  processAndStoreUploads,
  getHouseAssetPaths,
  getHouseImages,
  normalizePrimary,
  applyImageOrder,
  nextSortOrder,
} = require('../utils/houseImages');
const { sendBookingStatusEmail } = require('../utils/mailer');

// A listing always needs a cover image, even if the flagged primary was deleted,
// falling back to sort order keeps thumbnails from silently going blank.
const PRIMARY_IMAGE_SQL = `
  (SELECT image_path FROM house_images WHERE house_id = h.id
     ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1) as primary_image,
  (SELECT thumbnail_path FROM house_images WHERE house_id = h.id
     ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1) as primary_thumbnail`;

function parseIdList(value) {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  return raw.map((v) => parseInt(v, 10)).filter((v) => !isNaN(v));
}

const dashboard = (req, res) => {
  try {
    const db = getDB();
    const houses = db
      .prepare(
        `
      SELECT h.*, COUNT(b.id) as booking_count,
        ${PRIMARY_IMAGE_SQL}
      FROM houses h
      LEFT JOIN bookings b ON h.id = b.house_id
      WHERE h.landlord_id = ?
      GROUP BY h.id
      ORDER BY h.created_at DESC
    `
      )
      .all(req.session.user.id);
    res.render('landlord/dashboard', { houses, query: req.query });
  } catch (err) {
    console.error('Landlord dashboard error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

function renderAddHouse(res, { error = null, values = {} } = {}) {
  res.render('landlord/add-house', {
    error,
    values,
    locations: getDistinctLocations(),
    amenityOptions: AMENITY_OPTIONS,
    maxImages: MAX_IMAGES_PER_HOUSE,
  });
}

const showAddHouse = (req, res) => renderAddHouse(res);

const addHouse = async (req, res) => {
  try {
    const { errors, values } = validateHouseInput(req.body);

    if (req.files && req.files.length > MAX_IMAGES_PER_HOUSE) {
      errors.push(
        `You can upload up to ${MAX_IMAGES_PER_HOUSE} photos but you selected ${req.files.length}.`
      );
    }

    if (errors.length) {
      // Multer already wrote these to disk; drop them so failed submissions
      // don't leave orphaned files behind.
      deleteUploadedFiles(req.files);
      return renderAddHouse(res, { error: errors.join(' '), values: req.body });
    }

    // Resizes, re-encodes and stores every upload before the DB transaction,
    // since that work is async and better-sqlite3 transactions must be
    // synchronous.
    const uploaded = await processAndStoreUploads(req.files);

    const db = getDB();

    // A throw partway through (e.g. a bad amenity insert) must not leave a
    // house row with no amenities or photos attached.
    const insertListing = db.transaction(() => {
      const { lastInsertRowid: houseId } = db
        .prepare(
          `INSERT INTO houses (landlord_id, title, description, rent, location, estate, bedrooms, bathrooms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          req.session.user.id,
          values.title,
          values.description,
          values.rent,
          values.location,
          values.estate || null,
          values.bedrooms,
          values.bathrooms
        );

      const insertAmenity = db.prepare(`INSERT INTO amenities (house_id, name) VALUES (?, ?)`);
      values.amenities.forEach((name) => insertAmenity.run(houseId, name));

      const insertImage = db.prepare(
        `INSERT INTO house_images (house_id, image_path, thumbnail_path, is_primary, sort_order)
         VALUES (?, ?, ?, ?, ?)`
      );
      uploaded.forEach((img, index) => {
        insertImage.run(houseId, img.imagePath, img.thumbnailPath, index === 0 ? 1 : 0, index);
      });

      return houseId;
    });

    insertListing();
    res.redirect('/landlord/dashboard?success=listing_submitted');
  } catch (err) {
    console.error('Add house error:', err);
    deleteUploadedFiles(req.files);
    renderAddHouse(res, {
      error:
        'We could not save your listing. Please try again. If it keeps happening, contact support.',
      values: req.body,
    });
  }
};

const showHouse = (req, res) => {
  try {
    const houseId = parseInt(req.params.id, 10);
    if (isNaN(houseId)) return res.redirect('/landlord/dashboard');

    const db = getDB();

    const house = db
      .prepare(`SELECT * FROM houses WHERE id = ? AND landlord_id = ?`)
      .get(houseId, req.session.user.id);
    if (!house) return res.redirect('/landlord/dashboard?error=listing_not_found');

    const images = getHouseImages(db, houseId);

    const amenities = db.prepare(`SELECT * FROM amenities WHERE house_id = ?`).all(houseId);

    const bookings = db
      .prepare(
        `
      SELECT b.*, u.name as student_name, u.email as student_email
      FROM bookings b JOIN users u ON b.student_id = u.id
      WHERE b.house_id = ?
      ORDER BY b.created_at DESC
    `
      )
      .all(houseId);

    res.render('landlord/house-detail', { house, images, amenities, bookings, query: req.query });
  } catch (err) {
    console.error('Show house error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const updateBooking = async (req, res) => {
  // Express 5 removed the 'back' magic string from res.redirect().
  const goBack = (err) =>
    res.redirect(
      (req.get('Referer') || '/landlord/dashboard') +
        (err ? ((req.get('Referer') || '').includes('?') ? `&error=${err}` : `?error=${err}`) : '')
    );

  try {
    const { status } = req.body;
    if (!['accepted', 'declined'].includes(status)) return goBack('invalid_booking_status');

    const bookingId = parseInt(req.params.id, 10);
    if (isNaN(bookingId)) return goBack('booking_not_found');

    const db = getDB();

    const found = db
      .prepare(
        `SELECT b.house_id, h.title AS house_title, u.email AS student_email
         FROM bookings b
         JOIN houses h ON h.id = b.house_id
         JOIN users u ON u.id = b.student_id
         WHERE b.id = ? AND h.landlord_id = ?`
      )
      .get(bookingId, req.session.user.id);
    if (!found) return goBack('booking_not_found');

    db.prepare(`UPDATE bookings SET status = ? WHERE id = ?`).run(status, bookingId);

    // Best-effort: a mailer outage should not stop the status update.
    try {
      const houseUrl = `${req.protocol}://${req.get('host')}/student/house/${found.house_id}`;
      await sendBookingStatusEmail(found.student_email, {
        houseTitle: found.house_title,
        status,
        houseUrl,
      });
    } catch (mailErr) {
      console.error('Send booking status email error:', mailErr);
    }

    res.redirect(`/landlord/house/${found.house_id}?success=booking_${status}`);
  } catch (err) {
    console.error('Update booking error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

function findOwnedHouse(db, houseId, landlordId) {
  return db
    .prepare(`SELECT * FROM houses WHERE id = ? AND landlord_id = ?`)
    .get(houseId, landlordId);
}

function renderEditHouse(res, db, house, { error = null, amenities, values } = {}) {
  if (!amenities) {
    amenities = db
      .prepare(`SELECT name FROM amenities WHERE house_id = ?`)
      .all(house.id)
      .map((row) => row.name);
  }
  res.render('landlord/edit-house', {
    house: values ? { ...house, ...values } : house,
    images: getHouseImages(db, house.id),
    amenities,
    locations: getDistinctLocations(),
    amenityOptions: AMENITY_OPTIONS,
    maxImages: MAX_IMAGES_PER_HOUSE,
    error,
  });
}

const showEditHouse = (req, res) => {
  try {
    const houseId = parseInt(req.params.id, 10);
    if (isNaN(houseId)) return res.redirect('/landlord/dashboard?error=listing_not_found');
    const db = getDB();

    const house = findOwnedHouse(db, houseId, req.session.user.id);
    if (!house) return res.redirect('/landlord/dashboard?error=listing_not_found');

    renderEditHouse(res, db, house);
  } catch (err) {
    console.error('Show edit house error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const editHouse = async (req, res) => {
  const db = getDB();
  let house = null;

  try {
    const houseId = parseInt(req.params.id, 10);
    if (isNaN(houseId)) {
      deleteUploadedFiles(req.files);
      return res.redirect('/landlord/dashboard?error=listing_not_found');
    }

    house = findOwnedHouse(db, houseId, req.session.user.id);
    if (!house) {
      deleteUploadedFiles(req.files);
      return res.redirect('/landlord/dashboard?error=listing_not_found');
    }

    const { errors, values } = validateHouseInput(req.body);

    // Only ids that actually belong to this listing. Never trust the client's list.
    const ownedIds = new Set(getHouseImages(db, houseId).map((img) => img.id));
    const toDelete = parseIdList(req.body.delete_images).filter((id) => ownedIds.has(id));
    const newCount = (req.files || []).length;
    const finalCount = ownedIds.size - toDelete.length + newCount;

    if (finalCount > MAX_IMAGES_PER_HOUSE) {
      const room = MAX_IMAGES_PER_HOUSE - (ownedIds.size - toDelete.length);
      errors.push(
        `A listing can have at most ${MAX_IMAGES_PER_HOUSE} photos. You have room for ` +
          `${room === 1 ? '1 more photo' : `${room} more photos`} but added ${newCount}. ` +
          `Remove some existing photos or upload fewer new ones.`
      );
    }

    if (errors.length) {
      deleteUploadedFiles(req.files);
      return renderEditHouse(res, db, house, {
        error: errors.join(' '),
        amenities: values.amenities,
        values: {
          title: req.body.title,
          description: req.body.description,
          rent: req.body.rent,
          estate: req.body.estate,
          bedrooms: values.bedrooms,
          bathrooms: values.bathrooms,
        },
      });
    }

    // Admin approval happens once, at creation. Later edits go live immediately,
    // except on a rejected listing, where saving counts as a resubmission.
    const nextStatus = house.status === 'rejected' ? 'pending' : house.status;

    // Resizes, re-encodes and stores every new upload before the DB
    // transaction, since that work is async and better-sqlite3 transactions
    // must be synchronous.
    const uploaded = await processAndStoreUploads(req.files);

    let removedPaths = [];

    // A throw partway through (e.g. mid photo-reorder) must not leave the
    // listing row updated but its amenities or photos half-written.
    const applyEdit = db.transaction(() => {
      db.prepare(
        `UPDATE houses SET title=?, description=?, rent=?, location=?, estate=?, bedrooms=?, bathrooms=?,
       status=?, rejection_reason=NULL WHERE id=?`
      ).run(
        values.title,
        values.description,
        values.rent,
        values.location,
        values.estate || null,
        values.bedrooms,
        values.bathrooms,
        nextStatus,
        houseId
      );

      db.prepare(`DELETE FROM amenities WHERE house_id = ?`).run(houseId);
      const insertAmenity = db.prepare(`INSERT INTO amenities (house_id, name) VALUES (?, ?)`);
      values.amenities.forEach((name) => insertAmenity.run(houseId, name));

      if (toDelete.length) {
        const placeholders = toDelete.map(() => '?').join(',');
        removedPaths = db
          .prepare(
            `SELECT image_path, thumbnail_path FROM house_images
             WHERE house_id = ? AND id IN (${placeholders})`
          )
          .all(houseId, ...toDelete)
          .flatMap((row) => [row.image_path, row.thumbnail_path])
          .filter(Boolean);

        db.prepare(`DELETE FROM house_images WHERE house_id = ? AND id IN (${placeholders})`).run(
          houseId,
          ...toDelete
        );
      }

      let order = nextSortOrder(db, houseId);
      const insertImage = db.prepare(
        `INSERT INTO house_images (house_id, image_path, thumbnail_path, is_primary, sort_order)
         VALUES (?, ?, ?, 0, ?)`
      );
      uploaded.forEach((img) => {
        insertImage.run(houseId, img.imagePath, img.thumbnailPath, order++);
      });

      applyImageOrder(
        db,
        houseId,
        parseIdList(req.body.image_order).filter((id) => !toDelete.includes(id))
      );
      normalizePrimary(db, houseId, parseInt(req.body.primary_image, 10));
    });

    applyEdit();
    deleteImageFiles(removedPaths);

    const success =
      nextStatus === 'pending' && house.status === 'rejected'
        ? 'listing_resubmitted'
        : 'listing_updated';
    res.redirect(`/landlord/house/${houseId}?success=${success}`);
  } catch (err) {
    console.error('Edit house error:', err);
    deleteUploadedFiles(req.files);
    if (house) {
      return renderEditHouse(res, db, house, {
        error: 'We could not save your changes. Your listing is unchanged. Please try again.',
      });
    }
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const deleteHouse = (req, res) => {
  try {
    const houseId = parseInt(req.params.id, 10);
    if (isNaN(houseId)) return res.redirect('/landlord/dashboard');

    const db = getDB();

    const owned = findOwnedHouse(db, houseId, req.session.user.id);
    if (!owned) return res.redirect('/landlord/dashboard?error=listing_not_found');

    const imgPaths = getHouseAssetPaths(db, houseId);

    const deleteAll = db.transaction(() => {
      db.prepare(`DELETE FROM bookings     WHERE house_id = ?`).run(houseId);
      db.prepare(`DELETE FROM reviews      WHERE house_id = ?`).run(houseId);
      db.prepare(`DELETE FROM reports      WHERE house_id = ?`).run(houseId);
      db.prepare(`DELETE FROM amenities    WHERE house_id = ?`).run(houseId);
      db.prepare(`DELETE FROM house_images WHERE house_id = ?`).run(houseId);
      db.prepare(`DELETE FROM houses       WHERE id = ?`).run(houseId);
    });
    deleteAll();

    deleteImageFiles(imgPaths);

    res.redirect('/landlord/dashboard?success=listing_deleted');
  } catch (err) {
    console.error('Delete house error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
};

const showProfile = (req, res) => {
  try {
    const db = getDB();
    const profile =
      db.prepare(`SELECT * FROM landlord_profiles WHERE user_id = ?`).get(req.session.user.id) ||
      {};
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
      db.prepare(`UPDATE users SET name = ? WHERE id = ?`).run(name.trim(), userId);
      req.session.user = { ...req.session.user, name: name.trim() };
    }
    db.prepare(`UPDATE landlord_profiles SET phone=?, id_number=? WHERE user_id=?`).run(
      phone || '',
      id_number || '',
      userId
    );
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
    const { password: hash } = db
      .prepare(`SELECT password FROM users WHERE id = ?`)
      .get(req.session.user.id);
    const match = await bcrypt.compare(current_password || '', hash);
    if (!match) return res.redirect('/landlord/profile?error=wrong_password');
    const newHash = await bcrypt.hash(new_password, 10);
    db.prepare(`UPDATE users SET password = ? WHERE id = ?`).run(newHash, req.session.user.id);
    res.redirect('/landlord/profile?success=password_changed');
  } catch (err) {
    console.error('Change landlord password error:', err);
    res.status(500).send('Something went wrong.');
  }
};

module.exports = {
  dashboard,
  showAddHouse,
  addHouse,
  showHouse,
  showEditHouse,
  editHouse,
  updateBooking,
  deleteHouse,
  showProfile,
  updateProfile,
  changePassword,
};
