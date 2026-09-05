const express = require('express');
const router = express.Router();
const { getSessionConfig } = require('../middleware/sessionTimeoutMiddleware');
const { logAuditEvent } = require('../services/auditService');

/**
 * GET /api/session/status
 * Queries current session validity and remaining idle time without resetting activity timer
 */
router.get('/status', (req, res) => {
  const config = getSessionConfig();

  if (!req.session || !req.session.user) {
    return res.json({
      authenticated: false,
      expired: true,
      remainingMs: 0
    });
  }

  const now = Date.now();
  const lastActivity = req.session.lastActivity || now;
  const idleElapsed = now - lastActivity;
  const remainingMs = Math.max(0, config.idleTimeoutMs - idleElapsed);

  if (remainingMs <= 0) {
    const userNo = req.session.user.user_no;
    try {
      logAuditEvent(userNo, 'SESSION_EXPIRED_IDLE', 'AUTH', null, req.ip);
    } catch (e) {}

    return req.session.destroy(() => {
      res.clearCookie('connect.sid');
      return res.json({
        authenticated: false,
        expired: true,
        remainingMs: 0
      });
    });
  }

  return res.json({
    authenticated: true,
    expired: false,
    remainingMs,
    idleTimeoutMs: config.idleTimeoutMs,
    sessionIdleTimeoutMinutes: config.sessionIdleTimeoutMinutes,
    warningCountdownSeconds: config.warningCountdownSeconds,
    heartbeatIntervalSeconds: config.heartbeatIntervalSeconds
  });
});

/**
 * POST /api/session/heartbeat
 * Explicit activity heartbeat triggered when user interacts with the UI
 */
router.post('/heartbeat', (req, res) => {
  const config = getSessionConfig();

  if (!req.session || !req.session.user) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      expired: true,
      message: 'Session not found or expired.'
    });
  }

  const now = Date.now();
  const lastActivity = req.session.lastActivity || now;

  // If already expired prior to heartbeat
  if (now - lastActivity > config.idleTimeoutMs) {
    return req.session.destroy(() => {
      res.clearCookie('connect.sid');
      return res.status(401).json({
        success: false,
        authenticated: false,
        expired: true,
        message: 'Session has already expired due to inactivity.'
      });
    });
  }

  // Refresh activity
  req.session.lastActivity = now;

  return res.json({
    success: true,
    authenticated: true,
    remainingMs: config.idleTimeoutMs
  });
});

/**
 * POST /api/session/timeout
 * Triggered by the UI when the 5-minute inactivity timer expires
 */
router.post('/timeout', (req, res) => {
  const userNo = req.session?.user?.user_no;
  if (userNo) {
    try {
      logAuditEvent(userNo, 'SESSION_EXPIRED_IDLE', 'AUTH', null, req.ip);
    } catch (e) {}
  }

  if (req.session) {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      return res.json({
        success: true,
        expired: true,
        redirect: '/login?expired=1'
      });
    });
  } else {
    res.clearCookie('connect.sid');
    return res.json({
      success: true,
      expired: true,
      redirect: '/login?expired=1'
    });
  }
});

module.exports = router;
