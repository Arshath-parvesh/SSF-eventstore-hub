const multer = require('multer');
const { loggerService } = require('../services/loggerService');

/**
 * 404 Not Found Middleware
 */
function notFoundHandler(req, res, next) {
  const err = new Error(`Resource Not Found: The requested URL '${req.originalUrl}' does not exist on this server.`);
  err.status = 404;
  next(err);
}

/**
 * Centralized Comprehensive Error Handler Middleware
 * Handles 400, 401, 403, 404, 413, 422, 500, Multer, CSRF, and SQLite errors safely.
 */
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message || 'An unexpected server error occurred.';

  // Handle Multer upload errors
  if (err instanceof multer.MulterError) {
    status = 400;
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'Upload Error: File size exceeds the maximum limit of 10MB per image.';
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      message = 'Upload Error: Maximum file upload limit of 150 images per event exceeded.';
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      message = 'Upload Error: Unexpected file field name during upload.';
    } else {
      message = `Upload Error: ${err.message}`;
    }
  }

  // Handle SQLite constraint violations
  if (err.code && String(err.code).startsWith('SQLITE_')) {
    status = 400;
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      message = 'Database Conflict: A record with matching unique parameters already exists.';
    } else if (err.code === 'SQLITE_BUSY') {
      status = 503;
      message = 'Database Busy: The database is handling heavy write concurrency. Please retry.';
    } else {
      message = 'Database Error: Transaction could not be completed.';
    }
  }

  // Log anonymized error without PII
  console.error(`[HTTP ${status}] Path: ${req.path} | Error: ${message}`);

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(status).json({
      status,
      error: message
    });
  }

  res.status(status).render('error', {
    status,
    message,
    title: `Error ${status} - Event Management System`,
    currentUser: req.session?.user || null
  });
}

module.exports = {
  notFoundHandler,
  errorHandler
};
