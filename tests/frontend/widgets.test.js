const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { setupDom, fireReady } = require('../helpers/dom');

const js = (name) => path.join(__dirname, '../../frontend/public/js/', name);

describe('frontend widgets', () => {
  let teardown, document, window;

  const load = (bodyHtml, moduleName) => {
    ({ teardown, document, window } = setupDom(
      `<!doctype html><html><body>${bodyHtml}</body></html>`
    ));
    delete require.cache[require.resolve(js(moduleName))];
    require(js(moduleName));
    return document;
  };

  afterEach(() => teardown());

  describe('dates', () => {
    test('formats an ISO date for display', () => {
      load('<span class="date-val">2026-03-14</span>', 'dates.js');
      fireReady(document);
      const text = document.querySelector('.date-val').textContent;
      assert.notEqual(text, '2026-03-14');
      assert.match(text, /2026/);
      assert.match(text, /Mar/);
    });

    test('leaves a placeholder dash alone', () => {
      load('<span class="date-val">-</span>', 'dates.js');
      fireReady(document);
      assert.equal(document.querySelector('.date-val').textContent, '-');
    });

    test('leaves an empty value alone', () => {
      load('<span class="date-val">   </span>', 'dates.js');
      fireReady(document);
      assert.equal(document.querySelector('.date-val').textContent.trim(), '');
    });

    test('leaves an unparseable value alone', () => {
      load('<span class="date-val">not a date</span>', 'dates.js');
      fireReady(document);
      assert.equal(document.querySelector('.date-val').textContent, 'not a date');
    });

    test('formats every matching element', () => {
      load(
        `<span class="date-val">2026-01-01</span>
            <span class="date-val">2026-12-31</span>`,
        'dates.js'
      );
      fireReady(document);
      for (const el of document.querySelectorAll('.date-val')) {
        assert.match(el.textContent, /2026/);
        assert.ok(!el.textContent.includes('-0'));
      }
    });

    test('does nothing when there is nothing to format', () => {
      load('<p>no dates here</p>', 'dates.js');
      fireReady(document);
      assert.ok(true);
    });
  });

  describe('skeleton', () => {
    test('hides placeholders and reveals content after load', async () => {
      load(
        `<div class="skeleton-placeholder">loading</div>
            <div class="skeleton-content" style="display:none">real content</div>`,
        'skeleton.js'
      );
      fireReady(document);

      await new Promise((r) => setTimeout(r, 400));
      assert.equal(document.querySelector('.skeleton-placeholder').style.display, 'none');
      assert.equal(document.querySelector('.skeleton-content').style.display, '');
    });

    test('does nothing on a page with no skeletons', async () => {
      load('<p>nothing here</p>', 'skeleton.js');
      fireReady(document);
      await new Promise((r) => setTimeout(r, 400));
      assert.ok(true);
    });
  });

  describe('lightbox', () => {
    const gallery = `
      <img class="lb-trigger" src="/uploads/houses/thumb.jpg" data-full="/uploads/houses/full.jpg">
      <img class="lb-trigger" src="/uploads/houses/other.jpg">
    `;

    test('builds the overlay on load, hidden', () => {
      load(gallery, 'lightbox.js');
      fireReady(document);

      const overlay = document.getElementById('lb-overlay');
      assert.ok(overlay);
      assert.equal(overlay.style.display, 'none');
    });

    test('clicking a trigger opens it with the full size image', () => {
      load(gallery, 'lightbox.js');
      fireReady(document);

      document.querySelectorAll('.lb-trigger')[0].click();
      const overlay = document.getElementById('lb-overlay');
      assert.equal(overlay.style.display, 'flex');
      assert.match(document.getElementById('lb-img').src, /full\.jpg$/);
      assert.equal(document.body.style.overflow, 'hidden');
    });

    test('falls back to the thumbnail when there is no data-full', () => {
      load(gallery, 'lightbox.js');
      fireReady(document);

      document.querySelectorAll('.lb-trigger')[1].click();
      assert.match(document.getElementById('lb-img').src, /other\.jpg$/);
    });

    test('marks triggers as zoomable', () => {
      load(gallery, 'lightbox.js');
      fireReady(document);
      assert.equal(document.querySelector('.lb-trigger').style.cursor, 'zoom-in');
    });

    test('clicking the backdrop closes it and restores scrolling', () => {
      load(gallery, 'lightbox.js');
      fireReady(document);

      document.querySelector('.lb-trigger').click();
      const overlay = document.getElementById('lb-overlay');
      overlay.click();

      assert.equal(overlay.style.display, 'none');
      // Read the attribute, not the property: an empty src resolves to the
      // page URL when accessed through .src.
      assert.equal(document.getElementById('lb-img').getAttribute('src'), '');
      assert.equal(document.body.style.overflow, '');
    });

    test('the close button closes it', () => {
      load(gallery, 'lightbox.js');
      fireReady(document);

      document.querySelector('.lb-trigger').click();
      document.getElementById('lb-close').click();
      assert.equal(document.getElementById('lb-overlay').style.display, 'none');
    });

    test('clicking the image itself does not close it', () => {
      load(gallery, 'lightbox.js');
      fireReady(document);

      document.querySelector('.lb-trigger').click();
      document.getElementById('lb-img').click();
      assert.equal(document.getElementById('lb-overlay').style.display, 'flex');
    });

    test('Escape closes it', () => {
      load(gallery, 'lightbox.js');
      fireReady(document);

      document.querySelector('.lb-trigger').click();
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(document.getElementById('lb-overlay').style.display, 'none');
    });

    test('another key does not close it', () => {
      load(gallery, 'lightbox.js');
      fireReady(document);

      document.querySelector('.lb-trigger').click();
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      assert.equal(document.getElementById('lb-overlay').style.display, 'flex');
    });

    test('a page with no gallery still builds the overlay without error', () => {
      load('<p>no images</p>', 'lightbox.js');
      fireReady(document);
      assert.ok(document.getElementById('lb-overlay'));
    });
  });
});
