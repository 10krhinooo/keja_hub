const { getDB, saveDB } = require('../database');

const dashboard = (req, res) => {
  const db = getDB();
  const result = db.exec(`
    SELECT h.*, COUNT(b.id) as booking_count
    FROM houses h
    LEFT JOIN bookings b ON h.id = b.house_id
    WHERE h.landlord_id = ${req.session.user.id}
    GROUP BY h.id
    ORDER BY h.created_at DESC
  `);
  const houses = result.length === 0 ? [] : result[0].values.map(row =>
    Object.fromEntries(result[0].columns.map((c, i) => [c, row[i]]))
  );

  houses.forEach(house => {
    const imgResult = db.exec(`SELECT image_path FROM house_images WHERE house_id=${house.id} AND is_primary=1 LIMIT 1`);
    house.primary_image = imgResult.length > 0 ? imgResult[0].values[0][0] : null;
  });

  res.render('landlord/dashboard', { houses });
};

const showAddHouse = (req, res) => {
  res.render('landlord/add-house', { error: null });
};

const addHouse = (req, res) => {
  try {
    const { title, description, rent, location, estate, bedrooms, bathrooms, amenities } = req.body;
    const db = getDB();

    db.run(
      `INSERT INTO houses (landlord_id, title, description, rent, location, estate, bedrooms, bathrooms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.session.user.id, title, description, rent, location, estate, bedrooms || 1, bathrooms || 1]
    );

    const houseResult = db.exec(`SELECT id FROM houses WHERE landlord_id=${req.session.user.id} ORDER BY id DESC LIMIT 1`);
    const houseId = houseResult[0].values[0][0];

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
    res.redirect('/landlord/dashboard');
  } catch (err) {
    res.render('landlord/add-house', { error: err.message });
  }
};

const showHouse = (req, res) => {
  const db = getDB();
  const houseResult = db.exec(`SELECT * FROM houses WHERE id=${req.params.id} AND landlord_id=${req.session.user.id}`);
  if (houseResult.length === 0) return res.redirect('/landlord/dashboard');

  const house = Object.fromEntries(houseResult[0].columns.map((c, i) => [c, houseResult[0].values[0][i]]));

  const imgResult = db.exec(`SELECT * FROM house_images WHERE house_id=${req.params.id}`);
  const images = imgResult.length === 0 ? [] : imgResult[0].values.map(row =>
    Object.fromEntries(imgResult[0].columns.map((c, i) => [c, row[i]])));

  const amenResult = db.exec(`SELECT * FROM amenities WHERE house_id=${req.params.id}`);
  const amenities = amenResult.length === 0 ? [] : amenResult[0].values.map(row =>
    Object.fromEntries(amenResult[0].columns.map((c, i) => [c, row[i]])));

  const bookResult = db.exec(`
    SELECT b.*, u.name as student_name, u.email as student_email
    FROM bookings b JOIN users u ON b.student_id = u.id
    WHERE b.house_id = ${req.params.id}
    ORDER BY b.created_at DESC
  `);
  const bookings = bookResult.length === 0 ? [] : bookResult[0].values.map(row =>
    Object.fromEntries(bookResult[0].columns.map((c, i) => [c, row[i]])));

  res.render('landlord/house-detail', { house, images, amenities, bookings });
};

const updateBooking = (req, res) => {
  const { status } = req.body;
  const db = getDB();
  db.run(`UPDATE bookings SET status=? WHERE id=?`, [status, req.params.id]);
  saveDB();
  res.redirect('back');
};

const deleteHouse = (req, res) => {
  const db = getDB();
  db.run(`DELETE FROM houses WHERE id=? AND landlord_id=?`, [req.params.id, req.session.user.id]);
  db.run(`DELETE FROM amenities WHERE house_id=?`, [req.params.id]);
  db.run(`DELETE FROM house_images WHERE house_id=?`, [req.params.id]);
  saveDB();
  res.redirect('/landlord/dashboard');
};

module.exports = { dashboard, showAddHouse, addHouse, showHouse, updateBooking, deleteHouse };
