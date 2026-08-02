const sharp = require('sharp');

const MAIN_MAX_EDGE = 1600;
const THUMB_MAX_EDGE = 400;
const QUALITY = 80;

// Bakes in EXIF orientation, then discards the rest of the metadata (sharp
// strips it by default unless withMetadata() is called) and re-encodes to
// webp. Two independent pipelines off the same decode via clone() so a 5MB
// phone photo only gets decoded once for both outputs.
async function processImage(inputPath) {
  const source = sharp(inputPath).rotate();

  const main = await source
    .clone()
    .resize({
      width: MAIN_MAX_EDGE,
      height: MAIN_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: QUALITY })
    .toBuffer();

  const thumbnail = await source
    .clone()
    .resize({
      width: THUMB_MAX_EDGE,
      height: THUMB_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: QUALITY })
    .toBuffer();

  return { main, thumbnail };
}

module.exports = { processImage, MAIN_MAX_EDGE, THUMB_MAX_EDGE };
