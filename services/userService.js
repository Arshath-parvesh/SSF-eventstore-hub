const db = require('../config/database');
const { encryptData, maskAadhaar, hashPassword, verifyPassword } = require('../config/security');

/**
 * Generate unique immutable UserNo (e.g. USR-1001, ADM-0001)
 * Monotonically increases based on highest existing ID for the prefix to avoid collisions
 */
function generateUserNo(isAdmin = false) {
  const prefix = isAdmin ? 'ADM' : 'USR';
  const rows = db.prepare(`SELECT user_no FROM users WHERE user_no LIKE ?`).all(`${prefix}-%`);
  let maxId = 0;
  for (const row of rows) {
    const parts = row.user_no.split('-');
    const numPart = parseInt(parts[1], 10);
    if (!isNaN(numPart) && numPart > maxId) {
      maxId = numPart;
    }
  }
  const nextId = maxId + 1;
  const numStr = String(nextId).padStart(4, '0');
  return `${prefix}-${numStr}`;
}

/**
 * Create a new user with all 11 required fields
 */
async function createUser(userData) {
  const {
    username,
    email,
    contact_no,
    secondary_no,
    contact_address,
    secondary_address,
    aadhaar,
    password,
    unit_type,
    state_name = 'Tamil Nadu',
    district_name = 'Chennai',
    unit_name = 'Sholinganallur',
    is_admin = 0,
    status = 'active'
  } = userData;

  // Verify uniqueness of username and email
  const existingUser = db.prepare(`SELECT id FROM users WHERE username = ? OR email = ?`).get(username, email);
  if (existingUser) {
    throw new Error('Username or Email already exists in system.');
  }

  const isAdmin = (is_admin === 1 || is_admin === '1' || is_admin === true) ? 1 : 0;
  const userNo = generateUserNo(isAdmin === 1);
  const passwordHash = await hashPassword(password);
  const encryptedAadhaar = encryptData(aadhaar);
  const maskedAadhaar = maskAadhaar(aadhaar);

  const stmt = db.prepare(`
    INSERT INTO users (
      user_no, username, email, contact_no, secondary_no,
      contact_address, secondary_address, aadhaar_encrypted, aadhaar_masked,
      password_hash, unit_type, state_name, district_name, unit_name, is_admin, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    userNo,
    username,
    email,
    contact_no,
    secondary_no || null,
    contact_address,
    secondary_address || null,
    encryptedAadhaar,
    maskedAadhaar,
    passwordHash,
    unit_type,
    state_name,
    district_name || null,
    unit_name || null,
    isAdmin,
    status
  );

  return getUserByNo(userNo);
}

/**
 * Get user profile by UserNo
 */
function getUserByNo(userNo) {
  return db.prepare(`
    SELECT id, user_no, username, email, contact_no, secondary_no,
           contact_address, secondary_address, aadhaar_encrypted, aadhaar_masked,
           unit_type, state_name, district_name, unit_name, is_admin, status, created_at
    FROM users WHERE user_no = ?
  `).get(userNo);
}

/**
 * Get user profile by Username for authentication
 */
function getUserByUsername(username) {
  return db.prepare(`
    SELECT * FROM users WHERE username = ?
  `).get(username);
}

/**
 * Authenticate credentials and return user profile if active
 */
async function authenticateUser(username, password) {
  const user = getUserByUsername(username);
  if (!user) return { success: false, reason: 'Invalid credentials' };

  if (user.status !== 'active') {
    return { success: false, reason: 'Account is inactive. Contact Administrator.' };
  }

  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) return { success: false, reason: 'Invalid credentials' };

  return { success: true, user };
}

/**
 * List all users with optional filtering
 */
function getAllUsers() {
  return db.prepare(`
    SELECT id, user_no, username, email, contact_no, unit_type, state_name, district_name, unit_name, is_admin, status, created_at
    FROM users ORDER BY created_at DESC
  `).all();
}

/**
 * Toggle active/inactive status of a user
 */
function setUserStatus(userNo, status) {
  if (!['active', 'inactive'].includes(status)) {
    throw new Error('Invalid user status value.');
  }
  db.prepare(`UPDATE users SET status = ? WHERE user_no = ?`).run(status, userNo);
  return getUserByNo(userNo);
}

/**
 * Grant or revoke admin role access for a user
 * Protected: The primary system admin account ('admin') cannot have admin access revoked.
 */
function setUserAdminRole(userNo, isAdmin) {
  const user = getUserByNo(userNo);
  if (!user) {
    throw new Error('User not found.');
  }

  // Primary admin protection
  if (user.username === 'admin' && !isAdmin) {
    throw new Error('Action blocked: Admin privileges for the primary "admin" user cannot be revoked.');
  }

  const adminVal = isAdmin ? 1 : 0;
  db.prepare(`UPDATE users SET is_admin = ? WHERE user_no = ?`).run(adminVal, userNo);

  // Sync admin entitlements
  const adminEntitlements = ['MANAGE_USERS', 'MANAGE_ENTITLEMENTS', 'VIEW_AUDIT_LOGS'];
  if (isAdmin) {
    const insertStmt = db.prepare(`
      INSERT INTO user_entitlements (user_no, unit_type, entitlement)
      VALUES (?, ?, ?)
    `);
    for (const ent of adminEntitlements) {
      const existing = db.prepare(`
        SELECT id FROM user_entitlements WHERE user_no = ? AND entitlement = ?
      `).get(userNo, ent);
      if (!existing) {
        insertStmt.run(userNo, user.unit_type, ent);
      }
    }
  } else {
    db.prepare(`
      DELETE FROM user_entitlements
      WHERE user_no = ? AND entitlement IN ('MANAGE_USERS', 'MANAGE_ENTITLEMENTS', 'VIEW_AUDIT_LOGS')
    `).run(userNo);
  }

  // Invalidate entitlement cache
  const cacheService = require('./cacheService');
  cacheService.delete(`entitlements:${userNo}`);

  return getUserByNo(userNo);
}

module.exports = {
  createUser,
  getUserByNo,
  getUserByUsername,
  authenticateUser,
  getAllUsers,
  setUserStatus,
  setUserAdminRole
};
