/* Photo manager: multi-file upload with previews and per-file removal, plus
   drag/keyboard reordering and cover selection for existing listing photos.
   Vanilla JS to match the rest of frontend/public/js, with no build step. */
(function () {
  var MAX_BYTES = 5 * 1024 * 1024;
  var ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

  function notify(message, type) {
    if (window.Toast) window.Toast[type === 'error' ? 'error' : 'success'](message);
    else if (type === 'error') alert(message);
  }

  /* ── Upload zone ──────────────────────────────────────────────────────── */

  function initUploadZone(root) {
    var input = root.querySelector('[data-photo-input]');
    var grid = root.querySelector('[data-photo-preview]');
    var counter = root.querySelector('[data-photo-counter]');
    var dropzone = root.querySelector('[data-photo-dropzone]');
    if (!input || !grid) return;

    var maxNew = parseInt(root.getAttribute('data-max-new'), 10);
    if (isNaN(maxNew)) maxNew = 10;
    var staged = [];

    function updateCounter() {
      if (!counter) return;
      var remaining = maxNew - staged.length;
      if (maxNew <= 0) {
        counter.textContent =
          'This listing already has the maximum of 10 photos. Remove one to add another.';
      } else if (staged.length === 0) {
        counter.textContent =
          'You can add up to ' + maxNew + ' more photo' + (maxNew === 1 ? '' : 's') + '.';
      } else {
        counter.textContent =
          staged.length +
          ' selected · room for ' +
          remaining +
          ' more photo' +
          (remaining === 1 ? '' : 's') +
          '.';
      }
    }

    // A file input's FileList is read-only; rebuilding it through DataTransfer is
    // the only way to drop an individual file before submitting.
    function syncInput() {
      var dt = new DataTransfer();
      staged.forEach(function (file) {
        dt.items.add(file);
      });
      input.files = dt.files;
      updateCounter();
    }

    function renderPreviews() {
      grid.innerHTML = '';
      staged.forEach(function (file, index) {
        var tile = document.createElement('div');
        tile.className = 'photo-tile';

        var img = document.createElement('img');
        img.alt = file.name;
        var reader = new FileReader();
        reader.onload = function (e) {
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);

        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'photo-tile-remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', 'Remove ' + file.name);
        remove.addEventListener('click', function () {
          staged.splice(index, 1);
          syncInput();
          renderPreviews();
        });

        tile.appendChild(img);
        tile.appendChild(remove);
        grid.appendChild(tile);
      });
    }

    function addFiles(fileList) {
      var rejected = [];
      // Copy first, because syncInput() reassigns input.files, which can be this list.
      Array.prototype.slice.call(fileList).forEach(function (file) {
        if (staged.length >= maxNew) {
          rejected.push(file.name + ' (photo limit reached)');
          return;
        }
        if (ALLOWED.indexOf(file.type) === -1) {
          rejected.push(file.name + ' (only JPEG, PNG, or WebP)');
          return;
        }
        if (file.size > MAX_BYTES) {
          rejected.push(file.name + ' (over 5 MB)');
          return;
        }
        staged.push(file);
      });

      syncInput();
      renderPreviews();

      if (rejected.length) {
        notify(
          'Skipped ' +
            rejected.length +
            ' file' +
            (rejected.length === 1 ? '' : 's') +
            ': ' +
            rejected.join(', ') +
            '. Fix and add again.',
          'error'
        );
      }
    }

    input.addEventListener('change', function () {
      // Re-run selections through the same validation as drag-and-drop.
      var picked = Array.prototype.slice.call(input.files);
      staged = [];
      addFiles(picked);
    });

    if (dropzone) {
      ['dragenter', 'dragover'].forEach(function (evt) {
        dropzone.addEventListener(evt, function (e) {
          e.preventDefault();
          dropzone.classList.add('is-dragging');
        });
      });
      ['dragleave', 'drop'].forEach(function (evt) {
        dropzone.addEventListener(evt, function (e) {
          e.preventDefault();
          dropzone.classList.remove('is-dragging');
        });
      });
      dropzone.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
      });
      dropzone.addEventListener('click', function (e) {
        if (e.target.closest('[data-photo-preview]')) return;
        input.click();
      });
    }

    updateCounter();
  }

  /* ── Existing photo grid: reorder + cover + remove ────────────────────── */

  function initManager(root) {
    var grid = root.querySelector('[data-photo-grid]');
    var orderField = root.querySelector('[data-photo-order]');
    if (!grid || !orderField) return;

    function tiles() {
      return Array.prototype.slice.call(grid.querySelectorAll('[data-image-id]'));
    }

    function syncOrder() {
      orderField.value = tiles()
        .map(function (t) {
          return t.getAttribute('data-image-id');
        })
        .join(',');
      tiles().forEach(function (tile, i) {
        var pos = tile.querySelector('[data-photo-position]');
        if (pos) pos.textContent = i === 0 ? 'Shown first' : '#' + (i + 1);
      });
    }

    function move(tile, delta) {
      var all = tiles();
      var index = all.indexOf(tile);
      var target = index + delta;
      if (target < 0 || target >= all.length) return;
      if (delta < 0) grid.insertBefore(tile, all[target]);
      else grid.insertBefore(all[target], tile);
      syncOrder();
      tile.querySelector('[data-move="' + (delta < 0 ? 'left' : 'right') + '"]').focus();
    }

    var dragged = null;

    grid.addEventListener('dragstart', function (e) {
      var tile = e.target.closest('[data-image-id]');
      if (!tile) return;
      dragged = tile;
      tile.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox requires data to be set for a drag to start at all.
      e.dataTransfer.setData('text/plain', tile.getAttribute('data-image-id'));
    });

    grid.addEventListener('dragend', function () {
      if (dragged) dragged.classList.remove('is-dragging');
      dragged = null;
      syncOrder();
    });

    grid.addEventListener('dragover', function (e) {
      if (!dragged) return;
      e.preventDefault();
      var over = e.target.closest('[data-image-id]');
      if (!over || over === dragged) return;
      var rect = over.getBoundingClientRect();
      var after = e.clientX - rect.left > rect.width / 2;
      grid.insertBefore(dragged, after ? over.nextSibling : over);
    });

    grid.addEventListener('drop', function (e) {
      e.preventDefault();
    });

    // Drag-and-drop alone is unusable by keyboard and touch, so every tile also
    // gets explicit move buttons.
    grid.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-move]');
      if (!btn) return;
      move(btn.closest('[data-image-id]'), btn.getAttribute('data-move') === 'left' ? -1 : 1);
    });

    grid.addEventListener('change', function (e) {
      var tile = e.target.closest('[data-image-id]');
      if (!tile) return;

      if (e.target.matches('[data-photo-delete]')) {
        var removing = e.target.checked;
        tile.classList.toggle('is-removing', removing);
        var cover = tile.querySelector('[data-photo-cover]');
        // A photo queued for deletion can't also be the cover.
        if (cover) {
          cover.disabled = removing;
          if (removing && cover.checked) {
            cover.checked = false;
            var next = grid.querySelector('[data-photo-cover]:not(:disabled)');
            if (next) next.checked = true;
          }
        }
      }
    });

    syncOrder();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-photo-manager]').forEach(function (root) {
      initManager(root);
      initUploadZone(root);
    });
  });
})();
