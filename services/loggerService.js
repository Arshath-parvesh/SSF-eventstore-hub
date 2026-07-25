/**
 * System Logger Module
 * Ensures log messages strictly exclude User PII (names, emails, phones, addresses, passwords, Aadhaar).
 */

function info(message, metadata = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[INFO] [${timestamp}] ${message} ${sanitizeMetadata(metadata)}`);
}

function warn(message, metadata = {}) {
  const timestamp = new Date().toISOString();
  console.warn(`[WARN] [${timestamp}] ${message} ${sanitizeMetadata(metadata)}`);
}

function error(message, metadata = {}) {
  const timestamp = new Date().toISOString();
  console.error(`[ERROR] [${timestamp}] ${message} ${sanitizeMetadata(metadata)}`);
}

function sanitizeMetadata(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const clean = { ...meta };
  // Redact PII fields if inadvertently passed
  const piiFields = ['username', 'email', 'contact_no', 'secondary_no', 'contact_address', 'secondary_address', 'aadhaar', 'password', 'title', 'categories'];
  for (const field of piiFields) {
    if (clean[field]) {
      clean[field] = '[REDACTED]';
    }
  }
  return JSON.stringify(clean);
}

module.exports = {
  info,
  warn,
  error
};
