// Selected once at require time via STORAGE_DRIVER. Both drivers share the
// same put(buffer, filename) -> url / remove(url) / urlFor(imagePath) shape,
// so callers never need to know which one is active.
module.exports = process.env.STORAGE_DRIVER === 's3' ? require('./s3') : require('./local');
