(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var locSelect = document.getElementById('loc-select');
    var locNew = document.getElementById('loc-new');
    if (!locSelect || !locNew) return;

    var form = locSelect.closest('form') || document.querySelector('form');

    locSelect.addEventListener('change', function () {
      locNew.style.display = locSelect.value === '__new__' ? 'block' : 'none';
      if (locSelect.value === '__new__') locNew.focus();
    });

    form.addEventListener('submit', function (e) {
      if (locSelect.value === '__new__' && locNew.value.trim() === '') {
        e.preventDefault();
        locNew.style.border = '1.5px solid #c62828';
        locNew.focus();
        locNew.placeholder = 'Please enter a location name';
      }
      if (locSelect.value === '' && locNew.style.display === 'none') {
        e.preventDefault();
        locSelect.style.border = '1.5px solid #c62828';
        locSelect.focus();
      }
    });
  });
})();
