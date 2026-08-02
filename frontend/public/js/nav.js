(function () {
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.nav-links a').forEach(function (a) {
      var h = a.getAttribute('href');
      if (location.pathname === h || location.pathname.startsWith(h + '/')) {
        a.classList.add('active');
      }
    });
  });
})();
