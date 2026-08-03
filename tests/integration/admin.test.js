const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { createTestApp, CREDENTIALS, newPassword } = require('../helpers/app');
const { loginAs, createAgent } = require('../helpers/agent');

// Passwords these tests set. Generated so no literal password lives in the repo.
const NEW_PASSWORD = newPassword();
const OTHER_PASSWORD = newPassword();

describe('admin', () => {
  let app, db, cleanup;

  const one = (sql, params = []) => db.prepare(sql).get(...params) ?? null;

  const newHouse = (status = 'pending') => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO houses (landlord_id,title,description,rent,location,status)
            VALUES ((SELECT id FROM users WHERE email='james@landlord.com'),?,?,?,?,?)`
      )
      .run(
        'Admin fixture ' + Math.random(),
        'A description long enough to pass validation.',
        9000,
        'Ngong Road',
        status
      );
    return lastInsertRowid;
  };

  before(async () => {
    ({ app, db, cleanup } = await createTestApp());
  });
  after(() => cleanup());

  describe('access control', () => {
    test('anonymous visitors are redirected to login', async () => {
      const res = await createAgent(app).get('/admin/dashboard');
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/login');
    });

    test('a student cannot reach the admin area', async () => {
      const student = await loginAs(app, 'student');
      const res = await student.get('/admin/dashboard');
      assert.equal(res.headers.location, '/login');
    });

    test('a landlord cannot reach the admin area', async () => {
      const landlord = await loginAs(app, 'landlord');
      const res = await landlord.get('/admin/users');
      assert.equal(res.headers.location, '/login');
    });
  });

  describe('pages render', () => {
    for (const path of [
      '/admin/dashboard',
      '/admin/listings',
      '/admin/analytics',
      '/admin/users',
      '/admin/reports',
      '/admin/bookings',
      '/admin/profile',
    ]) {
      test(path, async () => {
        const admin = await loginAs(app, 'admin');
        const res = await admin.get(path);
        assert.equal(res.status, 200);
      });
    }
  });

  describe('listings', () => {
    for (const filter of ['pending', 'approved', 'rejected']) {
      test(`filters by ${filter}`, async () => {
        const admin = await loginAs(app, 'admin');
        const res = await admin.get(`/admin/listings?filter=${filter}`);
        assert.equal(res.status, 200);
      });
    }

    test('ignores an unknown filter', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.get('/admin/listings?filter=bogus');
      assert.equal(res.status, 200);
    });

    test('searches by keyword', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.get('/admin/listings?keyword=Westlands');
      assert.equal(res.status, 200);
    });

    test('paginates and clamps an out-of-range page', async () => {
      const admin = await loginAs(app, 'admin');
      assert.equal((await admin.get('/admin/listings?page=2')).status, 200);
      assert.equal((await admin.get('/admin/listings?page=9999')).status, 200);
      assert.equal((await admin.get('/admin/listings?page=0')).status, 200);
    });

    test('combines a filter and a keyword', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.get('/admin/listings?filter=approved&keyword=Ngong');
      assert.equal(res.status, 200);
    });
  });

  describe('house review', () => {
    test('shows a listing', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.get(`/admin/house/${newHouse()}`);
      assert.equal(res.status, 200);
    });

    test('redirects on an unknown id', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.get('/admin/house/9999999');
      assert.equal(res.status, 302);
    });

    test('redirects on a non-numeric id', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.get('/admin/house/abc');
      assert.equal(res.status, 302);
    });

    test('approves a pending listing', async () => {
      const admin = await loginAs(app, 'admin');
      const id = newHouse('pending');
      const res = await admin.post(`/admin/house/${id}/approve`, {}, '/admin/listings');
      assert.match(res.headers.location, /success=listing_approved/);
      assert.equal(one(`SELECT status FROM houses WHERE id=?`, [id]).status, 'approved');
    });

    test('approving clears an earlier rejection reason', async () => {
      const admin = await loginAs(app, 'admin');
      const id = newHouse('rejected');
      db.prepare(`UPDATE houses SET rejection_reason='Blurry photos' WHERE id=?`).run(id);
      await admin.post(`/admin/house/${id}/approve`, {}, '/admin/listings');
      assert.equal(
        one(`SELECT rejection_reason FROM houses WHERE id=?`, [id]).rejection_reason,
        null
      );
    });

    test('rejects a listing with a reason', async () => {
      const admin = await loginAs(app, 'admin');
      const id = newHouse('pending');
      const res = await admin.post(
        `/admin/house/${id}/reject`,
        { rejection_reason: '  The photos do not show the property.  ' },
        '/admin/listings'
      );
      assert.match(res.headers.location, /success=listing_rejected/);

      const row = one(`SELECT status, rejection_reason FROM houses WHERE id=?`, [id]);
      assert.equal(row.status, 'rejected');
      assert.equal(row.rejection_reason, 'The photos do not show the property.');
    });

    test('rejecting with no reason stores null rather than an empty string', async () => {
      const admin = await loginAs(app, 'admin');
      const id = newHouse('pending');
      await admin.post(`/admin/house/${id}/reject`, { rejection_reason: '   ' }, '/admin/listings');
      assert.equal(
        one(`SELECT rejection_reason FROM houses WHERE id=?`, [id]).rejection_reason,
        null
      );
    });

    test('truncates an over-long rejection reason', async () => {
      const admin = await loginAs(app, 'admin');
      const id = newHouse('pending');
      await admin.post(
        `/admin/house/${id}/reject`,
        { rejection_reason: 'x'.repeat(900) },
        '/admin/listings'
      );
      assert.equal(
        one(`SELECT rejection_reason FROM houses WHERE id=?`, [id]).rejection_reason.length,
        500
      );
    });

    test('approve and reject redirect back to the detail page when that is where they came from', async () => {
      const admin = await loginAs(app, 'admin');
      const id = newHouse('pending');
      const token = await admin.csrf('/admin/listings');
      const res = await admin.agent
        .post(`/admin/house/${id}/approve`)
        .type('form')
        .set('Referer', `http://localhost/admin/house/${id}`)
        .send({ _csrf: token });
      assert.equal(res.headers.location, `/admin/house/${id}?success=listing_approved`);
    });

    test('approve redirects on a non-numeric id', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.post('/admin/house/abc/approve', {}, '/admin/listings');
      assert.equal(res.headers.location, '/admin/dashboard');
    });

    test('reject redirects on a non-numeric id', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.post('/admin/house/abc/reject', {}, '/admin/listings');
      assert.equal(res.headers.location, '/admin/dashboard');
    });

    test('deletes a listing and its dependent rows', async () => {
      const admin = await loginAs(app, 'admin');
      const id = newHouse('approved');
      db.prepare(
        `INSERT INTO house_images (house_id,image_path,is_primary,sort_order) VALUES (?,?,1,0)`
      ).run(id, '/uploads/houses/admin-doomed.jpg');
      db.prepare(`INSERT INTO amenities (house_id,name) VALUES (?,'WiFi')`).run(id);

      const res = await admin.post(`/admin/house/${id}/delete`, {}, '/admin/listings');
      assert.match(res.headers.location, /success=listing_deleted/);
      assert.equal(one(`SELECT id FROM houses WHERE id=?`, [id]), null);
      assert.equal(one(`SELECT id FROM house_images WHERE house_id=?`, [id]), null);
      assert.equal(one(`SELECT id FROM amenities WHERE house_id=?`, [id]), null);
    });

    test('delete redirects on a non-numeric id', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.post('/admin/house/abc/delete', {}, '/admin/listings');
      assert.equal(res.headers.location, '/admin/dashboard');
    });
  });

  describe('users', () => {
    test('searches by keyword', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.get('/admin/users?keyword=Brian');
      assert.equal(res.status, 200);
      assert.match(res.text, /Brian/);
    });

    test('a keyword matching nobody still renders', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.get('/admin/users?keyword=zzzznobody');
      assert.equal(res.status, 200);
    });

    test('deactivates and reactivates a user', async () => {
      const admin = await loginAs(app, 'admin');
      const user = one(`SELECT id, is_active FROM users WHERE email='amina@student.com'`);
      assert.equal(user.is_active, 1);

      await admin.post(`/admin/users/${user.id}/toggle`, {}, '/admin/users');
      assert.equal(one(`SELECT is_active FROM users WHERE id=?`, [user.id]).is_active, 0);

      await admin.post(`/admin/users/${user.id}/toggle`, {}, '/admin/users');
      assert.equal(one(`SELECT is_active FROM users WHERE id=?`, [user.id]).is_active, 1);
    });

    test('toggling an unknown user just redirects', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.post('/admin/users/9999999/toggle', {}, '/admin/users');
      assert.equal(res.headers.location, '/admin/users');
    });

    test('toggling a non-numeric id just redirects', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.post('/admin/users/abc/toggle', {}, '/admin/users');
      assert.equal(res.headers.location, '/admin/users');
    });

    test('a deactivated user is locked out on their next request', async () => {
      const admin = await loginAs(app, 'admin');
      const student = await loginAs(app, 'student');
      assert.equal((await student.get('/student/dashboard')).status, 200);

      const brian = one(`SELECT id FROM users WHERE email='brian@student.com'`);
      await admin.post(`/admin/users/${brian.id}/toggle`, {}, '/admin/users');

      const after = await student.get('/student/dashboard');
      assert.equal(after.headers.location, '/login');

      await admin.post(`/admin/users/${brian.id}/toggle`, {}, '/admin/users');
    });

    test('paginates students and landlords independently, clamping out-of-range pages', async () => {
      const admin = await loginAs(app, 'admin');
      assert.equal((await admin.get('/admin/users?student_page=2')).status, 200);
      assert.equal((await admin.get('/admin/users?student_page=9999')).status, 200);
      assert.equal((await admin.get('/admin/users?student_page=0')).status, 200);
      assert.equal((await admin.get('/admin/users?landlord_page=2')).status, 200);
      assert.equal((await admin.get('/admin/users?landlord_page=9999')).status, 200);
    });
  });

  describe('reports', () => {
    const newReport = () => {
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO reports (house_id, reported_by, reason)
              VALUES ((SELECT id FROM houses LIMIT 1),
                      (SELECT id FROM users WHERE email='brian@student.com'),
                      'Listing looks like a scam')`
        )
        .run();
      return lastInsertRowid;
    };

    for (const status of ['open', 'resolved']) {
      test(`filters by ${status}`, async () => {
        const admin = await loginAs(app, 'admin');
        const res = await admin.get(`/admin/reports?status=${status}`);
        assert.equal(res.status, 200);
      });
    }

    test('ignores an unknown status filter', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.get('/admin/reports?status=bogus');
      assert.equal(res.status, 200);
    });

    test('resolves a report', async () => {
      const admin = await loginAs(app, 'admin');
      const id = newReport();
      const res = await admin.post(`/admin/reports/${id}/resolve`, {}, '/admin/reports');
      assert.match(res.headers.location, /success=report_resolved/);
      assert.equal(one(`SELECT status FROM reports WHERE id=?`, [id]).status, 'resolved');
    });

    test('resolving a non-numeric id just redirects', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.post('/admin/reports/abc/resolve', {}, '/admin/reports');
      assert.equal(res.headers.location, '/admin/reports');
    });

    test('paginates and clamps an out-of-range page', async () => {
      const admin = await loginAs(app, 'admin');
      assert.equal((await admin.get('/admin/reports?page=2')).status, 200);
      assert.equal((await admin.get('/admin/reports?page=9999')).status, 200);
      assert.equal((await admin.get('/admin/reports?page=0')).status, 200);
    });
  });

  describe('bookings', () => {
    for (const status of ['pending', 'accepted', 'declined']) {
      test(`filters by ${status}`, async () => {
        const admin = await loginAs(app, 'admin');
        const res = await admin.get(`/admin/bookings?status=${status}`);
        assert.equal(res.status, 200);
      });
    }

    test('ignores an unknown status filter', async () => {
      const admin = await loginAs(app, 'admin');
      assert.equal((await admin.get('/admin/bookings?status=bogus')).status, 200);
    });

    test('paginates and clamps', async () => {
      const admin = await loginAs(app, 'admin');
      assert.equal((await admin.get('/admin/bookings?page=2')).status, 200);
      assert.equal((await admin.get('/admin/bookings?page=9999')).status, 200);
    });
  });

  describe('profile', () => {
    test('updates the admin name', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.post('/admin/profile', { name: 'Head Admin' }, '/admin/profile');
      assert.match(res.headers.location, /success=profile_updated/);
      assert.equal(
        one(`SELECT name FROM users WHERE email='admin@kejahub.com'`).name,
        'Head Admin'
      );
    });

    test('rejects a mismatched password confirmation', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.post(
        '/admin/profile/password',
        {
          current_password: CREDENTIALS.adminPassword,
          new_password: NEW_PASSWORD,
          confirm_password: OTHER_PASSWORD,
        },
        '/admin/profile'
      );
      assert.match(res.headers.location, /error=passwords_dont_match/);
    });

    test('rejects a short password', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.post(
        '/admin/profile/password',
        {
          current_password: CREDENTIALS.adminPassword,
          new_password: 'short',
          confirm_password: 'short',
        },
        '/admin/profile'
      );
      assert.match(res.headers.location, /error=password_too_short/);
    });

    test('rejects a wrong current password', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.post(
        '/admin/profile/password',
        {
          current_password: 'definitely-wrong',
          new_password: NEW_PASSWORD,
          confirm_password: NEW_PASSWORD,
        },
        '/admin/profile'
      );
      assert.match(res.headers.location, /error=wrong_password/);
    });

    test('changes the password', async () => {
      const admin = await loginAs(app, 'admin');
      const res = await admin.post(
        '/admin/profile/password',
        {
          current_password: CREDENTIALS.adminPassword,
          new_password: NEW_PASSWORD,
          confirm_password: NEW_PASSWORD,
        },
        '/admin/profile'
      );
      assert.match(res.headers.location, /success=password_changed/);

      const relogin = await createAgent(app).login('admin@kejahub.com', NEW_PASSWORD);
      assert.match(relogin.headers.location, /\/admin\/dashboard/);
    });
  });
});
