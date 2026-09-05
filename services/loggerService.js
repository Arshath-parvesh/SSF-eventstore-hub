/**
 * SSF EventStore Hub - System Logger Module
 * Enterprise structured logging utility. Ensures log outputs strictly exclude
 * sensitive User PII (names, emails, phones, addresses, passwords, Aadhaar).
 */

/**
 * Log informational messages.
 * @param {string} message - Description of the event.
 * @param {object} [metadata={}] - Key-value details to include.
 */
function info(message, metadata = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[INFO] [${timestamp}] ${message} ${sanitizeMetadata(metadata)}`);
}

/**
 * Log warning messages.
 * @param {string} message - Warning message.
 * @param {object} [metadata={}] - Context metadata.
 */
function warn(message, metadata = {}) {
  const timestamp = new Date().toISOString();
  console.warn(`[WARN] [${timestamp}] ${message} ${sanitizeMetadata(metadata)}`);
}

/**
 * Log error messages.
 * @param {string} message - Error description.
 * @param {object} [metadata={}] - Context metadata.
 */
function error(message, metadata = {}) {
  const timestamp = new Date().toISOString();
  console.error(`[ERROR] [${timestamp}] ${message} ${sanitizeMetadata(metadata)}`);
}

/**
 * Redact sensitive PII fields from log payloads.
 * @param {object} meta - Metadata object.
 * @returns {string} Sanitized JSON string or empty string.
 */
function sanitizeMetadata(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const clean = { ...meta };
  const piiFields = [
    'username',
    'email',
    'contact_no',
    'secondary_no',
    'contact_address',
    'secondary_address',
    'aadhaar',
    'password',
    'title',
    'categories'
  ];
  for (const field of piiFields) {
    if (clean[field]) {
      clean[field] = '[REDACTED]';
    }
  }
  return JSON.stringify(clean);
}

const logger = { info, warn, error, sanitizeMetadata };

module.exports = {
  info,
  warn,
  error,
  logger,
  loggerService: logger
};

