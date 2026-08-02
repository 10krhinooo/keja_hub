const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const {
  processImage,
  MAIN_MAX_EDGE,
  THUMB_MAX_EDGE,
} = require('../../backend/utils/imageProcessing');

const tmpFiles = [];
after(() => {
  for (const f of tmpFiles) fs.rmSync(f, { force: true });
});

async function fixture(width, height) {
  const file = path.join(os.tmpdir(), `kejahub-imgproc-${Date.now()}-${Math.random()}.jpg`);
  await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .jpeg()
    .toFile(file);
  tmpFiles.push(file);
  return file;
}

describe('imageProcessing.processImage', () => {
  test('caps a large photo long edge at MAIN_MAX_EDGE and re-encodes to webp', async () => {
    const source = await fixture(3000, 2000);
    const { main } = await processImage(source);
    const meta = await sharp(main).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(Math.max(meta.width, meta.height), MAIN_MAX_EDGE);
  });

  test('generates a thumbnail capped at THUMB_MAX_EDGE', async () => {
    const source = await fixture(3000, 2000);
    const { thumbnail } = await processImage(source);
    const meta = await sharp(thumbnail).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(Math.max(meta.width, meta.height), THUMB_MAX_EDGE);
  });

  test('does not upscale a photo smaller than the caps', async () => {
    const source = await fixture(200, 100);
    const { main, thumbnail } = await processImage(source);
    const mainMeta = await sharp(main).metadata();
    const thumbMeta = await sharp(thumbnail).metadata();
    assert.deepEqual([mainMeta.width, mainMeta.height], [200, 100]);
    assert.deepEqual([thumbMeta.width, thumbMeta.height], [200, 100]);
  });
});
