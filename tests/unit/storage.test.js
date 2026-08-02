const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// remove() is fire-and-forget async I/O; give it more than one tick to land.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('storage/local', () => {
  const local = require('../../backend/storage/local');
  const PROJECT_ROOT = path.join(__dirname, '../../');
  const HOUSES_DIR = path.join(PROJECT_ROOT, 'uploads/houses');

  test('put() writes the buffer under uploads/houses and returns a relative url', async () => {
    const url = await local.put(Buffer.from('hello'), `unit-put-${Date.now()}.webp`);
    assert.match(url, /^\/uploads\/houses\/unit-put-\d+\.webp$/);
    const abs = path.join(PROJECT_ROOT, '.' + url);
    assert.equal(fs.readFileSync(abs, 'utf8'), 'hello');
    fs.unlinkSync(abs);
  });

  test('remove() unlinks a path that resolves inside uploads/', async () => {
    fs.mkdirSync(HOUSES_DIR, { recursive: true });
    const target = path.join(HOUSES_DIR, `unit-remove-${Date.now()}.webp`);
    fs.writeFileSync(target, 'x');
    local.remove('/uploads/houses/' + path.basename(target));
    await settle();
    assert.equal(fs.existsSync(target), false);
  });

  test('remove() refuses a traversal escape', async () => {
    const outside = path.join(os.tmpdir(), `kejahub-storage-guard-${Date.now()}.txt`);
    fs.writeFileSync(outside, 'do not delete me');
    local.remove('/uploads/../../../../..' + outside);
    await settle();
    assert.equal(fs.existsSync(outside), true);
    fs.unlinkSync(outside);
  });

  test('remove() is a no-op for a null path', () => {
    assert.doesNotThrow(() => local.remove(null));
  });

  test('urlFor() passes the stored path through unchanged', () => {
    assert.equal(local.urlFor('/uploads/houses/x.webp'), '/uploads/houses/x.webp');
  });
});

describe('storage/s3', () => {
  let s3, S3Client, sentCommands;

  before(() => {
    process.env.STORAGE_DRIVER = 's3';
    process.env.S3_BUCKET = 'kejahub-test-bucket';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_PUBLIC_URL = 'https://cdn.example.com/';

    ({ S3Client } = require('@aws-sdk/client-s3'));
    sentCommands = [];
    mock.method(S3Client.prototype, 'send', async (command) => {
      sentCommands.push(command);
      return {};
    });

    s3 = require('../../backend/storage/s3');
  });

  after(() => {
    mock.restoreAll();
  });

  test('put() uploads under a houses/ key and returns the public url', async () => {
    const url = await s3.put(Buffer.from('hello'), 'photo.webp');
    assert.equal(url, 'https://cdn.example.com/houses/photo.webp');

    const putCommand = sentCommands.at(-1);
    assert.equal(putCommand.input.Bucket, 'kejahub-test-bucket');
    assert.equal(putCommand.input.Key, 'houses/photo.webp');
    assert.equal(putCommand.input.Body.toString(), 'hello');
    assert.equal(putCommand.input.ContentType, 'image/webp');
  });

  test('remove() strips the public url prefix down to the object key', async () => {
    s3.remove('https://cdn.example.com/houses/photo.webp');
    await settle();

    const deleteCommand = sentCommands.at(-1);
    assert.equal(deleteCommand.input.Bucket, 'kejahub-test-bucket');
    assert.equal(deleteCommand.input.Key, 'houses/photo.webp');
  });

  test('remove() is a no-op for a null url', () => {
    const before = sentCommands.length;
    s3.remove(null);
    assert.equal(sentCommands.length, before);
  });

  test('urlFor() passes the stored url through unchanged', () => {
    assert.equal(
      s3.urlFor('https://cdn.example.com/houses/x.webp'),
      'https://cdn.example.com/houses/x.webp'
    );
  });
});

// Parity: the two drivers must be interchangeable from a caller's perspective
// -- same put/remove/urlFor shape, same behaviour for a null/missing input.
describe('storage driver parity', () => {
  const local = require('../../backend/storage/local');

  test('both drivers expose the same interface', () => {
    const s3 = require('../../backend/storage/s3');
    for (const driver of [local, s3]) {
      assert.equal(typeof driver.put, 'function');
      assert.equal(typeof driver.remove, 'function');
      assert.equal(typeof driver.urlFor, 'function');
    }
  });
});
