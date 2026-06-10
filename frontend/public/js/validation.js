(function () {
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function validate(field) {
    var val = field.value.trim();
    var msg = '';

    if (field.hasAttribute('data-required') && !val) {
      msg = field.getAttribute('data-required') || 'This field is required';
    } else if (val && field.hasAttribute('data-email') && !EMAIL_RE.test(val)) {
      msg = field.getAttribute('data-email') || 'Please enter a valid email address';
    } else if (val && field.hasAttribute('data-min-length')) {
      var min = parseInt(field.getAttribute('data-min-length'), 10);
      if (val.length < min) msg = field.getAttribute('data-min-length-msg') || ('Minimum ' + min + ' characters required');
    } else if (val && field.hasAttribute('data-max-length')) {
      var max = parseInt(field.getAttribute('data-max-length'), 10);
      if (val.length > max) msg = field.getAttribute('data-max-length-msg') || ('Maximum ' + max + ' characters');
    } else if (val && field.hasAttribute('data-min-value')) {
      var minV = parseFloat(field.getAttribute('data-min-value'));
      if (isNaN(parseFloat(val)) || parseFloat(val) < minV) msg = field.getAttribute('data-min-value-msg') || ('Must be at least ' + minV);
    } else if (val && field.hasAttribute('data-max-value')) {
      var maxV = parseFloat(field.getAttribute('data-max-value'));
      if (!isNaN(parseFloat(val)) && parseFloat(val) > maxV) msg = field.getAttribute('data-max-value-msg') || ('Must be at most ' + maxV);
    } else if (field.hasAttribute('data-match')) {
      var matchName = field.getAttribute('data-match');
      var form = field.closest('form');
      var target = form ? form.querySelector('[name="' + matchName + '"]') : null;
      if (target && val !== target.value) msg = field.getAttribute('data-match-msg') || 'Fields do not match';
    } else if (val && field.hasAttribute('data-pattern')) {
      var re = new RegExp(field.getAttribute('data-pattern'));
      if (!re.test(val)) msg = field.getAttribute('data-pattern-msg') || 'Invalid format';
    }

    return msg;
  }

  function afterWrap(field) {
    var p = field.parentNode;
    var inWrap = p.classList && p.classList.contains('pwd-wrap');
    return { parent: inWrap ? p.parentNode : p, before: inWrap ? p.nextSibling : field.nextSibling };
  }

  function setFieldState(field, errorMsg) {
    var span = field._errorSpan;
    if (!span) {
      var loc = afterWrap(field);
      span = document.createElement('span');
      span.className = 'field-error';
      loc.parent.insertBefore(span, loc.before);
      field._errorSpan = span;
    }
    if (errorMsg) {
      span.textContent = errorMsg;
      field.classList.add('field-invalid');
      field.classList.remove('field-valid');
    } else {
      span.textContent = '';
      if (field.value.trim() || field.hasAttribute('data-required')) {
        field.classList.remove('field-invalid');
        if (field.value.trim()) field.classList.add('field-valid');
      }
    }
  }

  function validateAll(form) {
    var fields = form.querySelectorAll('[data-required],[data-email],[data-min-length],[data-min-value],[data-match],[data-pattern]');
    var ok = true;
    var first = null;
    fields.forEach(function (f) {
      var msg = validate(f);
      setFieldState(f, msg);
      if (msg) { ok = false; if (!first) first = f; }
    });
    return { ok: ok, first: first };
  }

  function updateSubmitBtn(form) {
    var btn = form.querySelector('button[type="submit"],.btn[type="submit"]');
    if (!btn) return;
    var fields = form.querySelectorAll('[data-required],[data-email],[data-min-length],[data-min-value],[data-match],[data-pattern]');
    var allOk = true;
    fields.forEach(function (f) { if (validate(f)) allOk = false; });
    btn.disabled = !allOk;
  }

  function attachPasswordStrength(field) {
    var container = document.createElement('div');
    container.innerHTML =
      '<div class="strength-segments">' +
        '<div class="strength-seg" id="seg1"></div>' +
        '<div class="strength-seg" id="seg2"></div>' +
        '<div class="strength-seg" id="seg3"></div>' +
        '<div class="strength-seg" id="seg4"></div>' +
      '</div>' +
      '<p class="strength-label" id="strength-label"></p>' +
      '<ul class="strength-checklist">' +
        '<li data-rule="length">8+ characters</li>' +
        '<li data-rule="upper">Uppercase letter</li>' +
        '<li data-rule="number">Number</li>' +
        '<li data-rule="special">Special character (!@#$%^&amp;*)</li>' +
      '</ul>';
    var loc = afterWrap(field);
    loc.parent.insertBefore(container, loc.before);

    field.addEventListener('input', function () {
      var v = field.value;
      var rules = {
        length:  v.length >= 8,
        upper:   /[A-Z]/.test(v),
        number:  /[0-9]/.test(v),
        special: /[^A-Za-z0-9]/.test(v),
      };
      var score = Object.values(rules).filter(Boolean).length;
      var colors = ['', '#c62828', '#ff6f00', '#c6c200', '#2e7d32'];
      var labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];

      for (var i = 1; i <= 4; i++) {
        var seg = container.querySelector('#seg' + i);
        seg.style.background = i <= score ? colors[score] : '#e0e0e0';
      }
      var lbl = container.querySelector('#strength-label');
      lbl.textContent = v.length ? labels[score] : '';
      lbl.style.color = colors[score] || '#888';

      container.querySelectorAll('[data-rule]').forEach(function (li) {
        li.classList.toggle('met', rules[li.getAttribute('data-rule')] || false);
      });
    });
  }

  function initForm(form) {
    var fields = form.querySelectorAll('[data-required],[data-email],[data-min-length],[data-min-value],[data-match],[data-pattern]');

    fields.forEach(function (field) {
      if (field.hasAttribute('data-password-strength')) attachPasswordStrength(field);

      field.addEventListener('blur', function () {
        var msg = validate(field);
        setFieldState(field, msg);
        updateSubmitBtn(form);
      });

      field.addEventListener('input', function () {
        if (field.classList.contains('field-invalid')) {
          var msg = validate(field);
          setFieldState(field, msg);
        }
        updateSubmitBtn(form);

        if (field.hasAttribute('data-match')) {
          var msg2 = validate(field);
          setFieldState(field, msg2);
        }

        var matchName = field.getAttribute('name');
        if (matchName) {
          var dep = form.querySelector('[data-match="' + matchName + '"]');
          if (dep && dep._errorSpan) {
            var dm = validate(dep);
            setFieldState(dep, dm);
          }
        }
      });
    });

    form.addEventListener('submit', function (e) {
      var result = validateAll(form);
      if (!result.ok) {
        e.preventDefault();
        if (result.first) result.first.focus();
      }
    });

    updateSubmitBtn(form);
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-validate-form]').forEach(initForm);
  });
})();
