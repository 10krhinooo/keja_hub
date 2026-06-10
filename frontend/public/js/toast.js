(function () {
  var TOAST_MESSAGES = {
    registered:        'Account created! Welcome to KejaHub.',
    booking_sent:      'Booking request sent. The landlord will respond within 24 hours — check My Bookings for updates.',
    booking_accepted:  'Booking accepted. The student has been notified.',
    booking_declined:  'Booking declined. The student has been notified.',
    listing_submitted: 'Listing submitted for review. Admins typically approve within 48 hours.',
    listing_approved:  'Listing approved and now visible to students.',
    listing_rejected:  'Listing rejected. The landlord has been notified.',
    review_posted:     'Review submitted. Thank you for helping other students!',
    report_filed:      'Report submitted. Our team will review it within 72 hours.',
    report_resolved:   'Report marked as resolved.',
    login_failed:      'Incorrect email or password. Please try again.',
    email_taken:       'That email is already in use. Try logging in instead.',
    unauthorized:      "You don't have permission to do that.",
    file_too_large:    'Image exceeds 5 MB. Please upload a smaller file.',
    upload_type_error: 'Only JPEG, PNG, and WebP images are accepted.',
    already_requested: 'You already have a pending request for this house.',
    already_reviewed:  'You have already reviewed this listing.',
    invalid_rating:    'Please select a valid rating (1–5 stars).',
    invalid_report:    'Please describe the issue in more detail.',
    profile_updated:   'Profile updated successfully.',
    password_changed:  'Password changed successfully.',
    wrong_password:    'Current password is incorrect.',
    passwords_dont_match: 'New passwords do not match.',
    password_too_short: 'New password must be at least 8 characters.',
  };

  function getContainer() {
    var c = document.getElementById('toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toast-container';
      document.body.appendChild(c);
    }
    return c;
  }

  function show(message, type, duration) {
    duration = duration || 5000;
    var container = getContainer();

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'info');
    toast.style.position = 'relative';
    toast.style.overflow = 'hidden';

    var text = document.createElement('span');
    text.style.flex = '1';
    text.textContent = message;

    var btn = document.createElement('button');
    btn.className = 'toast-dismiss';
    btn.innerHTML = '&times;';
    btn.setAttribute('aria-label', 'Dismiss');

    var bar = document.createElement('div');
    bar.className = 'toast-progress';
    bar.style.animationDuration = (duration / 1000) + 's';

    toast.appendChild(text);
    toast.appendChild(btn);
    toast.appendChild(bar);
    container.appendChild(toast);

    function remove() {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(40px)';
        toast.style.transition = 'opacity 0.25s, transform 0.25s';
        setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 280);
      }
    }

    btn.addEventListener('click', remove);
    var timer = setTimeout(remove, duration);
    toast.addEventListener('mouseenter', function () {
      clearTimeout(timer);
      bar.style.animationPlayState = 'paused';
    });
    toast.addEventListener('mouseleave', function () {
      bar.style.animationPlayState = 'running';
      timer = setTimeout(remove, 2000);
    });
  }

  window.Toast = {
    show: show,
    success: function (msg) { show(msg, 'success'); },
    error:   function (msg) { show(msg, 'error'); },
    warning: function (msg) { show(msg, 'warning'); },
    msg: function (key) { return TOAST_MESSAGES[key] || key; },
  };
})();
