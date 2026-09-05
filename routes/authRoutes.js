const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authenticateUser } = require('../services/userService');
const { logAuditEvent } = require('../services/auditService');
const { requireGuest, requireAuth } = require('../middleware/authMiddleware');

// Rate limiting for login endpoint (Max 15 attempts per 15 minutes)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: 'Too many login attempts. Please try again after 15 minutes.'
});

// GET /login
router.get('/login', requireGuest, (req, res) => {
  let errorMsg = req.query.error || null;
  const successMsg = req.query.success || null;

  if (req.query.expired) {
    errorMsg = 'Your session has expired due to 5 minutes of inactivity. For your security, please sign in again.';
  }

  res.render('auth/login', {
    title: 'Login - Secure Event Management',
    error: errorMsg,
    success: successMsg
  });
});

// POST /login
router.post('/login', loginLimiter, requireGuest, async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.redirect('/login?error=' + encodeURIComponent('Username and Password are required.'));
    }

    const result = await authenticateUser(username, password);

    if (!result.success) {
      logAuditEvent('ANONYMOUS', 'LOGIN_FAILURE', 'AUTH', null, req.ip);
      return res.redirect('/login?error=' + encodeURIComponent(result.reason));
    }

    // Set session user & initialize activity timestamp
    req.session.user = {
      user_no: result.user.user_no,
      username: result.user.username,
      unit_type: result.user.unit_type,
      state_name: result.user.state_name || 'Tamil Nadu',
      district_name: result.user.district_name || 'Chennai',
      unit_name: result.user.unit_name || 'Sholinganallur',
      is_admin: Boolean(result.user.is_admin),
      status: result.user.status
    };
    req.session.lastActivity = Date.now();

    logAuditEvent(result.user.user_no, 'LOGIN_SUCCESS', 'AUTH', null, req.ip);

    // Redirect to admin dashboard if admin, else events list
    if (result.user.is_admin) {
      res.redirect('/admin');
    } else {
      res.redirect('/events');
    }
  } catch (err) {
    next(err);
  }
});

// GET /logout
router.get('/logout', (req, res) => {
  const userNo = req.session?.user?.user_no;
  if (userNo) {
    logAuditEvent(userNo, req.query.reason === 'idle' ? 'SESSION_EXPIRED_IDLE' : 'LOGOUT', 'AUTH', null, req.ip);
  }
  if (req.session) {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      if (req.query.reason === 'idle') {
        return res.redirect('/login?expired=1');
      }
      res.redirect('/login?success=' + encodeURIComponent('You have been logged out safely.'));
    });
  } else {
    res.redirect(req.query.reason === 'idle' ? '/login?expired=1' : '/login');
  }
});

// POST /logout
router.post('/logout', requireAuth, (req, res) => {
  const userNo = req.session.user?.user_no;
  logAuditEvent(userNo, req.query.reason === 'idle' ? 'SESSION_EXPIRED_IDLE' : 'LOGOUT', 'AUTH', null, req.ip);
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    if (req.query.reason === 'idle') {
      return res.redirect('/login?expired=1');
    }
    res.redirect('/login?success=' + encodeURIComponent('You have been logged out safely.'));
  });
});

module.exports = router;
