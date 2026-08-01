const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { setupDom, fireReady } = require('../helpers/dom');

const MODULE = path.join(__dirname, '../../frontend/public/js/validation.js');

describe('validation', () => {
  let teardown, document, mod;

  const load = (bodyHtml) => {
    ({ teardown, document } = setupDom(`<!doctype html><html><body>${bodyHtml}</body></html>`));
    delete require.cache[require.resolve(MODULE)];
    mod = require(MODULE);
    return document;
  };

  afterEach(() => teardown());

  describe('rules', () => {
    beforeEach(() => {
      load(`<form id="f">
        <input name="req"   data-required="Name is required">
        <input name="email" data-email>
        <input name="short" data-min-length="5">
        <input name="long"  data-max-length="5">
        <input name="minv"  data-min-value="10">
        <input name="maxv"  data-max-value="100">
        <input name="pw"    type="password">
        <input name="pw2"   data-match="pw" data-match-msg="Passwords must match">
        <input name="pat"   data-pattern="^[0-9]{4}$" data-pattern-msg="Four digits please">
      </form>`);
    });

    const field = (name) => document.querySelector(`[name="${name}"]`);

    test('required rejects empty and uses the attribute message', () => {
      assert.equal(mod.validate(field('req')), 'Name is required');
    });

    test('required accepts a value', () => {
      field('req').value = 'Brian';
      assert.equal(mod.validate(field('req')), '');
    });

    test('required treats whitespace as empty', () => {
      field('req').value = '    ';
      assert.equal(mod.validate(field('req')), 'Name is required');
    });

    test('email rejects a malformed address', () => {
      field('email').value = 'not-an-email';
      assert.match(mod.validate(field('email')), /valid email/);
    });

    test('email accepts a well-formed address', () => {
      field('email').value = 'brian@student.com';
      assert.equal(mod.validate(field('email')), '');
    });

    test('email skips the check when the field is empty and not required', () => {
      assert.equal(mod.validate(field('email')), '');
    });

    test('min-length rejects a short value and accepts the boundary', () => {
      field('short').value = 'abcd';
      assert.match(mod.validate(field('short')), /Minimum 5/);
      field('short').value = 'abcde';
      assert.equal(mod.validate(field('short')), '');
    });

    test('max-length rejects a long value and accepts the boundary', () => {
      field('long').value = 'abcdef';
      assert.match(mod.validate(field('long')), /Maximum 5/);
      field('long').value = 'abcde';
      assert.equal(mod.validate(field('long')), '');
    });

    test('min-value rejects a smaller number and non-numeric input', () => {
      field('minv').value = '9';
      assert.match(mod.validate(field('minv')), /at least 10/);
      field('minv').value = 'abc';
      assert.match(mod.validate(field('minv')), /at least 10/);
      field('minv').value = '10';
      assert.equal(mod.validate(field('minv')), '');
    });

    test('max-value rejects a larger number', () => {
      field('maxv').value = '101';
      assert.match(mod.validate(field('maxv')), /at most 100/);
      field('maxv').value = '100';
      assert.equal(mod.validate(field('maxv')), '');
    });

    test('match compares against the named field', () => {
      field('pw').value = 'secret123';
      field('pw2').value = 'different';
      assert.equal(mod.validate(field('pw2')), 'Passwords must match');

      field('pw2').value = 'secret123';
      assert.equal(mod.validate(field('pw2')), '');
    });

    test('pattern rejects a value that does not match', () => {
      field('pat').value = '12a4';
      assert.equal(mod.validate(field('pat')), 'Four digits please');
      field('pat').value = '1234';
      assert.equal(mod.validate(field('pat')), '');
    });
  });

  describe('validateAll', () => {
    test('reports the first offending field', () => {
      load(`<form id="f">
        <input name="a" data-required="A required">
        <input name="b" data-required="B required">
      </form>`);
      const form = document.getElementById('f');
      const result = mod.validateAll(form);
      assert.equal(result.ok, false);
      assert.equal(result.first.name, 'a');
    });

    test('passes when every field is valid', () => {
      load(`<form id="f"><input name="a" data-required="A required" value="filled"></form>`);
      const result = mod.validateAll(document.getElementById('f'));
      assert.equal(result.ok, true);
      assert.equal(result.first, null);
    });
  });

  describe('wiring', () => {
    test('blur renders an error message beside the field', () => {
      load(`<form data-validate-form><input name="a" data-required="A is required"></form>`);
      fireReady(document);

      const input = document.querySelector('[name="a"]');
      input.dispatchEvent(new document.defaultView.Event('blur'));

      assert.ok(input.classList.contains('field-invalid'));
      assert.match(document.querySelector('.field-error').textContent, /A is required/);
    });

    test('typing a valid value clears the error and marks the field valid', () => {
      load(`<form data-validate-form><input name="a" data-required="A is required"></form>`);
      fireReady(document);

      const input = document.querySelector('[name="a"]');
      input.dispatchEvent(new document.defaultView.Event('blur'));
      assert.ok(input.classList.contains('field-invalid'));

      input.value = 'now filled';
      input.dispatchEvent(new document.defaultView.Event('input'));
      assert.ok(!input.classList.contains('field-invalid'));
      assert.ok(input.classList.contains('field-valid'));
    });

    test('submit is blocked while a field is invalid', () => {
      load(`<form data-validate-form><input name="a" data-required="A is required">
            <button type="submit">Go</button></form>`);
      fireReady(document);

      const form = document.querySelector('form');
      const event = new document.defaultView.Event('submit', { cancelable: true, bubbles: true });
      form.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    });

    test('submit goes through once everything is valid', () => {
      load(`<form data-validate-form><input name="a" data-required="A is required" value="ok">
            <button type="submit">Go</button></form>`);
      fireReady(document);

      const form = document.querySelector('form');
      const event = new document.defaultView.Event('submit', { cancelable: true, bubbles: true });
      form.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false);
    });

    test('the submit button is disabled while the form is invalid', () => {
      load(`<form data-validate-form><input name="a" data-required="A is required">
            <button type="submit">Go</button></form>`);
      fireReady(document);
      assert.equal(document.querySelector('button[type="submit"]').disabled, true);

      const input = document.querySelector('[name="a"]');
      input.value = 'filled';
      input.dispatchEvent(new document.defaultView.Event('input'));
      assert.equal(document.querySelector('button[type="submit"]').disabled, false);
    });

    test('editing a password re-checks the confirmation that depends on it', () => {
      // The source field carries its own rule, which is how the real register
      // and profile templates mark it up. The dependent re-check only runs from
      // fields validation is already listening to.
      load(`<form data-validate-form>
        <input name="pw" type="password" data-required="Password is required">
        <input name="pw2" data-match="pw" data-match-msg="Passwords must match">
      </form>`);
      fireReady(document);

      const pw = document.querySelector('[name="pw"]');
      const pw2 = document.querySelector('[name="pw2"]');

      pw.value = 'secret123';
      pw2.value = 'secret123';
      pw2.dispatchEvent(new document.defaultView.Event('blur'));
      assert.equal(document.querySelectorAll('.field-error')[0].textContent, '');

      pw.value = 'changed456';
      pw.dispatchEvent(new document.defaultView.Event('input'));
      const errors = [...document.querySelectorAll('.field-error')].map((e) => e.textContent);
      assert.ok(errors.some((e) => /must match/.test(e)));
    });

    test('the password strength meter reacts to input', () => {
      load(`<form data-validate-form>
        <input name="pw" type="password" data-required="Required" data-password-strength>
      </form>`);
      fireReady(document);

      const pw = document.querySelector('[name="pw"]');
      // Long enough to satisfy one rule and no more, so it scores 1 of 4.
      pw.value = 'abcdefgh';
      pw.dispatchEvent(new document.defaultView.Event('input'));
      assert.equal(document.getElementById('strength-label').textContent, 'Weak');

      pw.value = 'Abcdef1!';
      pw.dispatchEvent(new document.defaultView.Event('input'));
      assert.equal(document.getElementById('strength-label').textContent, 'Strong');
      assert.equal(document.querySelectorAll('[data-rule].met').length, 4);
    });

    test('the strength label is blank for an empty password', () => {
      load(`<form data-validate-form>
        <input name="pw" type="password" data-required="Required" data-password-strength>
      </form>`);
      fireReady(document);

      const pw = document.querySelector('[name="pw"]');
      pw.value = 'x';
      pw.dispatchEvent(new document.defaultView.Event('input'));
      pw.value = '';
      pw.dispatchEvent(new document.defaultView.Event('input'));
      assert.equal(document.getElementById('strength-label').textContent, '');
    });

    test('a field wrapped in pwd-wrap gets its error placed outside the wrapper', () => {
      load(`<form data-validate-form>
        <div class="pwd-wrap"><input name="pw" data-required="Required"></div>
      </form>`);
      fireReady(document);

      const input = document.querySelector('[name="pw"]');
      input.dispatchEvent(new document.defaultView.Event('blur'));

      const error = document.querySelector('.field-error');
      assert.ok(error);
      assert.ok(
        !error.parentNode.classList.contains('pwd-wrap'),
        'the message sits beside the wrapper, not inside it'
      );
    });

    test('a form with no submit button still initialises', () => {
      load(`<form data-validate-form><input name="a" data-required="Required"></form>`);
      fireReady(document);
      assert.ok(true);
    });
  });
});
