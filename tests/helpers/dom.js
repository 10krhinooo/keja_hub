const { JSDOM } = require('jsdom');

/**
 * Installs a fresh document on globalThis so the frontend modules, which are
 * written against a browser and reach for `document` directly, can run under
 * node:test.
 *
 * Returns { window, document, teardown }. Always call teardown in an `after`
 * hook: JSDOM windows hold timers and would keep the process alive.
 */
// JSDOM does not implement DataTransfer, and photo-manager.js depends on it for
// two things a browser gives it for free: rebuilding a file input's read-only
// FileList after a photo is removed, and carrying the dragged tile's id. This
// shim covers exactly that surface.
function installDataTransfer(window) {
  if (window.DataTransfer) return;

  class DataTransferShim {
    constructor() {
      this._files = [];
      this._data = {};
      this.effectAllowed = 'none';
      this.dropEffect = 'none';
      this.items = {
        add: (file) => {
          this._files.push(file);
        },
        clear: () => {
          this._files = [];
        },
      };
    }

    // A FileList is array-like with indexed access and a length, and the app
    // only ever reads it that way or copies it with Array.prototype.slice.
    get files() {
      const list = this._files.slice();
      list.item = (i) => list[i] ?? null;
      return list;
    }

    setData(format, value) {
      this._data[format] = String(value);
    }
    getData(format) {
      return this._data[format] ?? '';
    }
  }

  window.DataTransfer = DataTransferShim;

  // Assigning to input.files is a no-op in JSDOM, so make it settable to mirror
  // what the browser does when the app hands it a rebuilt FileList.
  Object.defineProperty(window.HTMLInputElement.prototype, 'files', {
    configurable: true,
    get() {
      return this._files || [];
    },
    set(value) {
      this._files = value;
    },
  });
}

function setupDom(html = '<!doctype html><html><body></body></html>') {
  const dom = new JSDOM(html, { url: 'http://localhost:3000/', pretendToBeVisual: true });
  const { window } = dom;
  installDataTransfer(window);

  const installed = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Node',
    'Event',
    'CustomEvent',
    'KeyboardEvent',
    'MouseEvent',
    'DataTransfer',
    'FileList',
    'File',
    'FileReader',
    'Image',
    'localStorage',
    'sessionStorage',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ];

  const saved = new Map();
  for (const key of installed) {
    saved.set(key, globalThis[key]);
    if (window[key] !== undefined) {
      Object.defineProperty(globalThis, key, {
        value: window[key],
        writable: true,
        configurable: true,
      });
    }
  }
  globalThis.window = window;

  function teardown() {
    for (const [key, value] of saved) {
      if (value === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    }
    window.close();
  }

  return { dom, window, document: window.document, teardown };
}

// Frontend modules bind their behaviour on DOMContentLoaded. Tests build the
// markup first, then fire the event to run the module's entry point against it.
function fireReady(document) {
  document.dispatchEvent(
    new document.defaultView.Event('DOMContentLoaded', {
      bubbles: true,
      cancelable: false,
    })
  );
}

module.exports = { setupDom, fireReady };
