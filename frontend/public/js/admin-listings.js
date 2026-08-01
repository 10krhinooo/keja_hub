(function () {
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-toggle-reject]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-toggle-reject');
        var form = document.getElementById('reject-' + id);
        if (!form) return;
        form.style.display = form.style.display === 'block' ? 'none' : 'block';
      });
    });
  });
})();
