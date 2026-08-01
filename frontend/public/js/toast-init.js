(function () {
  document.addEventListener('DOMContentLoaded', function () {
    if (!window.Toast) return;
    var body = document.body;

    var success = body.getAttribute('data-toast-success');
    if (success === 'welcome') {
      var name = body.getAttribute('data-user-name') || '';
      window.Toast.success('Welcome back, ' + name + '!');
    } else if (success) {
      window.Toast.success(window.Toast.msg(success));
    }

    var error = body.getAttribute('data-toast-error');
    if (error) window.Toast.error(window.Toast.msg(error));
  });
})();
