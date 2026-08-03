const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { runMigrations } = require('./migrations');
const logger = require('./utils/logger');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, './kejahub.db');
let db;

async function initDB() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) throw new Error('ADMIN_PASSWORD env var is required');

  const adminExists = db.prepare(`SELECT id FROM users WHERE email = ?`).get('admin@kejahub.com');

  if (!adminExists) {
    const hashed = bcrypt.hashSync(adminPassword, 12);
    db.prepare(
      `INSERT INTO users (name, email, password, role, email_verified) VALUES (?, ?, ?, ?, 1)`
    ).run('Admin', 'admin@kejahub.com', hashed, 'admin');
  }

  try {
    seedSampleData(db);
  } catch (e) {
    logger.warn('Seed skipped', { message: e.message });
  }

  logger.info('KejaHub database ready');
}

// The demo accounts all share one password. It is deliberately not written down
// in this file: a literal here is a real credential as far as any secret scanner
// is concerned, and it would be the same on every checkout of this repo. Set
// SEED_PASSWORD to choose one, otherwise a random password is generated and
// printed once so a local developer can still sign in.
function resolveSeedPassword() {
  if (process.env.SEED_PASSWORD) return process.env.SEED_PASSWORD;

  const generated = crypto.randomBytes(9).toString('base64url');
  // Deliberately bypasses the structured logger: that JSON stream is meant to
  // be shipped to a log aggregator, and a generated credential has no
  // business ending up indexed there. This is a one-time, local-developer
  // convenience print, not an application log event.
  if (process.env.NODE_ENV !== 'test') {
    console.log(`Demo accounts seeded with password: ${generated}`);
    console.log('Set SEED_PASSWORD in .env to pick your own.');
  }
  return generated;
}

function seedSampleData(db) {
  // Never seed demo accounts into a production database.
  // Set SEED=true to override, e.g. for a staging environment.
  if (process.env.NODE_ENV === 'production' && process.env.SEED !== 'true') {
    logger.info('Seed skipped: NODE_ENV=production (set SEED=true to force)');
    return;
  }

  const { c: count } = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role != 'admin'`).get();
  if (count > 0) return;

  const pw = bcrypt.hashSync(resolveSeedPassword(), 10);
  // Seed accounts are already email-verified: nobody can click a link mailed
  // to a demo address, and the point of the seed data is to be usable
  // immediately.
  const insertUser = db.prepare(
    `INSERT INTO users (name,email,password,role,email_verified) VALUES (?,?,?,?,1)`
  );

  // ── Landlords ──────────────────────────────────────────────────────────────
  const landlordDefs = [
    ['James Kamau', 'james@landlord.com', '0712345678', '12345678', 1],
    ['Grace Njeri', 'grace@landlord.com', '0723456789', '87654321', 1],
    ['Peter Ochieng', 'peter@landlord.com', '0734567890', '23456789', 0],
    ['Mary Wairimu', 'mary@landlord.com', '0745678901', '34567890', 1],
    ['David Kimani', 'david@landlord.com', '0756789012', '45678901', 0],
    ['Sarah Muthoni', 'sarah@landlord.com', '0767890123', '56789012', 1],
  ];
  const insertLandlordProfile = db.prepare(
    `INSERT INTO landlord_profiles (user_id,phone,id_number,is_verified) VALUES (?,?,?,?)`
  );
  const llIds = [];
  for (const [name, email, phone, idnum, verified] of landlordDefs) {
    const { lastInsertRowid: uid } = insertUser.run(name, email, pw, 'landlord');
    llIds.push(uid);
    insertLandlordProfile.run(uid, phone, idnum, verified);
  }
  const [jamesId, graceId, peterId, maryId, davidId, sarahId] = llIds;

  // ── Students ───────────────────────────────────────────────────────────────
  const studentDefs = [
    [
      'Brian Otieno',
      'brian@student.com',
      '0711111111',
      'University of Nairobi',
      'Computer Science',
    ],
    [
      'Amina Wanjiru',
      'amina@student.com',
      '0722222222',
      'Strathmore University',
      'Business Administration',
    ],
    ['Kevin Mwangi', 'kevin@student.com', '0733333333', 'KCA University', 'Information Technology'],
    ['Faith Achieng', 'faith@student.com', '0744444444', 'Kenyatta University', 'Education'],
    [
      'Michael Njoroge',
      'michael@student.com',
      '0755555555',
      'Technical University of Kenya',
      'Mechanical Engineering',
    ],
    ['Sandra Gitau', 'sandra@student.com', '0766666666', 'Mount Kenya University', 'Nursing'],
    ['Patrick Oduya', 'patrick@student.com', '0777777777', 'Daystar University', 'Communications'],
    ['Lydia Kamau', 'lydia@student.com', '0788888888', 'USIU-Africa', 'Finance'],
    ['Moses Kirui', 'moses@student.com', '0799999999', 'JKUAT', 'Electrical Engineering'],
    ['Diana Mwende', 'diana@student.com', '0700111111', 'Catholic University of Kenya', 'Law'],
    ['Oscar Omondi', 'oscar@student.com', '0700222222', 'University of Nairobi', 'Medicine'],
    [
      'Pauline Wangari',
      'pauline@student.com',
      '0700333333',
      'Strathmore University',
      'Data Science',
    ],
  ];
  const insertStudentProfile = db.prepare(
    `INSERT INTO student_profiles (user_id,phone,university,course) VALUES (?,?,?,?)`
  );
  const stIds = [];
  for (const [name, email, phone, uni, course] of studentDefs) {
    const { lastInsertRowid: uid } = insertUser.run(name, email, pw, 'student');
    stIds.push(uid);
    insertStudentProfile.run(uid, phone, uni, course);
  }
  const [
    brianId,
    aminaId,
    kevinId,
    faithId,
    michaelId,
    sandraId,
    patrickId,
    lydiaId,
    mosesId,
    dianaId,
    oscarId,
    paulineId,
  ] = stIds;

  // ── Houses ─────────────────────────────────────────────────────────────────
  // [landlordId, title, description, rent, location, estate, bedrooms, bathrooms, status, rejectionReason]
  const houseDefs = [
    // James – 7 approved
    [
      jamesId,
      'Cozy Bedsitter Near Ngong Road',
      'Well-maintained bedsitter in a quiet compound near Ngong Road. Walking distance to shops and matatu stage. Ideal for single students.',
      9000,
      'Ngong Road',
      'Milimani Estate',
      1,
      1,
      'approved',
      null,
    ],
    [
      jamesId,
      'Modern 1-Bedroom in Westlands',
      'Spacious one-bedroom unit in the heart of Westlands. Perfect for students at nearby institutions. Secure compound with ample parking.',
      22000,
      'Westlands',
      'Parklands',
      1,
      1,
      'approved',
      null,
    ],
    [
      jamesId,
      'Spacious 2-Bedroom in Ruaka',
      'Affordable two-bedroom apartment in the fast-growing Ruaka area. Close to Ruaka town and major highways. Great value for money.',
      28000,
      'Ruaka',
      'Ruaka Town',
      2,
      1,
      'approved',
      null,
    ],
    [
      jamesId,
      'Budget Bedsitter in Rongai',
      'Clean and affordable bedsitter in Rongai, ideal for students at Multimedia University and nearby colleges. New bathroom fittings.',
      8000,
      'Rongai',
      'Tumaini Estate',
      1,
      1,
      'approved',
      null,
    ],
    [
      jamesId,
      '1-Bedroom Apartment in South B',
      'Well-appointed one-bedroom apartment in South B with easy access to the CBD and Karen. Newly painted and ready to move in.',
      18000,
      'South B',
      'Mombasa Road',
      1,
      1,
      'approved',
      null,
    ],
    [
      jamesId,
      'Affordable Bedsitter in Kikuyu',
      'Simple but clean bedsitter near University of Nairobi Kikuyu campus. Shared compound with secure gate and reliable water.',
      7000,
      'Kikuyu',
      'Kikuyu Town',
      1,
      1,
      'approved',
      null,
    ],
    [
      jamesId,
      'Nice 1-Bedroom in Ngong Town',
      'Comfortable one-bedroom house in Ngong town center. Easy matatu access to Nairobi and Rongai. Very quiet neighborhood.',
      12000,
      'Ngong',
      'Ngong Town',
      1,
      1,
      'approved',
      null,
    ],
    // Grace – 4 approved, 2 pending, 1 rejected
    [
      graceId,
      '2-Bedroom Unit in Kasarani',
      'Bright two-bedroom apartment near Thika Highway and Nairobi University Kasarani campus. All rooms ensuite. Excellent security.',
      25000,
      'Kasarani',
      'Seasons Estate',
      2,
      2,
      'approved',
      null,
    ],
    [
      graceId,
      "2-Bedroom in Lang'ata",
      "Quiet two-bedroom apartment in Lang'ata near Wilson Airport and Nairobi National Park. Close to Lang'ata shopping centre.",
      20000,
      "Lang'ata",
      'Langata Road',
      2,
      1,
      'approved',
      null,
    ],
    [
      graceId,
      'Cozy 1-Bedroom in Dagoretti',
      'Well-maintained one-bedroom apartment in Dagoretti Corner. Short walk to market and stage. Borehole water supply.',
      16000,
      'Dagoretti',
      'Dagoretti Corner',
      1,
      1,
      'approved',
      null,
    ],
    [
      graceId,
      '2-Bedroom in Roysambu',
      'Spacious two-bedroom apartment in Roysambu near university hostels. Modern kitchen and clean compound.',
      19000,
      'Roysambu',
      'Roysambu Estate',
      2,
      2,
      'approved',
      null,
    ],
    [
      graceId,
      'Bedsitter Near Thika Road',
      'Affordable bedsitter close to Thika Road with easy access to public transport and shopping malls.',
      10000,
      'Thika Road',
      'Clay City',
      1,
      1,
      'pending',
      null,
    ],
    [
      graceId,
      'Modern Studio in Kileleshwa',
      'Contemporary studio in upmarket Kileleshwa. Features modern finishes and 24-hour security.',
      35000,
      'Kileleshwa',
      'Kileleshwa Park',
      1,
      1,
      'pending',
      null,
    ],
    [
      graceId,
      'Studio Apartment Embakasi',
      'Studio apartment near Embakasi for students and young professionals.',
      12000,
      'Embakasi',
      'Syokimau',
      1,
      1,
      'rejected',
      'Listing photos do not match the actual property. Please resubmit with accurate photos.',
    ],
    // Peter – 4 approved, 1 pending
    [
      peterId,
      'Elegant 1-Bedroom in Kilimani',
      'Well-situated one-bedroom apartment in the prestigious Kilimani area. Close to major hospitals and schools. Good transport links.',
      26000,
      'Kilimani',
      'Kilimani Heights',
      1,
      1,
      'approved',
      null,
    ],
    [
      peterId,
      'Spacious 2-Bedroom in Karen',
      'Two-bedroom house in Karen with a beautiful garden. Ideal for a student couple or two housemates. Very quiet estate.',
      32000,
      'Karen',
      'Karen Estate',
      2,
      2,
      'approved',
      null,
    ],
    [
      peterId,
      'Modern Studio in Lavington',
      'Contemporary studio apartment in upmarket Lavington. Walking distance to international schools. Gated compound.',
      28000,
      'Lavington',
      'Lavington Green',
      1,
      1,
      'approved',
      null,
    ],
    [
      peterId,
      'Executive Studio in Gigiri',
      'High-end studio near Gigiri UN offices. Perfect for postgraduate students. Fully furnished option available.',
      38000,
      'Gigiri',
      'UN Avenue',
      1,
      1,
      'approved',
      null,
    ],
    [
      peterId,
      'Luxury 3-Bedroom in Ridgeways',
      'Spacious three-bedroom apartment in Ridgeways. Premium finishes throughout. Rooftop terrace access.',
      45000,
      'Ridgeways',
      'Ridgeways Estate',
      3,
      2,
      'pending',
      null,
    ],
    // Mary – 4 approved, 1 pending
    [
      maryId,
      '1-Bedroom in Parklands',
      'Comfortable one-bedroom apartment in leafy Parklands. Walking distance to Aga Khan Hospital. Very secure compound.',
      24000,
      'Parklands',
      'Parklands Estate',
      1,
      1,
      'approved',
      null,
    ],
    [
      maryId,
      'Budget Bedsitter in Eastleigh',
      'Affordable bedsitter in Eastleigh close to the business district and transport hub. Water 24/7. Good for working students.',
      7500,
      'Eastleigh',
      'Section 3',
      1,
      1,
      'approved',
      null,
    ],
    [
      maryId,
      '2-Bedroom in Umoja',
      'Value-for-money two-bedroom apartment in Umoja Estate. Close to Greenspan Mall and Mama Lucy Hospital. Ample parking.',
      16000,
      'Umoja',
      'Umoja 1',
      2,
      1,
      'approved',
      null,
    ],
    [
      maryId,
      '1-Bedroom in Thika Town',
      'Modern one-bedroom apartment in Thika town. Close to Thika Road Mall and various colleges. Reliable water and electricity.',
      11000,
      'Thika',
      'Thika Town',
      1,
      1,
      'approved',
      null,
    ],
    [
      maryId,
      'Bedsitter in Mlolongo',
      'Affordable bedsitter along Mombasa Road. Close to EPZ and several colleges. Good transport links.',
      9000,
      'Mlolongo',
      'Mlolongo Town',
      1,
      1,
      'pending',
      null,
    ],
    // David – 5 approved
    [
      davidId,
      'Studio in Nairobi CBD',
      'Compact studio in the heart of Nairobi CBD. Perfect for students who need to be central. All utilities included in rent.',
      15000,
      'Nairobi CBD',
      'Upper Hill',
      1,
      1,
      'approved',
      null,
    ],
    [
      davidId,
      '1-Bedroom in Buruburu',
      'Well-kept one-bedroom in Buruburu Phase 1. Quiet residential area with good amenities. Matatu to town at the doorstep.',
      13000,
      'Buruburu',
      'Buruburu Phase 1',
      1,
      1,
      'approved',
      null,
    ],
    [
      davidId,
      '2-Bedroom in Githurai',
      'Spacious two-bedroom apartment in Githurai 44. Close to shopping centres and several colleges. 24-hour security.',
      14000,
      'Githurai',
      'Githurai 44',
      2,
      1,
      'approved',
      null,
    ],
    [
      davidId,
      'Budget Bedsitter in Kahawa West',
      'Very affordable bedsitter in Kahawa West near JKUAT. Shared amenities. Close to matatu stage.',
      8500,
      'Kahawa West',
      'Kahawa West Estate',
      1,
      1,
      'approved',
      null,
    ],
    [
      davidId,
      '2-Bedroom in Ruiru',
      'Newly built two-bedroom apartment in Ruiru town. Clean and modern. Close to Ruiru train station.',
      15000,
      'Ruiru',
      'Ruiru Town',
      2,
      1,
      'approved',
      null,
    ],
    // Sarah – 4 approved
    [
      sarahId,
      '1-Bedroom in Kabete',
      'Comfortable one-bedroom near Kabete Technical Institute. Quiet estate with a good community feel. Reliable borehole water.',
      14000,
      'Kabete',
      'Kabete Estate',
      1,
      1,
      'approved',
      null,
    ],
    [
      sarahId,
      '2-Bedroom in Athi River',
      'Affordable two-bedroom apartment in Athi River (EPZ area). Close to Machakos University and several polytechnics.',
      11000,
      'Athi River',
      'Athi River Town',
      2,
      1,
      'approved',
      null,
    ],
    [
      sarahId,
      'Bedsitter Near Kiambu Road',
      'Cozy bedsitter near Kiambu Road. Easy access to Nairobi. Ideal for students at institutions along Kiambu Road.',
      9500,
      'Kiambu Road',
      'Cianda Estate',
      1,
      1,
      'approved',
      null,
    ],
    [
      sarahId,
      '2-Bedroom in Kitengela',
      'Modern two-bedroom apartment in Kitengela town. Close to several institutions. SGR station nearby for Nairobi commute.',
      13000,
      'Kitengela',
      'Kitengela Town',
      2,
      1,
      'approved',
      null,
    ],
  ];

  const insertHouse = db.prepare(
    `INSERT INTO houses (landlord_id,title,description,rent,location,estate,bedrooms,bathrooms,status,rejection_reason) VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  const houseIds = [];
  for (const h of houseDefs) {
    const { lastInsertRowid } = insertHouse.run(...h);
    houseIds.push(lastInsertRowid);
  }

  // ── Amenities (33 entries matching houseDefs order) ────────────────────────
  const amenMap = [
    // James (0-6)
    ['WiFi', 'Water', 'Electricity'],
    ['WiFi', 'Water', 'Electricity', 'Security', 'Parking'],
    ['Water', 'Electricity', 'Parking', 'Security'],
    ['Water', 'Electricity'],
    ['WiFi', 'Water', 'Electricity', 'Kitchen'],
    ['Water', 'Electricity'],
    ['WiFi', 'Water', 'Electricity'],
    // Grace (7-13)
    ['WiFi', 'Water', 'Electricity', 'Parking', 'Security', 'CCTV'],
    ['WiFi', 'Water', 'Electricity', 'Parking', 'Balcony'],
    ['Water', 'Electricity', 'Kitchen'],
    ['WiFi', 'Water', 'Electricity', 'Security', 'CCTV'],
    ['Water', 'Electricity'],
    ['WiFi', 'Water', 'Electricity', 'Furnished', 'Security', 'CCTV'],
    ['Water', 'Electricity'],
    // Peter (14-18)
    ['WiFi', 'Water', 'Electricity', 'Furnished', 'Security', 'CCTV'],
    ['WiFi', 'Water', 'Electricity', 'Parking', 'Security', 'Balcony'],
    ['WiFi', 'Water', 'Electricity', 'Furnished', 'Kitchen'],
    ['WiFi', 'Water', 'Electricity', 'Furnished', 'Security', 'CCTV', 'Balcony'],
    ['WiFi', 'Water', 'Electricity', 'Parking', 'Security', 'CCTV', 'Balcony'],
    // Mary (19-23)
    ['WiFi', 'Water', 'Electricity', 'Security'],
    ['Water', 'Electricity'],
    ['Water', 'Electricity', 'Parking', 'Security'],
    ['WiFi', 'Water', 'Electricity'],
    ['Water', 'Electricity'],
    // David (24-28)
    ['WiFi', 'Water', 'Electricity'],
    ['Water', 'Electricity', 'Kitchen'],
    ['Water', 'Electricity', 'Security'],
    ['Water', 'Electricity'],
    ['Water', 'Electricity', 'Security'],
    // Sarah (29-32)
    ['Water', 'Electricity', 'Kitchen'],
    ['Water', 'Electricity', 'Parking'],
    ['Water', 'Electricity'],
    ['WiFi', 'Water', 'Electricity', 'Security'],
  ];
  const insertAmenity = db.prepare(`INSERT INTO amenities (house_id,name) VALUES (?,?)`);
  amenMap.forEach((list, idx) => {
    list.forEach((name) => insertAmenity.run(houseIds[idx], name));
  });

  // ── Images (one placeholder per house) ────────────────────────────────────
  const insertImage = db.prepare(
    `INSERT INTO house_images (house_id,image_path,is_primary,sort_order) VALUES (?,?,?,?)`
  );
  houseIds.forEach((hId) => {
    insertImage.run(hId, '/images/background.jpg', 1, 0);
  });

  // ── Reviews (idx = houseIds index, only approved houses) ──────────────────
  const reviewDefs = [
    [0, brianId, 5, 'Great location, clean and affordable! The landlord is very responsive.'],
    [0, aminaId, 4, 'Good value for money. The compound is well maintained.'],
    [0, faithId, 4, 'Quiet neighborhood and easy access to Ngong Road stage. Recommended!'],
    [
      1,
      lydiaId,
      5,
      'Excellent apartment! Clean, secure and very convenient location in Westlands.',
    ],
    [1, sandraId, 4, 'Modern and well located apartment. A bit pricey but worth it.'],
    [
      2,
      kevinId,
      4,
      'Good value for a 2-bedroom in Ruaka. The area is growing fast with lots of amenities.',
    ],
    [3, michaelId, 4, 'Very affordable for students. Close to the stage and shops. Recommended!'],
    [3, patrickId, 3, 'Basic but clean. Good for students on a tight budget.'],
    [4, kevinId, 4, 'Well maintained property in a convenient location near South B stage.'],
    [4, oscarId, 5, 'Excellent house! Very easy access to CBD and great neighborhood.'],
    [5, dianaId, 3, 'Basic bedsitter but clean. Good price for the Kikuyu area.'],
    [6, paulineId, 4, 'Nice 1-bedroom in a quiet area. Landlord is friendly and responsive.'],
    [7, kevinId, 5, 'Excellent house in a secure estate. Highly recommend for students!'],
    [7, aminaId, 4, 'Nice neighborhood and the apartment is spacious.'],
    [7, mosesId, 5, 'Best apartment I have rented. Security is excellent and location is perfect.'],
    [8, brianId, 3, 'Decent place but could use some maintenance. Location is convenient though.'],
    [8, paulineId, 4, "Good location in Lang'ata. Landlord is helpful. Would recommend."],
    [9, faithId, 4, 'Clean and well-maintained apartment. Good water supply. Recommended.'],
    [10, sandraId, 4, 'Nice 2-bedroom in Roysambu. Good security and clean environment.'],
    [14, lydiaId, 5, 'Kilimani is a great area. The apartment is modern and well maintained.'],
    [14, dianaId, 4, 'Very nice apartment in a great neighborhood. Would recommend to others.'],
    [15, oscarId, 5, 'Loved the Karen house. Spacious and the garden is beautiful.'],
    [16, paulineId, 4, 'Modern studio in Lavington. Great finishes. A bit pricey but worth it.'],
    [17, mosesId, 4, 'Gigiri studio is well priced for the location. Very clean and modern.'],
    [19, patrickId, 4, 'Good apartment in Parklands. Very secure compound and clean.'],
    [20, sandraId, 3, 'Affordable option in Eastleigh. Gets the job done for students.'],
    [21, brianId, 4, 'Good value 2-bedroom in Umoja. Family neighborhood, very calm.'],
    [24, aminaId, 4, 'Convenient studio in CBD. Everything is walking distance. Great deal.'],
    [25, kevinId, 3, 'Basic 1-bedroom but good value in Buruburu. Quiet area.'],
    [26, faithId, 4, 'Githurai 2-bedroom is spacious for the price. Would recommend.'],
    [29, michaelId, 4, 'Good 1-bedroom in Kabete. Close to TI and other institutions.'],
    [30, lydiaId, 3, 'Athi River is far but affordable. Good for students near EPZ.'],
    [31, dianaId, 4, 'Nice bedsitter near Kiambu Road. Good transport links.'],
    [32, oscarId, 4, 'Kitengela is growing fast. Good modern 2-bedroom. SGR nearby is a plus.'],
  ];
  const insertReview = db.prepare(
    `INSERT INTO reviews (house_id,student_id,rating,comment) VALUES (?,?,?,?)`
  );
  for (const [idx, studentId, rating, comment] of reviewDefs) {
    insertReview.run(houseIds[idx], studentId, rating, comment);
  }

  // ── Bookings ───────────────────────────────────────────────────────────────
  const bookingDefs = [
    [
      houseIds[0],
      brianId,
      'viewing',
      'accepted',
      'I am a first-year student and would love to view the bedsitter.',
      '2026-06-10',
    ],
    [
      houseIds[1],
      aminaId,
      'viewing',
      'pending',
      'Interested in viewing the apartment. Available this weekend?',
      '2026-06-12',
    ],
    [
      houseIds[2],
      kevinId,
      'booking',
      'declined',
      'Looking for a 2-bedroom unit for myself and a colleague.',
      '2026-06-08',
    ],
    [
      houseIds[7],
      brianId,
      'viewing',
      'pending',
      'I would like to schedule a viewing for the Kasarani apartment.',
      '2026-06-15',
    ],
    [
      houseIds[4],
      faithId,
      'viewing',
      'accepted',
      'Hello, I am a student at JKUAT and interested in the 1-bedroom.',
      '2026-06-11',
    ],
    [
      houseIds[8],
      mosesId,
      'viewing',
      'pending',
      "Looking for accommodation in Lang'ata. Can I schedule a viewing?",
      '2026-06-18',
    ],
    [
      houseIds[14],
      lydiaId,
      'booking',
      'accepted',
      'I am a postgraduate student looking for a quality apartment.',
      '2026-06-09',
    ],
    [
      houseIds[3],
      michaelId,
      'viewing',
      'pending',
      'Looking for a budget bedsitter. The Rongai option seems ideal.',
      '2026-06-20',
    ],
    [
      houseIds[7],
      paulineId,
      'viewing',
      'pending',
      'Interested in the Kasarani apartment for next semester.',
      '2026-06-22',
    ],
    [
      houseIds[19],
      patrickId,
      'viewing',
      'pending',
      'Need a 1-bedroom in Parklands area. Would like to visit.',
      '2026-06-25',
    ],
    [
      houseIds[24],
      dianaId,
      'booking',
      'accepted',
      'The CBD studio is perfect for my law school schedule.',
      '2026-06-07',
    ],
    [
      houseIds[26],
      oscarId,
      'viewing',
      'declined',
      'Looking for accommodation near Githurai for medical rotations.',
      '2026-06-06',
    ],
    [
      houseIds[29],
      sandraId,
      'viewing',
      'pending',
      'Kabete is convenient for nursing school. Can I view the apartment?',
      '2026-06-28',
    ],
    [
      houseIds[32],
      aminaId,
      'viewing',
      'pending',
      'Kitengela suits my budget. Would like a viewing.',
      '2026-06-30',
    ],
  ];
  const insertBooking = db.prepare(
    `INSERT INTO bookings (house_id,student_id,type,status,message,visit_date) VALUES (?,?,?,?,?,?)`
  );
  for (const b of bookingDefs) {
    insertBooking.run(...b);
  }

  // ── Reports ────────────────────────────────────────────────────────────────
  const reportDefs = [
    [
      houseIds[1],
      kevinId,
      'The landlord listed incorrect amenities. WiFi is not actually available at this property.',
      'open',
    ],
    [
      houseIds[3],
      aminaId,
      'Photos do not match the actual property. The house appears much older in person.',
      'resolved',
    ],
    [
      houseIds[20],
      mosesId,
      'The listed rent is different from what the landlord quoted on the phone. Misleading listing.',
      'open',
    ],
    [
      houseIds[7],
      faithId,
      'Security guard is often absent despite being listed as a key amenity.',
      'resolved',
    ],
    [
      houseIds[25],
      lydiaId,
      'The 1-bedroom in Buruburu had a pest infestation that was not disclosed in the listing.',
      'open',
    ],
  ];
  const insertReport = db.prepare(
    `INSERT INTO reports (house_id,reported_by,reason,status) VALUES (?,?,?,?)`
  );
  for (const r of reportDefs) {
    insertReport.run(...r);
  }

  logger.info(
    'Sample data seeded: 6 landlords, 12 students, 33 houses, 34 reviews, 14 bookings, 5 reports'
  );
}

function getDB() {
  return db;
}

// better-sqlite3 writes through to disk on every statement, so there is no
// in-memory buffer to flush. Kept as a no-op export rather than deleting the
// ~25 call sites across the controllers that assumed a manual save step.
function saveDB() {}

function closeDB() {
  if (db) db.close();
}

function getDistinctLocations() {
  if (!db) return [];
  return db
    .prepare(
      `SELECT DISTINCT location FROM houses WHERE status='approved'
       AND location IS NOT NULL AND TRIM(location)!='' ORDER BY location ASC`
    )
    .all()
    .map((r) => r.location);
}

module.exports = { initDB, saveDB, closeDB, getDB, getDistinctLocations };
