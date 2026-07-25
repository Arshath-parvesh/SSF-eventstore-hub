const { getUserEntitlements } = require('../services/entitlementService');
const { logAuditEvent } = require('../services/auditService');

/**
 * Require Admin privileges
 */
function requireAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.is_admin) {
    logAuditEvent(req.session.user?.user_no, 'UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT', 'SECURITY', null, req.ip);
    const err = new Error('Unauthorized Action: Admin privileges required.');
    err.status = 403;
    return next(err);
  }
  next();
}

/**
 * Require specific user entitlement
 */
function requireEntitlement(entitlementName) {
  return (req, res, next) => {
    const userNo = req.session.user?.user_no;
    if (!userNo) {
      const err = new Error('Authentication required.');
      err.status = 401;
      return next(err);
    }

    const entitlements = getUserEntitlements(userNo);
    // Super admins bypass entitlement restrictions for system maintenance
    if (!req.session.user.is_admin && !entitlements.includes(entitlementName)) {
      logAuditEvent(userNo, 'UNAUTHORIZED_ENTITLEMENT_ATTEMPT', 'SECURITY', entitlementName, req.ip);
      const err = new Error(`Unauthorized Action: You lack the required entitlement (${entitlementName}).`);
      err.status = 403;
      return next(err);
    }
    next();
  };
}

module.exports = {
  requireAdmin,
  requireEntitlement
};
