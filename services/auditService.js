const db = require('../config/database');

/**
 * PII-Free Audit Logging Service
 * Records audit trails without storing any user PII (no names, emails, phones, addresses, passwords, or titles).
 */
const stmtInsertAudit = db.prepare(`
  INSERT INTO audit_logs (user_no, action_code, category, target_id, ip_address)
  VALUES (?, ?, ?, ?, ?)
`);

function logAuditEvent(userNo, actionCode, category, targetId = null, ipAddress = '0.0.0.0') {
  try {
    // Mask IP address subnet for enhanced privacy (e.g. 192.168.1.50 -> 192.168.1.0)
    const sanitizedIp = ipAddress ? ipAddress.replace(/\.\d+$/, '.0') : '0.0.0.0';
    stmtInsertAudit.run(userNo || 'ANONYMOUS', actionCode, category, targetId || null, sanitizedIp);
  } catch (err) {
    console.error(`[AUDIT LOG ERROR] ${actionCode} failed: ${err.message}`);
  }
}

function getAuditLogs(limit = 100) {
  return db.prepare(`
    SELECT id, user_no, action_code, category, target_id, ip_address, timestamp
    FROM audit_logs
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit);
}

module.exports = {
  logAuditEvent,
  getAuditLogs
};
