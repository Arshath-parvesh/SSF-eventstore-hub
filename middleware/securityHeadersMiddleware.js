/**
 * Comprehensive Security Headers Middleware
 * Protects against MitM (Man-in-the-Middle), XSS, Clickjacking, MIME Sniffing, and Parameter Pollution.
 */

function applySecurityHeaders(req, res, next) {
  // Prevent Man-in-the-Middle (MitM) SSL Downgrades (HSTS)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  // Prevent Clickjacking Attacks by disallowing frame embedding
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME-type Sniffing Attacks
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Enable Browser XSS Filtering
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Strict Referrer Policy to prevent sensitive URL parameter leakage
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy (CSP) to block unauthorized inline scripts & external exploits
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self';"
  );

  // Anti-caching headers for sensitive dynamic pages (Prevent back-button caching & resubmission)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  next();
}

/**
 * URL Parameter Sanitization & Path Traversal Protection Middleware
 */
function sanitizeUrlParameters(req, res, next) {
  try {
    // Prevent Path Traversal & Directory Traversal sequences in URL params & query
    const traverseRegex = /(\.\.[\/\\]|%2e%2e)/i;

    for (const key in req.params) {
      if (typeof req.params[key] === 'string' && traverseRegex.test(req.params[key])) {
        const err = new Error('Security Violation: Illegal path traversal sequence in URL parameter.');
        err.status = 400;
        return next(err);
      }
    }

    for (const key in req.query) {
      if (typeof req.query[key] === 'string' && traverseRegex.test(req.query[key])) {
        const err = new Error('Security Violation: Illegal path traversal sequence in query parameter.');
        err.status = 400;
        return next(err);
      }
    }

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  applySecurityHeaders,
  sanitizeUrlParameters
};
