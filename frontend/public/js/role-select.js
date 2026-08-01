(function () {
  function selectRole(grid, role) {
    grid.querySelectorAll('.role-card').forEach(function (card) {
      card.classList.toggle('selected', card.getAttribute('data-role') === role);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-role-select]').forEach(function (grid) {
      grid.querySelectorAll('input[name="role"]').forEach(function (input) {
        input.addEventListener('change', function () {
          selectRole(grid, input.value);
        });
      });

      var initial = grid.getAttribute('data-selected-role');
      if (initial) selectRole(grid, initial);
    });
  });
})();
