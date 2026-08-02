// Single source of truth for the amenity list. The views render checkboxes from
// this array, and submitted values are filtered against it.
const AMENITY_OPTIONS = [
  'WiFi',
  'Water',
  'Electricity',
  'Parking',
  'Security',
  'CCTV',
  'Furnished',
  'Kitchen',
  'Balcony',
];

const LIMITS = {
  title: { min: 5, max: 100 },
  description: { min: 20, max: 2000 },
  estate: { max: 60 },
  location: { max: 60 },
  rent: { min: 1, max: 10000000 },
  rooms: { min: 1, max: 10 },
};

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function clampInt(value, { min, max }, fallback) {
  const n = parseInt(value, 10);
  if (isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Mirrors the client-side rules in frontend/public/js/validation.js, which a
// direct POST bypasses entirely. Returns { values, errors } where errors is a list
// of human-readable strings, empty when the submission is valid.
function validateHouseInput(body) {
  const errors = [];

  const title = (body.title || '').trim();
  if (!title) {
    errors.push('Title is required');
  } else if (title.length < LIMITS.title.min) {
    errors.push(`Title must be at least ${LIMITS.title.min} characters`);
  } else if (title.length > LIMITS.title.max) {
    errors.push(`Title must be ${LIMITS.title.max} characters or fewer`);
  }

  const description = (body.description || '').trim();
  if (!description) {
    errors.push('Description is required');
  } else if (description.length < LIMITS.description.min) {
    errors.push(`Description must be at least ${LIMITS.description.min} characters`);
  } else if (description.length > LIMITS.description.max) {
    errors.push(`Description must be ${LIMITS.description.max} characters or fewer`);
  }

  const rent = parseFloat(body.rent);
  if (!Number.isFinite(rent)) {
    errors.push('Rent is required and must be a number');
  } else if (rent < LIMITS.rent.min) {
    errors.push('Rent must be greater than 0');
  } else if (rent > LIMITS.rent.max) {
    errors.push('Rent looks unrealistically high. Please check the amount');
  }

  const location = (
    body.location_select === '__new__' ? body.location_new || '' : body.location_select || ''
  )
    .trim()
    .slice(0, LIMITS.location.max);
  if (!location) errors.push('Location is required');

  const estate = (body.estate || '').trim().slice(0, LIMITS.estate.max);

  const bedrooms = clampInt(body.bedrooms, LIMITS.rooms, 1);
  const bathrooms = clampInt(body.bathrooms, LIMITS.rooms, 1);

  const amenities = toArray(body.amenities)
    .map((a) => String(a).trim())
    .filter((a) => AMENITY_OPTIONS.includes(a));

  return {
    errors,
    values: {
      title,
      description,
      rent,
      location,
      estate,
      bedrooms,
      bathrooms,
      amenities,
    },
  };
}

module.exports = { AMENITY_OPTIONS, LIMITS, validateHouseInput };
