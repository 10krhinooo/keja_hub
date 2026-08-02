const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Lazy so a process that never touches the s3 driver (the default, local one)
// never has to validate S3_* env vars.
function client() {
  return new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT || undefined,
    // S3-compatible services (R2, Spaces, MinIO) addressed via a custom
    // endpoint need path-style requests; AWS itself works either way.
    forcePathStyle: !!process.env.S3_ENDPOINT,
  });
}

function publicUrl() {
  return (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
}

function contentTypeFor(filename) {
  return filename.endsWith('.webp') ? 'image/webp' : 'application/octet-stream';
}

async function put(buffer, filename) {
  const key = `houses/${filename}`;
  await client().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentTypeFor(filename),
    })
  );
  return `${publicUrl()}/${key}`;
}

// Fire-and-forget, matching the local driver: a failed delete leaves an
// orphan object, which must never block or fail the request that removed
// the database row.
function remove(url) {
  if (!url) return;
  const prefix = `${publicUrl()}/`;
  const key = url.startsWith(prefix) ? url.slice(prefix.length) : url;
  client()
    .send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }))
    .catch(() => {});
}

// image_path is already the full public URL for the s3 driver.
function urlFor(imagePath) {
  return imagePath;
}

module.exports = { put, remove, urlFor };
