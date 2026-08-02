(function () {
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-tab-group]').forEach(function (group) {
      group.querySelectorAll('[data-tab-target]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var name = btn.getAttribute('data-tab-target');
          // The panels are siblings of the tab bar, not descendants of it, so
          // this has to search the whole document rather than scope to group.
          document.querySelectorAll('.tab-panel').forEach(function (p) {
            p.classList.remove('active');
          });
          group.querySelectorAll('.tab-btn').forEach(function (b) {
            b.classList.remove('active');
          });
          document.getElementById('tab-' + name).classList.add('active');
          btn.classList.add('active');
        });
      });
    });
  });
})();
