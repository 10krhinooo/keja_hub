(function () {
  // Every message should say what happened and, on failure, what to do next.
  var TOAST_MESSAGES = {
    registered:        'Account created! Welcome to KejaHub.',
    booking_sent:      'Booking request sent. The landlord will respond within 24 hours. Check My Bookings for updates.',
    booking_accepted:  'Booking accepted. The student has been notified.',
    booking_declined:  'Booking declined. The student has been notified.',
    listing_submitted: 'Listing submitted for review. Admins typically approve within 48 hours. You can keep editing it in the meantime.',
    listing_updated:   'Changes saved and live. Students browsing KejaHub see your updated listing right away.',
    listing_resubmitted: 'Changes saved and sent for review. Because this listing was previously rejected, an admin will take another look within 48 hours.',
    listing_approved:  'Listing approved and now visible to students.',
    listing_rejected:  'Listing rejected. The landlord has been notified with your reason.',
    listing_deleted:   'Listing deleted, along with its photos, bookings, and reviews.',
    photos_updated:    'Photos updated. Your new cover image and ordering are live.',
    review_posted:     'Review submitted. Thank you for helping other students!',
    report_filed:      'Report submitted. Our team will review it within 72 hours.',
    report_resolved:   'Report marked as resolved.',
    profile_updated:   'Profile updated successfully.',
    password_changed:  'Password changed successfully.',
    password_reset:    'Password reset. You can now log in with your new password.',
    reset_link_sent:   'If that email is registered, we have sent a reset link. It expires in 1 hour. Check your spam folder if it does not arrive.',

    // ── Failures: always name the fix ──────────────────────────────────────
    login_failed:      'Incorrect email or password. Check for typos, or use "Forgot password" to reset it.',
    email_taken:       'That email is already registered. Try logging in instead, or reset your password.',
    account_inactive:  'This account has been deactivated. Contact support@kejahub.com if you think this is a mistake.',
    unauthorized:      "You don't have permission to do that. If you think this is wrong, try logging out and back in.",
    session_expired:   'Your session expired for security. Please log in again to continue.',
    file_too_large:    'That image is over 5 MB. Compress or resize it, then upload again. Nothing else on your form was lost.',
    upload_type_error: 'Only JPEG, PNG, and WebP images are accepted. Convert the file and try again.',
    too_many_photos:   'A listing can hold up to 10 photos. Remove a few existing ones, then add the new ones.',
    upload_failed:     'Your photos could not be uploaded. Check your connection and try again. Your listing details were not changed.',
    listing_not_found: 'That listing no longer exists, or it is not yours to edit.',
    booking_not_found: 'That booking request no longer exists. Refresh the page to see the latest requests.',
    invalid_booking_status: 'That is not a valid response to a booking. Please choose Accept or Decline.',
    already_requested: 'You already have a pending request for this house. Watch My Bookings for the landlord\'s reply.',
    already_reviewed:  'You have already reviewed this listing. You can only leave one review per house.',
    invalid_rating:    'Please select a rating between 1 and 5 stars before submitting.',
    invalid_report:    'Please describe the issue in a bit more detail so our team can act on it.',
    wrong_password:    'Your current password is incorrect. Try again, or use "Forgot password" to reset it.',
    passwords_dont_match: 'The two new passwords do not match. Please retype them.',
    password_too_short: 'Your new password must be at least 8 characters.',
    rate_limited:      'Too many attempts. Please wait a few minutes before trying again.',
    email_send_failed: 'We could not send that email right now. Please try again in a few minutes.',
  };

  var FALLBACK = 'Something went wrong. Please try again. If it keeps happening, contact support@kejahub.com.';

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
    // Unknown keys must never leak a raw slug like "listing_not_found" to a user.
    msg: function (key) { return TOAST_MESSAGES[key] || FALLBACK; },
  };
})();
