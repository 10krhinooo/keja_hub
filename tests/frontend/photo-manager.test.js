const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { setupDom, fireReady } = require('../helpers/dom');

const MODULE = path.join(__dirname, '../../frontend/public/js/photo-manager.js');

// Markup mirroring landlord/edit-house.ejs: an upload zone for new files and a
// grid of the photos already on the listing.
const uploadZone = (maxNew = 10) => `
  <div data-photo-manager data-max-new="${maxNew}">
    <div data-photo-dropzone>
      <input type="file" name="images" multiple data-photo-input>
      <div data-photo-preview></div>
      <p data-photo-counter></p>
    </div>
  </div>`;

const existingGrid = (ids) => `
  <div data-photo-manager>
    <input type="hidden" name="image_order" data-photo-order>
    <div data-photo-grid>
      ${ids
        .map(
          (id, i) => `
        <div class="photo-tile" data-image-id="${id}" draggable="true">
          <span data-photo-position></span>
          <button type="button" data-move="left">left</button>
          <button type="button" data-move="right">right</button>
          <input type="radio" name="primary_image" value="${id}" data-photo-cover ${i === 0 ? 'checked' : ''}>
          <input type="checkbox" name="delete_images" value="${id}" data-photo-delete>
        </div>`
        )
        .join('')}
    </div>
  </div>`;

describe('photo manager', () => {
  let teardown, document, window;

  const load = (bodyHtml) => {
    ({ teardown, document, window } = setupDom(
      `<!doctype html><html><body>${bodyHtml}</body></html>`
    ));
    delete require.cache[require.resolve(MODULE)];
    require(MODULE);
    fireReady(document);
    return document;
  };

  const makeFile = (name, type = 'image/jpeg', size = 1024) => {
    const file = new window.File([new Uint8Array(1)], name, { type });
    // JSDOM derives size from the content, so override it to simulate a large
    // upload without allocating megabytes.
    Object.defineProperty(file, 'size', { value: size });
    return file;
  };

  const pick = (files) => {
    const input = document.querySelector('[data-photo-input]');
    const dt = new window.DataTransfer();
    files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    return input;
  };

  afterEach(() => teardown());

  describe('upload zone', () => {
    test('shows how many photos can still be added', () => {
      load(uploadZone(10));
      assert.match(
        document.querySelector('[data-photo-counter]').textContent,
        /add up to 10 more photos/
      );
    });

    test('uses the singular when only one slot is left', () => {
      load(uploadZone(1));
      assert.match(
        document.querySelector('[data-photo-counter]').textContent,
        /add up to 1 more photo\./
      );
    });

    test('says the listing is full when there is no room', () => {
      load(uploadZone(0));
      assert.match(
        document.querySelector('[data-photo-counter]').textContent,
        /already has the maximum of 10 photos/
      );
    });

    test('defaults to ten when data-max-new is not a number', () => {
      load(`<div data-photo-manager data-max-new="lots">
              <input type="file" data-photo-input><div data-photo-preview></div>
              <p data-photo-counter></p></div>`);
      assert.match(document.querySelector('[data-photo-counter]').textContent, /up to 10/);
    });

    test('renders a preview tile per selected file', () => {
      load(uploadZone());
      pick([makeFile('a.jpg'), makeFile('b.png', 'image/png')]);
      assert.equal(document.querySelectorAll('[data-photo-preview] .photo-tile').length, 2);
    });

    test('updates the counter as files are staged', () => {
      load(uploadZone());
      pick([makeFile('a.jpg'), makeFile('b.jpg')]);
      assert.match(
        document.querySelector('[data-photo-counter]').textContent,
        /2 selected · room for 8 more photos/
      );
    });

    test('removing one preview leaves the others in place', () => {
      load(uploadZone());
      pick([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')]);

      const tiles = document.querySelectorAll('[data-photo-preview] .photo-tile');
      tiles[1].querySelector('.photo-tile-remove').click();

      const remaining = document.querySelectorAll('[data-photo-preview] .photo-tile');
      assert.equal(remaining.length, 2);
      assert.equal(document.querySelector('[data-photo-input]').files.length, 2);
      const names = [...remaining].map((t) => t.querySelector('img').alt);
      assert.deepEqual(names, ['a.jpg', 'c.jpg']);
    });

    test('rejects a file over 5 MB', () => {
      load(uploadZone());
      pick([makeFile('huge.jpg', 'image/jpeg', 6 * 1024 * 1024), makeFile('fine.jpg')]);
      assert.equal(document.querySelectorAll('[data-photo-preview] .photo-tile').length, 1);
    });

    test('rejects a file that is not JPEG, PNG or WebP', () => {
      load(uploadZone());
      pick([makeFile('doc.pdf', 'application/pdf'), makeFile('ok.webp', 'image/webp')]);
      const tiles = document.querySelectorAll('[data-photo-preview] .photo-tile');
      assert.equal(tiles.length, 1);
      assert.equal(tiles[0].querySelector('img').alt, 'ok.webp');
    });

    test('stops accepting files once the cap is reached', () => {
      load(uploadZone(2));
      pick([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')]);
      assert.equal(document.querySelectorAll('[data-photo-preview] .photo-tile').length, 2);
    });

    test('reports skipped files through Toast when it is available', () => {
      load(uploadZone());
      const seen = [];
      window.Toast = { error: (m) => seen.push(m), success: () => {} };

      pick([makeFile('huge.jpg', 'image/jpeg', 6 * 1024 * 1024)]);
      assert.equal(seen.length, 1);
      assert.match(seen[0], /Skipped 1 file/);
      assert.match(seen[0], /over 5 MB/);
    });

    test('a drop on the dropzone stages the files', () => {
      load(uploadZone());
      const dropzone = document.querySelector('[data-photo-dropzone]');

      const dt = new window.DataTransfer();
      dt.items.add(makeFile('dropped.jpg'));
      const event = new window.Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dt });
      dropzone.dispatchEvent(event);

      assert.equal(document.querySelectorAll('[data-photo-preview] .photo-tile').length, 1);
    });

    test('dragging over the dropzone marks it, and leaving unmarks it', () => {
      load(uploadZone());
      const dropzone = document.querySelector('[data-photo-dropzone]');

      dropzone.dispatchEvent(new window.Event('dragover', { bubbles: true, cancelable: true }));
      assert.ok(dropzone.classList.contains('is-dragging'));

      dropzone.dispatchEvent(new window.Event('dragleave', { bubbles: true, cancelable: true }));
      assert.ok(!dropzone.classList.contains('is-dragging'));
    });

    test('a zone missing its input or grid is skipped', () => {
      load('<div data-photo-manager><p>incomplete</p></div>');
      assert.ok(true);
    });
  });

  describe('existing photo grid', () => {
    test('publishes the initial order into the hidden field', () => {
      load(existingGrid([11, 22, 33]));
      assert.equal(document.querySelector('[data-photo-order]').value, '11,22,33');
    });

    test('labels the first tile as the cover', () => {
      load(existingGrid([11, 22, 33]));
      const positions = [...document.querySelectorAll('[data-photo-position]')].map(
        (p) => p.textContent
      );
      assert.deepEqual(positions, ['Shown first', '#2', '#3']);
    });

    test('the right button moves a tile later', () => {
      load(existingGrid([11, 22, 33]));
      document.querySelector('[data-image-id="11"] [data-move="right"]').click();
      assert.equal(document.querySelector('[data-photo-order]').value, '22,11,33');
    });

    test('the left button moves a tile earlier', () => {
      load(existingGrid([11, 22, 33]));
      document.querySelector('[data-image-id="33"] [data-move="left"]').click();
      assert.equal(document.querySelector('[data-photo-order]').value, '11,33,22');
    });

    test('moving left at the start does nothing', () => {
      load(existingGrid([11, 22, 33]));
      document.querySelector('[data-image-id="11"] [data-move="left"]').click();
      assert.equal(document.querySelector('[data-photo-order]').value, '11,22,33');
    });

    test('moving right at the end does nothing', () => {
      load(existingGrid([11, 22, 33]));
      document.querySelector('[data-image-id="33"] [data-move="right"]').click();
      assert.equal(document.querySelector('[data-photo-order]').value, '11,22,33');
    });

    test('position labels follow a move', () => {
      load(existingGrid([11, 22, 33]));
      document.querySelector('[data-image-id="11"] [data-move="right"]').click();
      assert.equal(
        document.querySelector('[data-image-id="22"] [data-photo-position]').textContent,
        'Shown first'
      );
    });

    test('a click that is not on a move button is ignored', () => {
      load(existingGrid([11, 22]));
      document.querySelector('[data-image-id="11"]').click();
      assert.equal(document.querySelector('[data-photo-order]').value, '11,22');
    });

    test('marking a photo for deletion flags the tile', () => {
      load(existingGrid([11, 22, 33]));
      const tile = document.querySelector('[data-image-id="22"]');
      const box = tile.querySelector('[data-photo-delete]');
      box.checked = true;
      box.dispatchEvent(new window.Event('change', { bubbles: true }));

      assert.ok(tile.classList.contains('is-removing'));
      assert.equal(tile.querySelector('[data-photo-cover]').disabled, true);
    });

    test('deleting the cover promotes another photo', () => {
      load(existingGrid([11, 22, 33]));
      const tile = document.querySelector('[data-image-id="11"]');
      assert.equal(tile.querySelector('[data-photo-cover]').checked, true);

      const box = tile.querySelector('[data-photo-delete]');
      box.checked = true;
      box.dispatchEvent(new window.Event('change', { bubbles: true }));

      assert.equal(tile.querySelector('[data-photo-cover]').checked, false);
      const stillCovered = [...document.querySelectorAll('[data-photo-cover]')].filter(
        (c) => c.checked
      );
      assert.equal(stillCovered.length, 1, 'exactly one cover remains');
      assert.notEqual(stillCovered[0].value, '11');
    });

    test('unchecking deletion restores the tile', () => {
      load(existingGrid([11, 22]));
      const tile = document.querySelector('[data-image-id="22"]');
      const box = tile.querySelector('[data-photo-delete]');

      box.checked = true;
      box.dispatchEvent(new window.Event('change', { bubbles: true }));
      box.checked = false;
      box.dispatchEvent(new window.Event('change', { bubbles: true }));

      assert.ok(!tile.classList.contains('is-removing'));
      assert.equal(tile.querySelector('[data-photo-cover]').disabled, false);
    });

    test('a change outside a tile is ignored', () => {
      load(existingGrid([11]) + '<input id="stray" type="checkbox">');
      document.getElementById('stray').dispatchEvent(new window.Event('change', { bubbles: true }));
      assert.equal(document.querySelector('[data-photo-order]').value, '11');
    });

    test('dragging a tile reorders and republishes the order', () => {
      load(existingGrid([11, 22, 33]));
      const grid = document.querySelector('[data-photo-grid]');
      const first = document.querySelector('[data-image-id="11"]');
      const last = document.querySelector('[data-image-id="33"]');

      const dt = new window.DataTransfer();
      const start = new window.Event('dragstart', { bubbles: true });
      Object.defineProperty(start, 'target', { value: first });
      Object.defineProperty(start, 'dataTransfer', { value: dt });
      grid.dispatchEvent(start);
      assert.ok(first.classList.contains('is-dragging'));

      const over = new window.Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(over, 'target', { value: last });
      Object.defineProperty(over, 'clientX', { value: 10000 });
      grid.dispatchEvent(over);

      grid.dispatchEvent(new window.Event('dragend', { bubbles: true }));
      assert.ok(!first.classList.contains('is-dragging'));
      assert.equal(document.querySelector('[data-photo-order]').value, '22,33,11');
    });

    test('dragover with nothing being dragged is ignored', () => {
      load(existingGrid([11, 22]));
      const grid = document.querySelector('[data-photo-grid]');
      const over = new window.Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(over, 'target', {
        value: document.querySelector('[data-image-id="22"]'),
      });
      grid.dispatchEvent(over);
      assert.equal(document.querySelector('[data-photo-order]').value, '11,22');
    });

    test('a drop is prevented so the browser does not navigate', () => {
      load(existingGrid([11]));
      const grid = document.querySelector('[data-photo-grid]');
      const event = new window.Event('drop', { bubbles: true, cancelable: true });
      grid.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    });

    test('a manager without a grid or order field is skipped', () => {
      load('<div data-photo-manager><div data-photo-grid></div></div>');
      assert.ok(true);
    });
  });
});
