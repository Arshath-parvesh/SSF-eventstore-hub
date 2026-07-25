const multer = require('multer');

// Memory storage to process image BLOB data directly without saving to centralized folder
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml'
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid image file format (${file.mimetype}). Only JPG, PNG, WEBP, GIF, and SVG are permitted.`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 150 // Allow up to 150 images per event
  }
});

module.exports = upload;
