const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// AES-256-GCM Configuration for Encryption at Rest
const ALGORITHM = 'aes-256-gcm';
// Secure 32-byte key derived via scrypt (Environment variable or default secret)
const SECRET = process.env.ENCRYPTION_SECRET || 'antigravity-event-mgmt-secret-key-2026';
const ENCRYPTION_KEY = crypto.scryptSync(SECRET, 'salt-vibe-code', 32);

/**
 * Encrypt sensitive string data (e.g., Aadhaar number)
 */
function encryptData(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(12); // 12 bytes IV for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt encrypted sensitive data
 */
function decryptData(encryptedPayload) {
  if (!encryptedPayload || !encryptedPayload.includes(':')) return encryptedPayload;
  try {
    const parts = encryptedPayload.split(':');
    if (parts.length !== 3) return encryptedPayload;
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return 'Decryption Error';
  }
}

/**
 * Mask Aadhaar number for safe UI display (e.g. 123456789012 -> XXXX-XXXX-9012)
 */
function maskAadhaar(rawOrEncrypted) {
  let raw = rawOrEncrypted;
  if (raw && raw.includes(':')) {
    raw = decryptData(rawOrEncrypted);
  }
  if (!raw || raw.length < 4) return 'XXXX-XXXX-XXXX';
  const clean = raw.replace(/\D/g, '');
  if (clean.length >= 4) {
    const last4 = clean.slice(-4);
    return `XXXX-XXXX-${last4}`;
  }
  return 'XXXX-XXXX-XXXX';
}

/**
 * Hash password securely using bcrypt
 */
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
}

/**
 * Verify plaintext password against hash
 */
async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

/**
 * Generate CSRF Token
 */
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  encryptData,
  decryptData,
  maskAadhaar,
  hashPassword,
  verifyPassword,
  generateCsrfToken
};
