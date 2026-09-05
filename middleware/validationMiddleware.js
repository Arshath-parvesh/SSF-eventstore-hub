const { logAuditEvent } = require('../services/auditService');

/**
 * Sanitize string inputs (XSS / SQL Injection prevention)
 */
function sanitizeInput(str) {
  if (typeof str !== 'string') return str;
  return str
    .trim()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Validation rule runner: throws HTTP 400 error if validation fails
 */
function validateUserCreation(req, res, next) {
  const { username, email, contact_no, contact_address, aadhaar, password, unit_type } = req.body;

  const errors = [];

  if (!username || username.trim().length < 3) {
    errors.push('Username must be at least 3 characters long.');
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Valid email address is required.');
  }

  if (!contact_no || !/^\d{10}$/.test(contact_no.replace(/\D/g, ''))) {
    errors.push('Valid 10-digit contact number is required.');
  }

  if (!contact_address || contact_address.trim().length < 5) {
    errors.push('Contact address must be at least 5 characters long.');
  }

  if (!aadhaar || !/^\d{12}$/.test(aadhaar.replace(/\D/g, ''))) {
    errors.push('Valid 12-digit Aadhaar number is required.');
  }

  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters long.');
  }

  if (!unit_type || !['unit', 'district', 'state'].includes(unit_type)) {
    errors.push('Unit type must be unit, district, or state.');
  }

  if (errors.length > 0) {
    logAuditEvent(req.session?.user?.user_no, 'INPUT_VALIDATION_FAILURE', 'USER_MANAGEMENT', null, req.ip);
    const err = new Error(`Validation Error: ${errors.join(' ')}`);
    err.status = 400;
    return next(err);
  }

  // Sanitize body fields
  req.body.username = sanitizeInput(username);
  req.body.email = sanitizeInput(email);
  req.body.contact_no = sanitizeInput(contact_no);
  req.body.contact_address = sanitizeInput(contact_address);
  req.body.secondary_no = sanitizeInput(req.body.secondary_no || '');
  req.body.secondary_address = sanitizeInput(req.body.secondary_address || '');
  req.body.is_admin = (req.body.is_admin === '1' || req.body.is_admin === 1 || req.body.is_admin === true) ? 1 : 0;

  next();
}

/**
 * Validate Event Creation Payload
 */
function validateEventCreation(req, res, next) {
  const { title, categories, event_date } = req.body;

  const errors = [];

  if (!title || title.trim().length < 3) {
    errors.push('Event title must be at least 3 characters long.');
  }

  if (!event_date || !/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
    errors.push('Valid event date (YYYY-MM-DD) is required.');
  }

  if (!categories || (Array.isArray(categories) && categories.length === 0)) {
    errors.push('At least one event category is required.');
  }

  if (errors.length > 0) {
    logAuditEvent(req.session?.user?.user_no, 'INPUT_VALIDATION_FAILURE', 'EVENT_RECORD', null, req.ip);
    const err = new Error(`Validation Error: ${errors.join(' ')}`);
    err.status = 400;
    return next(err);
  }

  req.body.title = sanitizeInput(title);
  req.body.description = sanitizeInput(req.body.description || '');
  req.body.notes = sanitizeInput(req.body.notes || '');
  next();
}

module.exports = {
  validateUserCreation,
  validateEventCreation,
  sanitizeInput
};
