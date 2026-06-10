document.addEventListener('DOMContentLoaded', function () {
  setTimeout(function () {
    document.querySelectorAll('.skeleton-placeholder').forEach(function (el) {
      el.style.display = 'none';
    });
    document.querySelectorAll('.skeleton-content').forEach(function (el) {
      el.style.display = '';
    });
  }, 300);
});
