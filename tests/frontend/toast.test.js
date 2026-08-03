const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { setupDom } = require('../helpers/dom');

const MODULE = path.join(__dirname, '../../frontend/public/js/toast.js');

describe('toast', () => {
  let teardown, document, toast;

  beforeEach(() => {
    ({ teardown, document } = setupDom());
    // The module runs against whatever document exists at require time, so it
    // has to be re-evaluated for each fresh JSDOM.
    delete require.cache[require.resolve(MODULE)];
    toast = require(MODULE);
  });

  afterEach(() => teardown());

  describe('msg', () => {
    test('resolves a known key to its copy', () => {
      assert.equal(toast.Toast.msg('booking_sent'), toast.TOAST_MESSAGES.booking_sent);
      assert.match(toast.Toast.msg('booking_sent'), /Booking request sent/);
    });

    test('falls back to a generic message for an unknown key', () => {
      // Regression guard: this used to return the raw key, so a typo showed a
      // user the string "listing_not_found".
      assert.equal(toast.Toast.msg('no_such_key_at_all'), toast.FALLBACK);
      assert.ok(!toast.Toast.msg('no_such_key_at_all').includes('no_such_key'));
    });

    test('falls back for undefined and empty keys', () => {
      assert.equal(toast.Toast.msg(undefined), toast.FALLBACK);
      assert.equal(toast.Toast.msg(''), toast.FALLBACK);
    });

    test('every message is human readable, not a slug', () => {
      for (const [key, message] of Object.entries(toast.TOAST_MESSAGES)) {
        assert.ok(message.length > 10, `${key} is too short to be a real message`);
        assert.ok(!/^[a-z_]+$/.test(message), `${key} looks like a slug`);
      }
    });

    test('covers the error keys the server actually redirects with', () => {
      // These are emitted by backend/app.js and the controllers. A missing entry
      // would show the generic fallback instead of the specific fix.
      for (const key of [
        'file_too_large',
        'upload_type_error',
        'too_many_photos',
        'listing_not_found',
        'booking_not_found',
        'invalid_booking_status',
        'already_requested',
        'already_reviewed',
        'invalid_rating',
        'invalid_report',
        'wrong_password',
        'passwords_dont_match',
        'password_too_short',
      ]) {
        assert.ok(toast.TOAST_MESSAGES[key], `missing message for ${key}`);
      }
    });

    test('covers the success keys the server redirects with', () => {
      for (const key of [
        'registered',
        'verified',
        'booking_sent',
        'booking_accepted',
        'booking_declined',
        'listing_submitted',
        'listing_updated',
        'listing_resubmitted',
        'listing_approved',
        'listing_rejected',
        'listing_deleted',
        'review_posted',
        'report_filed',
        'report_resolved',
        'profile_updated',
        'password_changed',
        'password_reset',
      ]) {
        assert.ok(toast.TOAST_MESSAGES[key], `missing message for ${key}`);
      }
    });
  });

  describe('show', () => {
    test('creates the container on first use and reuses it after', () => {
      assert.equal(document.getElementById('toast-container'), null);
      toast.Toast.success('First message');
      const container = document.getElementById('toast-container');
      assert.ok(container);

      toast.Toast.error('Second message');
      assert.equal(document.querySelectorAll('#toast-container').length, 1);
      assert.equal(container.children.length, 2);
    });

    test('renders the message text', () => {
      toast.Toast.success('Saved successfully');
      assert.match(document.getElementById('toast-container').textContent, /Saved successfully/);
    });

    test('sets a type class', () => {
      toast.Toast.success('ok');
      toast.Toast.error('bad');
      toast.Toast.warning('careful');
      const classes = [...document.querySelectorAll('.toast')].map((t) => t.className);
      assert.ok(classes.some((c) => c.includes('toast-success')));
      assert.ok(classes.some((c) => c.includes('toast-error')));
      assert.ok(classes.some((c) => c.includes('toast-warning')));
    });

    test('defaults to the info type', () => {
      toast.Toast.show('plain message');
      assert.ok(document.querySelector('.toast-info'));
    });

    test('escapes nothing into HTML, using textContent', () => {
      toast.Toast.success('<img src=x onerror=alert(1)>');
      const container = document.getElementById('toast-container');
      assert.equal(container.querySelector('img'), null, 'markup was not parsed as HTML');
    });

    test('the dismiss button removes the toast', async () => {
      toast.Toast.success('Dismiss me');
      const container = document.getElementById('toast-container');
      assert.equal(container.children.length, 1);

      container.querySelector('.toast-dismiss').click();
      // Removal is animated, so the node lingers for the transition.
      await new Promise((r) => setTimeout(r, 350));
      assert.equal(container.children.length, 0);
    });

    test('hovering pauses the auto-dismiss timer', () => {
      toast.Toast.show('Hover me', 'info', 50);
      const el = document.querySelector('.toast');
      el.dispatchEvent(new document.defaultView.MouseEvent('mouseenter'));
      assert.equal(el.querySelector('.toast-progress').style.animationPlayState, 'paused');

      el.dispatchEvent(new document.defaultView.MouseEvent('mouseleave'));
      assert.equal(el.querySelector('.toast-progress').style.animationPlayState, 'running');
    });

    test('auto-dismisses after its duration', async () => {
      toast.Toast.show('Brief', 'info', 30);
      const container = document.getElementById('toast-container');
      assert.equal(container.children.length, 1);
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(container.children.length, 0);
    });
  });
});
