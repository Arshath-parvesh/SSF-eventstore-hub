const db = require('../config/database');
const cacheService = require('./cacheService');

/**
 * Get user entitlements by UserNo (cached)
 */
function getUserEntitlements(userNo) {
  const cacheKey = `entitlements:${userNo}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  const rows = db.prepare(`
    SELECT entitlement FROM user_entitlements WHERE user_no = ?
  `).all(userNo);

  const entitlements = rows.map(r => r.entitlement);
  cacheService.set(cacheKey, entitlements, 180); // 3 minutes cache
  return entitlements;
}

/**
 * Assign default entitlements for a new user based on unit type and admin status
 */
function assignDefaultEntitlements(userNo, unitType, isAdmin = false, stateName = 'Tamil Nadu', districtName = 'Chennai', unitName = 'Sholinganallur') {
  const stmt = db.prepare(`
    INSERT INTO user_entitlements (user_no, unit_type, entitlement)
    VALUES (?, ?, ?)
  `);

  const sanitizeName = (str) => String(str || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');

  const transaction = db.transaction(() => {
    // Base viewing entitlement
    stmt.run(userNo, unitType, 'VIEW_RECORDS');

    // Jurisdiction-specific entitlements
    if (stateName) stmt.run(userNo, unitType, `STATE_${sanitizeName(stateName)}`);
    if (districtName) stmt.run(userNo, unitType, `DISTRICT_${sanitizeName(districtName)}`);
    if (unitName) stmt.run(userNo, unitType, `UNIT_${sanitizeName(unitName)}`);

    if (unitType === 'unit') {
      stmt.run(userNo, unitType, 'CREATE_UNIT_RECORD');
      stmt.run(userNo, unitType, 'DELETE_UNIT_RECORD');
    } else if (unitType === 'district') {
      stmt.run(userNo, unitType, 'CREATE_DISTRICT_RECORD');
      stmt.run(userNo, unitType, 'DELETE_DISTRICT_RECORD');
      stmt.run(userNo, unitType, 'ACCESS_ALL_DISTRICT_UNITS');
    } else if (unitType === 'state') {
      stmt.run(userNo, unitType, 'CREATE_STATE_RECORD');
      stmt.run(userNo, unitType, 'DELETE_STATE_RECORD');
      stmt.run(userNo, unitType, 'ACCESS_ALL_STATE_DISTRICTS');
      stmt.run(userNo, unitType, 'ACCESS_ALL_STATE_UNITS');
    }

    if (isAdmin) {
      stmt.run(userNo, unitType, 'MANAGE_USERS');
      stmt.run(userNo, unitType, 'MANAGE_ENTITLEMENTS');
      stmt.run(userNo, unitType, 'VIEW_AUDIT_LOGS');
    }
  });

  transaction();
  cacheService.delete(`entitlements:${userNo}`);
}

/**
 * Add or update entitlement for user
 */
function addEntitlement(userNo, unitType, entitlement) {
  const existing = db.prepare(`
    SELECT id FROM user_entitlements WHERE user_no = ? AND entitlement = ?
  `).get(userNo, entitlement);

  if (!existing) {
    db.prepare(`
      INSERT INTO user_entitlements (user_no, unit_type, entitlement)
      VALUES (?, ?, ?)
    `).run(userNo, unitType, entitlement);
    cacheService.delete(`entitlements:${userNo}`);
  }
}

/**
 * Remove entitlement from user
 */
function removeEntitlement(userNo, entitlement) {
  db.prepare(`
    DELETE FROM user_entitlements WHERE user_no = ? AND entitlement = ?
  `).run(userNo, entitlement);
  cacheService.delete(`entitlements:${userNo}`);
}

/**
 * Get all entitlement records for admin view
 */
function getAllEntitlements() {
  return db.prepare(`
    SELECT e.id, e.user_no, e.unit_type, e.entitlement, e.granted_at, u.username
    FROM user_entitlements e
    JOIN users u ON e.user_no = u.user_no
    ORDER BY e.granted_at DESC
  `).all();
}

module.exports = {
  getUserEntitlements,
  assignDefaultEntitlements,
  addEntitlement,
  removeEntitlement,
  getAllEntitlements
};
