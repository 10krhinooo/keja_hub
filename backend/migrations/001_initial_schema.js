// The original schema, from before versioned migrations existed. Kept as
// CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS so it's a no-op
// against a database that already has these tables (every pre-migrations
// checkout), while still building the full schema from scratch on a new one.
module.exports = {
  version: 1,
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student','landlord','admin')),
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS student_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      phone TEXT,
      university TEXT,
      course TEXT,
      profile_photo TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS landlord_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      phone TEXT,
      id_number TEXT,
      profile_photo TEXT,
      is_verified INTEGER DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS houses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      landlord_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      rent REAL NOT NULL,
      location TEXT NOT NULL,
      estate TEXT,
      bedrooms INTEGER DEFAULT 1,
      bathrooms INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      is_available INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(landlord_id) REFERENCES users(id)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS amenities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      house_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      FOREIGN KEY(house_id) REFERENCES houses(id)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS house_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      house_id INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      is_primary INTEGER DEFAULT 0,
      FOREIGN KEY(house_id) REFERENCES houses(id)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      house_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      type TEXT DEFAULT 'viewing' CHECK(type IN ('viewing','booking')),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
      message TEXT,
      visit_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(house_id) REFERENCES houses(id),
      FOREIGN KEY(student_id) REFERENCES users(id)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      house_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      rating INTEGER CHECK(rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(house_id) REFERENCES houses(id),
      FOREIGN KEY(student_id) REFERENCES users(id)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      house_id INTEGER NOT NULL,
      reported_by INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'open' CHECK(status IN ('open','resolved')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(house_id) REFERENCES houses(id),
      FOREIGN KEY(reported_by) REFERENCES users(id)
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at INTEGER NOT NULL
    )`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_house_images_house ON house_images(house_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_amenities_house    ON amenities(house_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bookings_house     ON bookings(house_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bookings_student   ON bookings(student_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_house      ON reviews(house_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reports_house      ON reports(house_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_houses_landlord    ON houses(landlord_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_houses_status      ON houses(status, is_available)`);
  },
};
