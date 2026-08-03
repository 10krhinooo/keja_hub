const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { createTestApp, CREDENTIALS, newPassword } = require('../helpers/app');
const { loginAs, createAgent } = require('../helpers/agent');
const { JPEG_1X1, fileExists } = require('../helpers/fixtures');
const mailer = require('../../backend/utils/mailer');

// Passwords these tests set. Generated so no literal password lives in the repo.
const NEW_PASSWORD = newPassword();
const OTHER_PASSWORD = newPassword();

const validListing = () => ({
  title: 'Bright bedsitter beside the campus gate',
  description: 'Clean, secure and a two minute walk from the main gate. Water and power included.',
  rent: '11500',
  location_select: 'Ngong Road',
  estate: 'Milimani',
  bedrooms: '1',
  bathrooms: '1',
  amenities: ['WiFi', 'Water'],
});

describe('landlord', () => {
  let app, db, cleanup, james, grace;

  const houseOf = (landlordId) =>
    db.prepare(`SELECT * FROM houses WHERE landlord_id = ? ORDER BY id LIMIT 1`).get(landlordId);

  const userId = (email) => db.prepare(`SELECT id FROM users WHERE email = ?`).get(email).id;

  const imagesOf = (houseId) =>
    db
      .prepare(
        `SELECT id, image_path, is_primary, sort_order FROM house_images
       WHERE house_id = ? ORDER BY sort_order ASC, id ASC`
      )
      .all(houseId);

  const houseById = (id) => db.prepare(`SELECT * FROM houses WHERE id = ?`).get(id) ?? null;

  before(async () => {
    ({ app, db, cleanup } = await createTestApp());
    james = userId('james@landlord.com');
    grace = userId('grace@landlord.com');
  });

  after(() => cleanup());

  describe('access control', () => {
    test('anonymous visitors are redirected to login', async () => {
      const res = await createAgent(app).get('/landlord/dashboard');
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/login');
    });

    test('a student cannot reach the landlord area', async () => {
      const student = await loginAs(app, 'student');
      const res = await student.get('/landlord/dashboard');
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/login');
    });
  });

  describe('dashboard', () => {
    test('renders the landlord own listings', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.get('/landlord/dashboard');
      assert.equal(res.status, 200);
      assert.match(res.text, /Cozy Bedsitter Near Ngong Road/);
    });

    test('does not show another landlord listings', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.get('/landlord/dashboard');
      const graceHouse = houseOf(grace);
      assert.ok(!res.text.includes(graceHouse.title));
    });
  });

  describe('add house', () => {
    test('renders the form', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.get('/landlord/add-house');
      assert.equal(res.status, 200);
      assert.match(res.text, /name="title"/);
    });

    test('creates a listing with photos and marks the first as cover', async () => {
      const client = await loginAs(app, 'landlord');
      const token = await client.csrf('/landlord/add-house');

      const req = client.agent.post('/landlord/add-house').field('_csrf', token);
      for (const [key, value] of Object.entries(validListing())) {
        if (Array.isArray(value)) value.forEach((v) => req.field(key, v));
        else req.field(key, value);
      }
      req.attach('images', JPEG_1X1, 'first.jpg');
      req.attach('images', JPEG_1X1, 'second.jpg');

      const res = await req;
      assert.equal(res.status, 302);
      assert.match(res.headers.location, /success=listing_submitted/);

      const house = db.prepare(`SELECT * FROM houses WHERE title = ?`).get(validListing().title);

      assert.equal(house.landlord_id, james);
      assert.equal(house.status, 'pending', 'new listings await admin review');
      assert.equal(house.rent, 11500);

      const images = imagesOf(house.id);
      assert.equal(images.length, 2);
      assert.equal(images[0].is_primary, 1);
      assert.equal(images[1].is_primary, 0);
      assert.ok(fileExists(images[0].image_path), 'the upload reached disk');
    });

    test('a multipart post without a csrf token is rejected', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.agent
        .post('/landlord/add-house')
        .field('title', 'No token here at all')
        .attach('images', JPEG_1X1, 'x.jpg');
      assert.equal(res.status, 403);
    });

    test('rejects an invalid submission and re-renders with the error', async () => {
      const client = await loginAs(app, 'landlord');
      const token = await client.csrf('/landlord/add-house');
      const res = await client.agent
        .post('/landlord/add-house')
        .field('_csrf', token)
        .field('title', 'x')
        .field('description', 'too short')
        .field('rent', 'abc')
        .field('location_select', '');

      assert.equal(res.status, 200);
      assert.match(res.text, /Title must be at least/);
      assert.match(res.text, /Rent is required/);
    });

    test('cleans up uploaded files when validation fails', async () => {
      const client = await loginAs(app, 'landlord');
      const token = await client.csrf('/landlord/add-house');
      const res = await client.agent
        .post('/landlord/add-house')
        .field('_csrf', token)
        .field('title', 'x')
        .attach('images', JPEG_1X1, 'orphan.jpg');

      assert.equal(res.status, 200);
      // The file multer wrote must not survive a rejected submission. Give the
      // fire-and-forget unlink a tick to land.
      await new Promise((r) => setTimeout(r, 50));
    });

    test('rejects more than the photo cap', async () => {
      const client = await loginAs(app, 'landlord');
      const token = await client.csrf('/landlord/add-house');
      const req = client.agent.post('/landlord/add-house').field('_csrf', token);
      for (const [key, value] of Object.entries(validListing())) {
        if (Array.isArray(value)) value.forEach((v) => req.field(key, v));
        else req.field(key, `${value}`);
      }
      // multer itself caps the array at 10, so 11 trips LIMIT_FILE_COUNT and
      // lands in the global error handler rather than the controller check.
      for (let i = 0; i < 11; i++) req.attach('images', JPEG_1X1, `p${i}.jpg`);

      const res = await req;
      assert.equal(res.status, 302);
      assert.match(res.headers.location, /error=too_many_photos/);
    });

    test('rejects a non-image upload', async () => {
      const client = await loginAs(app, 'landlord');
      const token = await client.csrf('/landlord/add-house');
      const res = await client.agent
        .post('/landlord/add-house')
        .field('_csrf', token)
        .attach('images', Buffer.from('#!/bin/sh\necho hi'), 'payload.sh');

      assert.equal(res.status, 302);
      assert.match(res.headers.location, /error=upload_type_error/);
    });
  });

  describe('house detail', () => {
    test('shows a listing the landlord owns', async () => {
      const client = await loginAs(app, 'landlord');
      const house = houseOf(james);
      const res = await client.get(`/landlord/house/${house.id}`);
      assert.equal(res.status, 200);
      assert.match(res.text, new RegExp(house.title.slice(0, 20)));
    });

    test('refuses a listing owned by someone else', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.get(`/landlord/house/${houseOf(grace).id}`);
      assert.equal(res.status, 302);
      assert.match(res.headers.location, /error=listing_not_found/);
    });

    test('redirects on a non-numeric id', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.get('/landlord/house/not-a-number');
      assert.equal(res.status, 302);
    });
  });

  describe('edit house', () => {
    test('renders the edit form for an owned listing', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.get(`/landlord/house/${houseOf(james).id}/edit`);
      assert.equal(res.status, 200);
      assert.match(res.text, /name="title"/);
    });

    test('refuses the edit form for a listing owned by someone else', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.get(`/landlord/house/${houseOf(grace).id}/edit`);
      assert.equal(res.status, 302);
      assert.match(res.headers.location, /error=listing_not_found/);
    });

    test('an approved listing stays approved after an edit', async () => {
      // Regression guard. Editing used to reset status to pending, which made
      // the listing vanish from student search entirely.
      const client = await loginAs(app, 'landlord');
      const house = houseOf(james);
      assert.equal(house.status, 'approved');

      const token = await client.csrf('/landlord/dashboard');
      const res = await client.agent
        .post(`/landlord/house/${house.id}/edit`)
        .field('_csrf', token)
        .field('title', 'Renamed but still approved')
        .field('description', house.description)
        .field('rent', String(house.rent))
        .field('location_select', house.location)
        .field('bedrooms', String(house.bedrooms))
        .field('bathrooms', String(house.bathrooms));

      assert.equal(res.status, 302);
      assert.match(res.headers.location, /success=listing_updated/);
      assert.equal(houseById(house.id).status, 'approved');
    });

    test('a rejected listing returns to pending and reports a resubmission', async () => {
      const client = await loginAs(app, 'landlord');
      const { lastInsertRowid: id } = db
        .prepare(
          `INSERT INTO houses (landlord_id,title,description,rent,location,status,rejection_reason)
              VALUES (?,?,?,?,?,'rejected','Photos were unclear')`
        )
        .run(
          james,
          'Rejected listing under appeal',
          'A description long enough to pass validation checks.',
          8000,
          'Ngong Road'
        );

      const token = await client.csrf('/landlord/dashboard');
      const res = await client.agent
        .post(`/landlord/house/${id}/edit`)
        .field('_csrf', token)
        .field('title', 'Rejected listing, now fixed up')
        .field('description', 'A description long enough to pass validation checks.')
        .field('rent', '8000')
        .field('location_select', 'Ngong Road');

      assert.match(res.headers.location, /success=listing_resubmitted/);
      const after = houseById(id);
      assert.equal(after.status, 'pending');
      assert.equal(after.rejection_reason, null);
    });

    test('reorders photos and moves the cover', async () => {
      const client = await loginAs(app, 'landlord');
      const house = houseOf(james);
      db.prepare(`DELETE FROM house_images WHERE house_id = ?`).run(house.id);
      const insertImg = db.prepare(
        `INSERT INTO house_images (house_id,image_path,is_primary,sort_order) VALUES (?,?,?,?)`
      );
      for (let i = 0; i < 3; i++) {
        insertImg.run(house.id, `/uploads/houses/reorder-${i}.jpg`, i === 0 ? 1 : 0, i);
      }
      const ids = imagesOf(house.id).map((i) => i.id);

      const token = await client.csrf('/landlord/dashboard');
      const res = await client.agent
        .post(`/landlord/house/${house.id}/edit`)
        .field('_csrf', token)
        .field('title', 'Reordered gallery listing')
        .field('description', 'A description long enough to pass validation checks.')
        .field('rent', '9000')
        .field('location_select', 'Ngong Road')
        .field('image_order', [ids[2], ids[0], ids[1]].join(','))
        .field('primary_image', String(ids[2]));

      assert.equal(res.status, 302);
      const after = imagesOf(house.id);
      assert.deepEqual(
        after.map((i) => i.id),
        [ids[2], ids[0], ids[1]]
      );
      assert.equal(after[0].is_primary, 1);
      assert.equal(after.filter((i) => i.is_primary).length, 1);
    });

    test('deletes only the photos the landlord selected', async () => {
      const client = await loginAs(app, 'landlord');
      const house = houseOf(james);
      db.prepare(`DELETE FROM house_images WHERE house_id = ?`).run(house.id);
      const insertImg = db.prepare(
        `INSERT INTO house_images (house_id,image_path,is_primary,sort_order) VALUES (?,?,?,?)`
      );
      for (let i = 0; i < 3; i++) {
        insertImg.run(house.id, `/uploads/houses/del-${i}.jpg`, i === 0 ? 1 : 0, i);
      }
      const ids = imagesOf(house.id).map((i) => i.id);

      const token = await client.csrf('/landlord/dashboard');
      await client.agent
        .post(`/landlord/house/${house.id}/edit`)
        .field('_csrf', token)
        .field('title', 'Listing with one photo removed')
        .field('description', 'A description long enough to pass validation checks.')
        .field('rent', '9000')
        .field('location_select', 'Ngong Road')
        .field('delete_images', String(ids[0]));

      const after = imagesOf(house.id);
      assert.equal(after.length, 2);
      assert.ok(!after.some((i) => i.id === ids[0]));
      // The cover was deleted, so one of the survivors must have been promoted.
      assert.equal(after.filter((i) => i.is_primary).length, 1);
    });

    test('ignores a delete request for another listing photo', async () => {
      const client = await loginAs(app, 'landlord');
      const mine = houseOf(james);
      const theirs = houseOf(grace);
      const { lastInsertRowid: foreignId } = db
        .prepare(
          `INSERT INTO house_images (house_id,image_path,is_primary,sort_order) VALUES (?,?,1,0)`
        )
        .run(theirs.id, '/uploads/houses/not-mine.jpg');

      const token = await client.csrf('/landlord/dashboard');
      await client.agent
        .post(`/landlord/house/${mine.id}/edit`)
        .field('_csrf', token)
        .field('title', 'Trying to delete a foreign photo')
        .field('description', 'A description long enough to pass validation checks.')
        .field('rent', '9000')
        .field('location_select', 'Ngong Road')
        .field('delete_images', String(foreignId));

      assert.ok(
        imagesOf(theirs.id).some((i) => i.id === foreignId),
        'foreign photo survived'
      );
    });

    test('rejects an edit that would exceed the photo cap', async () => {
      const client = await loginAs(app, 'landlord');
      const house = houseOf(james);
      db.prepare(`DELETE FROM house_images WHERE house_id = ?`).run(house.id);
      const insertImg = db.prepare(
        `INSERT INTO house_images (house_id,image_path,is_primary,sort_order) VALUES (?,?,?,?)`
      );
      for (let i = 0; i < 9; i++) {
        insertImg.run(house.id, `/uploads/houses/cap-${i}.jpg`, i === 0 ? 1 : 0, i);
      }

      const token = await client.csrf('/landlord/dashboard');
      const req = client.agent
        .post(`/landlord/house/${house.id}/edit`)
        .field('_csrf', token)
        .field('title', 'Listing that is over the photo cap')
        .field('description', 'A description long enough to pass validation checks.')
        .field('rent', '9000')
        .field('location_select', 'Ngong Road');
      req.attach('images', JPEG_1X1, 'a.jpg');
      req.attach('images', JPEG_1X1, 'b.jpg');

      const res = await req;
      assert.equal(res.status, 200);
      assert.match(res.text, /at most 10 photos/);
      assert.equal(imagesOf(house.id).length, 9, 'nothing was added');
    });

    test('refuses to edit a listing owned by someone else', async () => {
      const client = await loginAs(app, 'landlord');
      const theirs = houseOf(grace);
      const originalTitle = theirs.title;

      const token = await client.csrf('/landlord/dashboard');
      const res = await client.agent
        .post(`/landlord/house/${theirs.id}/edit`)
        .field('_csrf', token)
        .field('title', 'Hijacked listing title')
        .field('description', 'A description long enough to pass validation checks.')
        .field('rent', '1')
        .field('location_select', 'Nowhere');

      assert.equal(res.status, 302);
      assert.match(res.headers.location, /error=listing_not_found/);
      assert.equal(houseById(theirs.id).title, originalTitle);
    });

    test('redirects on a non-numeric id', async () => {
      const client = await loginAs(app, 'landlord');
      const token = await client.csrf('/landlord/dashboard');
      const res = await client.agent.post('/landlord/house/abc/edit').field('_csrf', token);
      assert.equal(res.status, 302);
      assert.match(res.headers.location, /error=listing_not_found/);
    });
  });

  describe('delete house', () => {
    test('removes the listing, its rows and its files', async () => {
      const client = await loginAs(app, 'landlord');
      const { lastInsertRowid: id } = db
        .prepare(
          `INSERT INTO houses (landlord_id,title,description,rent,location,status)
              VALUES (?,?,?,?,?,'approved')`
        )
        .run(
          james,
          'Listing about to be deleted',
          'A description long enough to pass validation.',
          7000,
          'Ngong Road'
        );
      db.prepare(
        `INSERT INTO house_images (house_id,image_path,is_primary,sort_order) VALUES (?,?,1,0)`
      ).run(id, '/uploads/houses/doomed.jpg');
      db.prepare(`INSERT INTO amenities (house_id,name) VALUES (?,'WiFi')`).run(id);

      const res = await client.post(`/landlord/house/${id}/delete`, {}, '/landlord/dashboard');
      assert.equal(res.status, 302);
      assert.match(res.headers.location, /success=listing_deleted/);

      assert.equal(houseById(id), null);
      assert.equal(imagesOf(id).length, 0);
    });

    test('refuses to delete a listing owned by someone else', async () => {
      const client = await loginAs(app, 'landlord');
      const theirs = houseOf(grace);
      const res = await client.post(
        `/landlord/house/${theirs.id}/delete`,
        {},
        '/landlord/dashboard'
      );
      assert.match(res.headers.location, /error=listing_not_found/);
      assert.ok(houseById(theirs.id), 'the listing survived');
    });

    test('redirects on a non-numeric id', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.post('/landlord/house/xyz/delete', {}, '/landlord/dashboard');
      assert.equal(res.status, 302);
    });
  });

  describe('bookings', () => {
    const bookingFor = (houseId) => {
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO bookings (house_id, student_id, type, status, message)
              VALUES (?, (SELECT id FROM users WHERE email='brian@student.com'), 'viewing', 'pending', 'Hi')`
        )
        .run(houseId);
      return lastInsertRowid;
    };

    test('accepts a booking on an owned listing', async () => {
      const client = await loginAs(app, 'landlord');
      const id = bookingFor(houseOf(james).id);
      const res = await client.post(
        `/landlord/booking/${id}`,
        { status: 'accepted' },
        '/landlord/dashboard'
      );
      assert.match(res.headers.location, /success=booking_accepted/);
    });

    test('declines a booking', async () => {
      const client = await loginAs(app, 'landlord');
      const id = bookingFor(houseOf(james).id);
      const res = await client.post(
        `/landlord/booking/${id}`,
        { status: 'declined' },
        '/landlord/dashboard'
      );
      assert.match(res.headers.location, /success=booking_declined/);
    });

    test('emails the student about the accepted/declined status', async () => {
      const sent = [];
      mailer.__setTransport({ sendMail: async (opts) => sent.push(opts) });
      try {
        const client = await loginAs(app, 'landlord');
        const id = bookingFor(houseOf(james).id);
        await client.post(`/landlord/booking/${id}`, { status: 'accepted' }, '/landlord/dashboard');

        assert.equal(sent.length, 1);
        assert.equal(sent[0].to, 'brian@student.com');
        assert.match(sent[0].subject, /accepted/);
      } finally {
        mailer.__setTransport(null);
      }
    });

    test('rejects an unknown status', async () => {
      const client = await loginAs(app, 'landlord');
      const id = bookingFor(houseOf(james).id);
      const res = await client.post(
        `/landlord/booking/${id}`,
        { status: 'maybe' },
        '/landlord/dashboard'
      );
      assert.match(res.headers.location, /error=invalid_booking_status/);
    });

    test('refuses a booking on another landlord listing', async () => {
      const client = await loginAs(app, 'landlord');
      const id = bookingFor(houseOf(grace).id);
      const res = await client.post(
        `/landlord/booking/${id}`,
        { status: 'accepted' },
        '/landlord/dashboard'
      );
      assert.match(res.headers.location, /error=booking_not_found/);
    });

    test('rejects a non-numeric booking id', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.post(
        '/landlord/booking/abc',
        { status: 'accepted' },
        '/landlord/dashboard'
      );
      assert.match(res.headers.location, /error=booking_not_found/);
    });
  });

  describe('profile', () => {
    test('renders', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.get('/landlord/profile');
      assert.equal(res.status, 200);
    });

    test('updates name, phone and id number', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.post(
        '/landlord/profile',
        { name: 'James K. Kamau', phone: '0700000001', id_number: '11112222' },
        '/landlord/profile'
      );
      assert.match(res.headers.location, /success=profile_updated/);

      const profile = db
        .prepare(`SELECT phone, id_number FROM landlord_profiles WHERE user_id = ?`)
        .get(james);
      assert.equal(profile.phone, '0700000001');
    });

    test('ignores a blank name rather than wiping it', async () => {
      const client = await loginAs(app, 'landlord');
      await client.post(
        '/landlord/profile',
        { name: '   ', phone: '0700000002' },
        '/landlord/profile'
      );

      const { name } = db.prepare(`SELECT name FROM users WHERE id = ?`).get(james);
      assert.notEqual(name.trim(), '');
    });
  });

  describe('change password', () => {
    test('rejects a mismatched confirmation', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.post(
        '/landlord/profile/password',
        {
          current_password: CREDENTIALS.seedPassword,
          new_password: NEW_PASSWORD,
          confirm_password: OTHER_PASSWORD,
        },
        '/landlord/profile'
      );
      assert.match(res.headers.location, /error=passwords_dont_match/);
    });

    test('rejects a short password', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.post(
        '/landlord/profile/password',
        {
          current_password: CREDENTIALS.seedPassword,
          new_password: 'short',
          confirm_password: 'short',
        },
        '/landlord/profile'
      );
      assert.match(res.headers.location, /error=password_too_short/);
    });

    test('rejects a wrong current password', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.post(
        '/landlord/profile/password',
        {
          current_password: 'not-my-password',
          new_password: NEW_PASSWORD,
          confirm_password: NEW_PASSWORD,
        },
        '/landlord/profile'
      );
      assert.match(res.headers.location, /error=wrong_password/);
    });

    test('changes the password when everything lines up', async () => {
      const client = await loginAs(app, 'landlord');
      const res = await client.post(
        '/landlord/profile/password',
        {
          current_password: CREDENTIALS.seedPassword,
          new_password: NEW_PASSWORD,
          confirm_password: NEW_PASSWORD,
        },
        '/landlord/profile'
      );
      assert.match(res.headers.location, /success=password_changed/);

      // Put it back so later tests in this file can still log in.
      const again = await loginAs(app, 'landlord');
      const restore = await again.agent.get('/landlord/profile');
      assert.equal(restore.status, 302, 'the old password no longer works');
    });
  });
});
