const db = require('../config/database');
const { encryptData, hashPassword, verifyPassword } = require('../config/security');

/**
 * Generate unique immutable UserNo (e.g. USR-1001, ADM-0001)
 */
function generateUserNo(isAdmin = false) {
  const prefix = isAdmin ? 'ADM' : 'USR';
  const row = db.prepare(`SELECT COUNT(*) as count FROM users WHERE is_admin = ?`).get(isAdmin ? 1 : 0);
  const nextId = (row ? row.count : 0) + 1;
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

  const userNo = generateUserNo(Boolean(is_admin));
  const passwordHash = await hashPassword(password);
  const encryptedAadhaar = encryptData(aadhaar);

  const stmt = db.prepare(`
    INSERT INTO users (
      user_no, username, email, contact_no, secondary_no,
      contact_address, secondary_address, aadhaar_encrypted,
      password_hash, unit_type, state_name, district_name, unit_name, is_admin, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    passwordHash,
    unit_type,
    state_name,
    district_name || null,
    unit_name || null,
    is_admin ? 1 : 0,
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
           contact_address, secondary_address, aadhaar_encrypted,
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

module.exports = {
  createUser,
  getUserByNo,
  getUserByUsername,
  authenticateUser,
  getAllUsers,
  setUserStatus
};
