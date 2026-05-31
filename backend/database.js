const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');


const DB_PATH = process.env.DB_PATH || path.join(__dirname, './kejahub.db');
let db;

async function initDB() {
  const SQL = await initSqlJs();

 if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  setInterval(() => {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }, 5000);

  // Users table (all roles)
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('student','landlord','admin')),
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Student profiles
  db.run(`CREATE TABLE IF NOT EXISTS student_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    phone TEXT,
    university TEXT,
    course TEXT,
    profile_photo TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Landlord profiles
  db.run(`CREATE TABLE IF NOT EXISTS landlord_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    phone TEXT,
    id_number TEXT,
    profile_photo TEXT,
    is_verified INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Houses
  db.run(`CREATE TABLE IF NOT EXISTS houses (
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

  // Amenities
  db.run(`CREATE TABLE IF NOT EXISTS amenities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    FOREIGN KEY(house_id) REFERENCES houses(id)
  )`);

  // House images
  db.run(`CREATE TABLE IF NOT EXISTS house_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER NOT NULL,
    image_path TEXT NOT NULL,
    is_primary INTEGER DEFAULT 0,
    FOREIGN KEY(house_id) REFERENCES houses(id)
  )`);

  // Bookings / viewing requests
  db.run(`CREATE TABLE IF NOT EXISTS bookings (
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

  // Reviews
  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    rating INTEGER CHECK(rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(house_id) REFERENCES houses(id),
    FOREIGN KEY(student_id) REFERENCES users(id)
  )`);

  // Reports
  db.run(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER NOT NULL,
    reported_by INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'open' CHECK(status IN ('open','resolved')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(house_id) REFERENCES houses(id),
    FOREIGN KEY(reported_by) REFERENCES users(id)
  )`);

  // Create default admin account
  const bcrypt = require('bcryptjs');
  const existing = db.exec(`SELECT id FROM users WHERE email='admin@kejahub.com'`);
  if (existing.length === 0) {
    const hashed = bcrypt.hashSync('admin123', 10);
    db.run(`INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
      ['Admin', 'admin@kejahub.com', hashed, 'admin']);
  }

  saveDB();
  console.log('KejaHub database ready ✅');
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function getDB() { return db; }

module.exports = { initDB, saveDB, getDB };
