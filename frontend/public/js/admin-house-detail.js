(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var rejectForm = document.getElementById('reject-form');
    if (!rejectForm) return;

    document.querySelectorAll('[data-show-reject-form]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        rejectForm.style.display = 'block';
        btn.style.display = 'none';
      });
    });

    var cancelBtn = document.querySelector('[data-hide-reject-form]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        rejectForm.style.display = 'none';
      });
    }
  });
})();
