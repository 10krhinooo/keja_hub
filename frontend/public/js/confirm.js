(function () {
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-confirm]').forEach(function (el) {
      var message = el.getAttribute('data-confirm');

      if (el.tagName === 'FORM') {
        el.addEventListener('submit', function (e) {
          if (!window.confirm(message)) e.preventDefault();
        });
      } else {
        el.addEventListener('click', function (e) {
          if (!window.confirm(message)) e.preventDefault();
        });
      }
    });
  });
})();
