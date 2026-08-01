const fs = require('fs');
const path = require('path');

// A real 1x1 JPEG. multer's fileFilter checks the extension and the mimetype
// that supertest derives from the filename, so any valid bytes would do, but a
// genuinely decodable image keeps these fixtures usable once sharp starts
// resizing uploads.
const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

const UPLOAD_DIR = path.join(__dirname, '../../uploads/houses');

// Filenames multer generated during a test run, so a test can assert the file
// landed on disk and clean up after itself.
function uploadedFiles() {
  try {
    return fs.readdirSync(UPLOAD_DIR);
  } catch {
    return [];
  }
}

function fileExists(imagePath) {
  if (!imagePath) return false;
  return fs.existsSync(path.join(__dirname, '../../', '.' + imagePath));
}

// Attaches n images to a supertest request.
function attachImages(req, n, field = 'images') {
  for (let i = 0; i < n; i++) {
    req.attach(field, JPEG_1X1, `photo-${i}.jpg`);
  }
  return req;
}

module.exports = { JPEG_1X1, UPLOAD_DIR, uploadedFiles, fileExists, attachImages };
