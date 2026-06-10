document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.date-val').forEach(function (el) {
    var raw = el.textContent.trim();
    if (!raw || raw === '-') return;
    var d = new Date(raw + 'T00:00:00');
    if (isNaN(d)) return;
    el.textContent = d.toLocaleDateString('en-KE', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  });
});
