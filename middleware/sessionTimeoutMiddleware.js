const fs = require('fs');
const path = require('path');
const { logAuditEvent } = require('../services/auditService');

/**
 * Loads session inactivity configuration from non-JS config file (config/session.json or .env)
 */
function getSessionConfig() {
  let minutes = 5;
  let warningCountdownSeconds = 30;
  let heartbeatIntervalSeconds = 30;

  try {
    const configPath = path.join(__dirname, '../config/session.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.sessionIdleTimeoutMinutes && !isNaN(Number(data.sessionIdleTimeoutMinutes))) {
        minutes = Number(data.sessionIdleTimeoutMinutes);
      }
      if (data.warningCountdownSeconds && !isNaN(Number(data.warningCountdownSeconds))) {
        warningCountdownSeconds = Number(data.warningCountdownSeconds);
      }
      if (data.heartbeatIntervalSeconds && !isNaN(Number(data.heartbeatIntervalSeconds))) {
        heartbeatIntervalSeconds = Number(data.heartbeatIntervalSeconds);
      }
    }
  } catch (e) {
    console.warn('[SessionConfig] Notice: Falling back to default session configuration:', e.message);
  }

  // Allow .env override if specified
  if (process.env.SESSION_IDLE_TIMEOUT_MINUTES && !isNaN(Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES))) {
    minutes = Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES);
  }

  return {
    sessionIdleTimeoutMinutes: minutes,
    idleTimeoutMs: minutes * 60 * 1000,
    warningCountdownSeconds,
    heartbeatIntervalSeconds
  };
}

/**
 * Session Idle Timeout Middleware
 * Enforces inactivity cutoff at server level and exposes timeout parameters to UI
 */
function sessionTimeoutMiddleware(req, res, next) {
  const config = getSessionConfig();
  res.locals.sessionTimeout = config;
  req.sessionTimeoutConfig = config;

  if (req.session && req.session.user) {
    const now = Date.now();
    const lastActivity = req.session.lastActivity || now;
    const idleElapsed = now - lastActivity;

    // Check if inactivity exceeds timeout threshold
    if (idleElapsed > config.idleTimeoutMs) {
      const userNo = req.session.user.user_no;
      try {
        logAuditEvent(userNo, 'SESSION_EXPIRED_IDLE', 'AUTH', null, req.ip);
      } catch (err) {
        // Continue logout even if audit logging encounters an issue
      }

      return req.session.destroy(() => {
        res.clearCookie('connect.sid');
        if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api/')) {
          return res.status(401).json({
            success: false,
            expired: true,
            message: `Your session has expired due to ${config.sessionIdleTimeoutMinutes} minutes of inactivity.`
          });
        }
        return res.redirect('/login?expired=1');
      });
    }

    // Status polling endpoints must NOT refresh activity timestamp
    if (req.path === '/api/session/status') {
      return next();
    }

    // Active request refreshes last activity timestamp
    req.session.lastActivity = now;
  }

  next();
}

module.exports = {
  getSessionConfig,
  sessionTimeoutMiddleware
};
