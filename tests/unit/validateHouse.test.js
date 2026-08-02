const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  AMENITY_OPTIONS,
  LIMITS,
  validateHouseInput,
} = require('../../backend/utils/validateHouse');

// A submission that passes every rule, so each test can vary one field.
const valid = () => ({
  title: 'Cozy bedsitter near campus',
  description: 'A clean, well-lit bedsitter within walking distance of the main campus gate.',
  rent: '9000',
  location_select: 'Ngong Road',
  estate: 'Milimani',
  bedrooms: '1',
  bathrooms: '1',
  amenities: ['WiFi', 'Water'],
});

describe('validateHouseInput', () => {
  test('accepts a well-formed submission', () => {
    const { errors, values } = validateHouseInput(valid());
    assert.deepEqual(errors, []);
    assert.equal(values.title, 'Cozy bedsitter near campus');
    assert.equal(values.rent, 9000);
    assert.equal(values.location, 'Ngong Road');
  });

  test('trims whitespace off text fields', () => {
    const { values } = validateHouseInput({ ...valid(), title: '   Padded title here   ' });
    assert.equal(values.title, 'Padded title here');
  });

  describe('title', () => {
    test('is required', () => {
      const { errors } = validateHouseInput({ ...valid(), title: '   ' });
      assert.ok(errors.includes('Title is required'));
    });

    test('rejects one character below the minimum', () => {
      const { errors } = validateHouseInput({
        ...valid(),
        title: 'a'.repeat(LIMITS.title.min - 1),
      });
      assert.ok(errors.some((e) => e.includes('at least')));
    });

    test('accepts exactly the minimum', () => {
      const { errors } = validateHouseInput({ ...valid(), title: 'a'.repeat(LIMITS.title.min) });
      assert.ok(!errors.some((e) => e.startsWith('Title')));
    });

    test('accepts exactly the maximum', () => {
      const { errors } = validateHouseInput({ ...valid(), title: 'a'.repeat(LIMITS.title.max) });
      assert.ok(!errors.some((e) => e.startsWith('Title')));
    });

    test('rejects one character above the maximum', () => {
      const { errors } = validateHouseInput({
        ...valid(),
        title: 'a'.repeat(LIMITS.title.max + 1),
      });
      assert.ok(errors.some((e) => e.includes('or fewer')));
    });
  });

  describe('description', () => {
    test('is required', () => {
      const { errors } = validateHouseInput({ ...valid(), description: '' });
      assert.ok(errors.includes('Description is required'));
    });

    test('rejects below the minimum', () => {
      const { errors } = validateHouseInput({ ...valid(), description: 'too short' });
      assert.ok(errors.some((e) => e.startsWith('Description must be at least')));
    });

    test('accepts exactly the minimum', () => {
      const { errors } = validateHouseInput({
        ...valid(),
        description: 'a'.repeat(LIMITS.description.min),
      });
      assert.ok(!errors.some((e) => e.startsWith('Description')));
    });

    test('rejects above the maximum', () => {
      const { errors } = validateHouseInput({
        ...valid(),
        description: 'a'.repeat(LIMITS.description.max + 1),
      });
      assert.ok(errors.some((e) => e.includes('or fewer')));
    });
  });

  describe('rent', () => {
    test('rejects a non-numeric value', () => {
      const { errors } = validateHouseInput({ ...valid(), rent: 'free' });
      assert.ok(errors.includes('Rent is required and must be a number'));
    });

    test('rejects a missing value', () => {
      const body = valid();
      delete body.rent;
      const { errors } = validateHouseInput(body);
      assert.ok(errors.includes('Rent is required and must be a number'));
    });

    test('rejects zero', () => {
      const { errors } = validateHouseInput({ ...valid(), rent: '0' });
      assert.ok(errors.includes('Rent must be greater than 0'));
    });

    test('rejects an unrealistically high amount', () => {
      const { errors } = validateHouseInput({ ...valid(), rent: String(LIMITS.rent.max + 1) });
      assert.ok(errors.some((e) => e.includes('unrealistically high')));
    });

    test('accepts a decimal amount', () => {
      const { errors, values } = validateHouseInput({ ...valid(), rent: '9500.50' });
      assert.deepEqual(errors, []);
      assert.equal(values.rent, 9500.5);
    });

    test('rejects Infinity', () => {
      const { errors } = validateHouseInput({ ...valid(), rent: 'Infinity' });
      assert.ok(errors.includes('Rent is required and must be a number'));
    });
  });

  describe('location', () => {
    test('is required', () => {
      const { errors } = validateHouseInput({ ...valid(), location_select: '' });
      assert.ok(errors.includes('Location is required'));
    });

    test('reads location_new when the select says __new__', () => {
      const { values } = validateHouseInput({
        ...valid(),
        location_select: '__new__',
        location_new: 'Kileleshwa',
      });
      assert.equal(values.location, 'Kileleshwa');
    });

    test('errors when __new__ is chosen but nothing was typed', () => {
      const { errors } = validateHouseInput({
        ...valid(),
        location_select: '__new__',
        location_new: '   ',
      });
      assert.ok(errors.includes('Location is required'));
    });

    test('truncates an over-long location rather than erroring', () => {
      const { values } = validateHouseInput({
        ...valid(),
        location_select: '__new__',
        location_new: 'x'.repeat(200),
      });
      assert.equal(values.location.length, LIMITS.location.max);
    });
  });

  test('truncates an over-long estate and never errors on it', () => {
    const { errors, values } = validateHouseInput({ ...valid(), estate: 'y'.repeat(200) });
    assert.deepEqual(errors, []);
    assert.equal(values.estate.length, LIMITS.estate.max);
  });

  describe('bedrooms and bathrooms', () => {
    test('fall back to 1 when missing', () => {
      const body = valid();
      delete body.bedrooms;
      delete body.bathrooms;
      const { values } = validateHouseInput(body);
      assert.equal(values.bedrooms, 1);
      assert.equal(values.bathrooms, 1);
    });

    test('fall back to 1 when not a number', () => {
      const { values } = validateHouseInput({ ...valid(), bedrooms: 'lots' });
      assert.equal(values.bedrooms, 1);
    });

    test('clamp up to the minimum', () => {
      const { values } = validateHouseInput({ ...valid(), bedrooms: '0', bathrooms: '-5' });
      assert.equal(values.bedrooms, LIMITS.rooms.min);
      assert.equal(values.bathrooms, LIMITS.rooms.min);
    });

    test('clamp down to the maximum', () => {
      const { values } = validateHouseInput({ ...valid(), bedrooms: '99' });
      assert.equal(values.bedrooms, LIMITS.rooms.max);
    });

    test('parse a decimal down to its integer part', () => {
      const { values } = validateHouseInput({ ...valid(), bedrooms: '3.9' });
      assert.equal(values.bedrooms, 3);
    });
  });

  describe('amenities', () => {
    test('drops values not on the allow-list', () => {
      const { values } = validateHouseInput({
        ...valid(),
        amenities: ['WiFi', 'Helipad', '<script>alert(1)</script>'],
      });
      assert.deepEqual(values.amenities, ['WiFi']);
    });

    test('wraps a single string into an array', () => {
      const { values } = validateHouseInput({ ...valid(), amenities: 'Parking' });
      assert.deepEqual(values.amenities, ['Parking']);
    });

    test('returns an empty array when absent', () => {
      const body = valid();
      delete body.amenities;
      const { values } = validateHouseInput(body);
      assert.deepEqual(values.amenities, []);
    });

    test('returns an empty array when null', () => {
      const { values } = validateHouseInput({ ...valid(), amenities: null });
      assert.deepEqual(values.amenities, []);
    });

    test('trims surrounding whitespace before matching', () => {
      const { values } = validateHouseInput({ ...valid(), amenities: ['  WiFi  '] });
      assert.deepEqual(values.amenities, ['WiFi']);
    });

    test('accepts every documented option', () => {
      const { values } = validateHouseInput({ ...valid(), amenities: [...AMENITY_OPTIONS] });
      assert.deepEqual(values.amenities, AMENITY_OPTIONS);
    });
  });

  test('reports every problem at once rather than stopping at the first', () => {
    const { errors } = validateHouseInput({ title: '', description: '', rent: 'abc' });
    assert.ok(errors.length >= 4);
  });
});
