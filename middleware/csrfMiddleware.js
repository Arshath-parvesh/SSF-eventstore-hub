const { generateCsrfToken } = require('../config/security');
const { logAuditEvent } = require('../services/auditService');

/**
 * CSRF Protection Middleware (Double Submit Cookie)
 */
function csrfProtection(req, res, next) {
  // Ensure session exists
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }

  let secret = req.session?.csrfToken || req.cookies?._csrfSecret;

  if (!secret) {
    secret = generateCsrfToken();
    if (req.session) req.session.csrfToken = secret;
  }

  if (!req.cookies?._csrfSecret) {
    res.cookie('_csrfSecret', secret, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false // Set to true in production HTTPS
    });
  }

  res.locals.csrfToken = secret;
  req.csrfToken = () => secret;

  // Validate CSRF token on state-changing requests
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const tokenFromClient = req.body?._csrf || req.query?._csrf || req.headers['x-csrf-token'] || req.headers['x-xsrf-token'];
    const sessionToken = req.session?.csrfToken;
    const cookieToken = req.cookies?._csrfSecret;

    const isValid = tokenFromClient && (
      tokenFromClient === secret ||
      tokenFromClient === sessionToken ||
      tokenFromClient === cookieToken
    );

    if (!isValid) {
      logAuditEvent(req.session?.user?.user_no, 'CSRF_VALIDATION_FAILURE', 'SECURITY', null, req.ip);
      const err = new Error('Invalid or missing CSRF token. Request rejected for security reasons.');
      err.status = 403;
      return next(err);
    }
  }

  next();
}

module.exports = { csrfProtection };
