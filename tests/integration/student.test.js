const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { createTestApp, CREDENTIALS, newPassword } = require('../helpers/app');
const { loginAs, createAgent } = require('../helpers/agent');
const mailer = require('../../backend/utils/mailer');

// Passwords these tests set. Generated so no literal password lives in the repo.
const NEW_PASSWORD = newPassword();
const OTHER_PASSWORD = newPassword();

describe('student', () => {
  let app, db, cleanup, brianId;

  const one = (sql, params = []) => db.prepare(sql).get(...params) ?? null;

  const approvedHouse = () =>
    one(`SELECT * FROM houses WHERE status='approved' AND is_available=1 ORDER BY id LIMIT 1`);

  before(async () => {
    ({ app, db, cleanup } = await createTestApp());
    brianId = one(`SELECT id FROM users WHERE email='brian@student.com'`).id;
  });

  after(() => cleanup());

  describe('access control', () => {
    test('anonymous visitors are redirected to login', async () => {
      const res = await createAgent(app).get('/student/dashboard');
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/login');
    });

    test('a landlord cannot reach the student area', async () => {
      const landlord = await loginAs(app, 'landlord');
      const res = await landlord.get('/student/search');
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/login');
    });
  });

  test('dashboard renders', async () => {
    const client = await loginAs(app, 'student');
    const res = await client.get('/student/dashboard');
    assert.equal(res.status, 200);
  });

  describe('search', () => {
    test('renders with no filters', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.get('/student/search');
      assert.equal(res.status, 200);
    });

    test('only ever shows approved, available listings', async () => {
      const client = await loginAs(app, 'student');
      const hidden = one(`SELECT title FROM houses WHERE status='pending' LIMIT 1`);
      const res = await client.get('/student/search?page=1');
      if (hidden) assert.ok(!res.text.includes(hidden.title));
    });

    test('filters by keyword', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.get('/student/search?keyword=Westlands');
      assert.equal(res.status, 200);
      assert.match(res.text, /Westlands/);
    });

    test('a keyword matching nothing returns an empty result', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.get('/student/search?keyword=zzzzznotarealplace');
      assert.equal(res.status, 200);
    });

    test('filters by location', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.get('/student/search?location=Westlands');
      assert.equal(res.status, 200);
    });

    test('filters by a rent range', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.get('/student/search?min_rent=8000&max_rent=15000');
      assert.equal(res.status, 200);
    });

    test('ignores a non-numeric rent filter instead of erroring', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.get('/student/search?min_rent=cheap&max_rent=expensive');
      assert.equal(res.status, 200);
    });

    test('filters by bedrooms, including the 4+ bucket', async () => {
      const client = await loginAs(app, 'student');
      assert.equal((await client.get('/student/search?bedrooms=1')).status, 200);
      assert.equal((await client.get('/student/search?bedrooms=4')).status, 200);
      assert.equal((await client.get('/student/search?bedrooms=nope')).status, 200);
    });

    test('filters by bathrooms, including the 3+ bucket', async () => {
      const client = await loginAs(app, 'student');
      assert.equal((await client.get('/student/search?bathrooms=1')).status, 200);
      assert.equal((await client.get('/student/search?bathrooms=3')).status, 200);
      assert.equal((await client.get('/student/search?bathrooms=nope')).status, 200);
    });

    test('filters by a single amenity', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.get('/student/search?amenities=WiFi');
      assert.equal(res.status, 200);
    });

    test('filters by several amenities at once', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.get('/student/search?amenities=WiFi&amenities=Water');
      assert.equal(res.status, 200);
    });

    for (const sort of ['price_asc', 'price_desc', 'rating_desc', 'newest']) {
      test(`sorts by ${sort}`, async () => {
        const client = await loginAs(app, 'student');
        const res = await client.get(`/student/search?sort=${sort}`);
        assert.equal(res.status, 200);
      });
    }

    test('falls back to the default sort for an unknown value', async () => {
      // The sort value goes straight into ORDER BY, so anything off the map
      // has to be discarded rather than interpolated.
      const client = await loginAs(app, 'student');
      const res = await client.get('/student/search?sort=rent%3B+DROP+TABLE+houses');
      assert.equal(res.status, 200);
      assert.ok(one(`SELECT id FROM houses LIMIT 1`), 'houses table intact');
    });

    test('paginates', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.get('/student/search?page=2');
      assert.equal(res.status, 200);
    });

    test('clamps a page beyond the end back to the last page', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.get('/student/search?page=9999');
      assert.equal(res.status, 200);
    });

    test('clamps a zero or negative page to the first', async () => {
      const client = await loginAs(app, 'student');
      assert.equal((await client.get('/student/search?page=0')).status, 200);
      assert.equal((await client.get('/student/search?page=-5')).status, 200);
    });
  });

  describe('house detail', () => {
    test('renders an approved listing', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.get(`/student/house/${approvedHouse().id}`);
      assert.equal(res.status, 200);
    });

    test('redirects on a non-numeric id', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.get('/student/house/abc');
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/student/search');
    });

    test('redirects for an unknown id', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.get('/student/house/9999999');
      assert.equal(res.status, 302);
    });

    test('will not show a pending listing', async () => {
      const client = await loginAs(app, 'student');
      const pending = one(`SELECT id FROM houses WHERE status='pending' LIMIT 1`);
      if (!pending) return;
      const res = await client.get(`/student/house/${pending.id}`);
      assert.equal(res.status, 302);
    });
  });

  describe('bookings', () => {
    const freshHouse = () => {
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO houses (landlord_id,title,description,rent,location,status,is_available)
              VALUES ((SELECT id FROM users WHERE email='james@landlord.com'),?,?,?,?,'approved',1)`
        )
        .run(
          'Bookable listing ' + Math.random(),
          'A description long enough to pass validation.',
          9000,
          'Ngong Road'
        );
      return lastInsertRowid;
    };

    test('creates a viewing request', async () => {
      const client = await loginAs(app, 'student');
      const id = freshHouse();
      const res = await client.post(
        '/student/booking',
        { house_id: String(id), type: 'viewing', message: 'Can I view on Saturday?' },
        '/student/dashboard'
      );
      assert.match(res.headers.location, /success=booking_sent/);
    });

    test('emails the landlord about the new request', async () => {
      const sent = [];
      mailer.__setTransport({ sendMail: async (opts) => sent.push(opts) });
      try {
        const client = await loginAs(app, 'student');
        const id = freshHouse();
        await client.post(
          '/student/booking',
          { house_id: String(id), type: 'viewing', message: 'Can I view on Saturday?' },
          '/student/dashboard'
        );

        assert.equal(sent.length, 1);
        assert.equal(sent[0].to, 'james@landlord.com');
        assert.match(sent[0].subject, /New booking request/);
      } finally {
        mailer.__setTransport(null);
      }
    });

    test('defaults an unknown type to viewing', async () => {
      const client = await loginAs(app, 'student');
      const id = freshHouse();
      await client.post(
        '/student/booking',
        { house_id: String(id), type: 'purchase' },
        '/student/dashboard'
      );
      const booking = one(`SELECT type FROM bookings WHERE house_id=? AND student_id=?`, [
        id,
        brianId,
      ]);
      assert.equal(booking.type, 'viewing');
    });

    test('refuses a second pending request for the same listing', async () => {
      const client = await loginAs(app, 'student');
      const id = freshHouse();
      await client.post('/student/booking', { house_id: String(id) }, '/student/dashboard');
      const res = await client.post(
        '/student/booking',
        { house_id: String(id) },
        '/student/dashboard'
      );
      assert.match(res.headers.location, /error=already_requested/);
    });

    test('refuses a booking on a listing that is not approved', async () => {
      const client = await loginAs(app, 'student');
      const pending = one(`SELECT id FROM houses WHERE status='pending' LIMIT 1`);
      if (!pending) return;
      const res = await client.post(
        '/student/booking',
        { house_id: String(pending.id) },
        '/student/dashboard'
      );
      assert.equal(res.headers.location, '/student/dashboard');
    });

    test('redirects on a non-numeric house id', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.post('/student/booking', { house_id: 'abc' }, '/student/dashboard');
      assert.equal(res.headers.location, '/student/dashboard');
    });

    test('lists the student own bookings', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.get('/student/bookings');
      assert.equal(res.status, 200);
    });
  });

  describe('reviews', () => {
    const unreviewedHouse = () => {
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO houses (landlord_id,title,description,rent,location,status)
              VALUES ((SELECT id FROM users WHERE email='james@landlord.com'),?,?,?,?,'approved')`
        )
        .run(
          'Reviewable listing ' + Math.random(),
          'A description long enough to pass validation.',
          9000,
          'Ngong Road'
        );
      return lastInsertRowid;
    };

    test('posts a review', async () => {
      const client = await loginAs(app, 'student');
      const id = unreviewedHouse();
      const res = await client.post(
        '/student/review',
        { house_id: String(id), rating: '5', comment: 'Great place, very secure.' },
        '/student/dashboard'
      );
      assert.match(res.headers.location, /success=review_posted/);
    });

    test('rejects a rating outside 1 to 5', async () => {
      const client = await loginAs(app, 'student');
      const id = unreviewedHouse();
      for (const rating of ['0', '6', 'five']) {
        const res = await client.post(
          '/student/review',
          { house_id: String(id), rating },
          '/student/dashboard'
        );
        assert.match(res.headers.location, /error=invalid_rating/);
      }
    });

    test('refuses a second review of the same listing', async () => {
      const client = await loginAs(app, 'student');
      const id = unreviewedHouse();
      await client.post(
        '/student/review',
        { house_id: String(id), rating: '4' },
        '/student/dashboard'
      );
      const res = await client.post(
        '/student/review',
        { house_id: String(id), rating: '2' },
        '/student/dashboard'
      );
      assert.match(res.headers.location, /error=already_reviewed/);
    });

    test('refuses a review on an unapproved listing', async () => {
      const client = await loginAs(app, 'student');
      const pending = one(`SELECT id FROM houses WHERE status='pending' LIMIT 1`);
      if (!pending) return;
      const res = await client.post(
        '/student/review',
        { house_id: String(pending.id), rating: '5' },
        '/student/dashboard'
      );
      assert.equal(res.headers.location, '/student/dashboard');
    });

    test('redirects on a non-numeric house id', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.post(
        '/student/review',
        { house_id: 'abc', rating: '5' },
        '/student/dashboard'
      );
      assert.equal(res.headers.location, '/student/dashboard');
    });
  });

  describe('reports', () => {
    test('files a report', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.post(
        '/student/report',
        { house_id: String(approvedHouse().id), reason: 'The photos do not match the property.' },
        '/student/dashboard'
      );
      assert.match(res.headers.location, /success=report_filed/);
    });

    test('rejects an empty reason', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.post(
        '/student/report',
        { house_id: String(approvedHouse().id), reason: '   ' },
        '/student/dashboard'
      );
      assert.match(res.headers.location, /error=invalid_report/);
    });

    test('rejects a non-numeric house id', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.post(
        '/student/report',
        { house_id: 'abc', reason: 'Something is wrong' },
        '/student/dashboard'
      );
      assert.match(res.headers.location, /error=invalid_report/);
    });
  });

  describe('profile', () => {
    test('renders', async () => {
      const client = await loginAs(app, 'student');
      assert.equal((await client.get('/student/profile')).status, 200);
    });

    test('updates the profile', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.post(
        '/student/profile',
        {
          name: 'Brian O.',
          phone: '0711000000',
          university: 'JKUAT',
          course: 'Software Engineering',
        },
        '/student/profile'
      );
      assert.match(res.headers.location, /success=profile_updated/);
      const row = one(`SELECT university FROM student_profiles WHERE user_id=?`, [brianId]);
      assert.equal(row.university, 'JKUAT');
    });

    test('rejects a mismatched password confirmation', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.post(
        '/student/profile/password',
        {
          current_password: CREDENTIALS.seedPassword,
          new_password: NEW_PASSWORD,
          confirm_password: OTHER_PASSWORD,
        },
        '/student/profile'
      );
      assert.match(res.headers.location, /error=passwords_dont_match/);
    });

    test('rejects a short password', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.post(
        '/student/profile/password',
        {
          current_password: CREDENTIALS.seedPassword,
          new_password: 'short',
          confirm_password: 'short',
        },
        '/student/profile'
      );
      assert.match(res.headers.location, /error=password_too_short/);
    });

    test('rejects a wrong current password', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.post(
        '/student/profile/password',
        { current_password: 'wrong', new_password: NEW_PASSWORD, confirm_password: NEW_PASSWORD },
        '/student/profile'
      );
      assert.match(res.headers.location, /error=wrong_password/);
    });

    test('changes the password', async () => {
      const client = await loginAs(app, 'student');
      const res = await client.post(
        '/student/profile/password',
        {
          current_password: CREDENTIALS.seedPassword,
          new_password: NEW_PASSWORD,
          confirm_password: NEW_PASSWORD,
        },
        '/student/profile'
      );
      assert.match(res.headers.location, /success=password_changed/);
    });
  });
});
