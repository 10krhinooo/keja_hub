(function () {
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.reason-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cell = btn.parentElement;
        var shortEl = cell.querySelector('.reason-short');
        var fullEl = cell.querySelector('.reason-full');
        var expanded = fullEl.style.display !== 'none';
        shortEl.style.display = expanded ? '' : 'none';
        fullEl.style.display = expanded ? 'none' : '';
        btn.textContent = expanded ? 'Show more' : 'Show less';
      });
    });
  });
})();
