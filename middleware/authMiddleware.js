const db = require('../config/database');

/**
 * Authentication & Inactive Lockout Middleware
 * Checks session existence and re-verifies user active status live from DB on every request.
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'Authentication required. Please login.' });
    }
    return res.redirect('/login?error=' + encodeURIComponent('Please log in to access this page.'));
  }

  // LIVE DB Check: Ensure user is still active (NEVER CACHED)
  const user = db.prepare(`SELECT user_no, username, unit_type, state_name, district_name, unit_name, is_admin, status FROM users WHERE user_no = ?`).get(req.session.user.user_no);

  if (!user || user.status !== 'active') {
    // Destroy session immediately if account has been deactivated
    req.session.destroy();
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ error: 'Your account has been deactivated by an Administrator.' });
    }
    return res.redirect('/login?error=' + encodeURIComponent('Your account has been deactivated by an Administrator.'));
  }

  // Update session object with fresh state
  req.session.user = {
    user_no: user.user_no,
    username: user.username,
    unit_type: user.unit_type,
    state_name: user.state_name || 'Tamil Nadu',
    district_name: user.district_name || 'Chennai',
    unit_name: user.unit_name || 'Sholinganallur',
    is_admin: Boolean(user.is_admin),
    status: user.status
  };

  res.locals.currentUser = req.session.user;
  next();
}

/**
 * Guest Middleware: Redirects logged-in users away from /login
 */
function requireGuest(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect('/events');
  }
  next();
}

module.exports = {
  requireAuth,
  requireGuest
};
