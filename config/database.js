const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data.sqlite');
const db = new Database(dbPath, { verbose: null });

// High Concurrency SQLite Optimization (WAL Mode)
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('cache_size = -64000'); // 64MB Cache
db.pragma('foreign_keys = ON');

// Initialize Database Schemas
function initDatabase() {
  db.exec(`
    -- Users Table
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_no TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      contact_no TEXT NOT NULL,
      secondary_no TEXT,
      contact_address TEXT NOT NULL,
      secondary_address TEXT,
      aadhaar_encrypted TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      unit_type TEXT CHECK(unit_type IN ('unit', 'district', 'state')) NOT NULL,
      state_name TEXT NOT NULL DEFAULT 'Tamil Nadu',
      district_name TEXT DEFAULT 'Chennai',
      unit_name TEXT DEFAULT 'Sholinganallur',
      is_admin INTEGER DEFAULT 0,
      status TEXT CHECK(status IN ('active', 'inactive')) DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Event Records Table
    CREATE TABLE IF NOT EXISTS event_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT UNIQUE NOT NULL,
      unit_type TEXT CHECK(unit_type IN ('unit', 'district', 'state')) NOT NULL,
      state_name TEXT NOT NULL DEFAULT 'Tamil Nadu',
      district_name TEXT DEFAULT 'Chennai',
      unit_name TEXT DEFAULT 'Sholinganallur',
      user_no TEXT NOT NULL,
      title TEXT NOT NULL,
      categories TEXT NOT NULL,
      event_date DATE NOT NULL,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_no) REFERENCES users(user_no)
    );

    -- Event Images Table (BLOB storage in database)
    CREATE TABLE IF NOT EXISTS event_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_record_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      image_data BLOB NOT NULL,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_record_id) REFERENCES event_records(record_id) ON DELETE CASCADE
    );

    -- User Entitlements Table
    CREATE TABLE IF NOT EXISTS user_entitlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_no TEXT NOT NULL,
      unit_type TEXT NOT NULL,
      entitlement TEXT NOT NULL,
      granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_no) REFERENCES users(user_no)
    );

    -- States Table
    CREATE TABLE IF NOT EXISTS states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      code TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Districts Table
    CREATE TABLE IF NOT EXISTS districts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (state_id) REFERENCES states(id) ON DELETE CASCADE,
      UNIQUE(state_id, name)
    );

    -- Units Table
    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      district_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (district_id) REFERENCES districts(id) ON DELETE CASCADE,
      UNIQUE(district_id, name)
    );

    -- PII-Free Audit Logs Table
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_no TEXT NOT NULL,
      action_code TEXT NOT NULL,
      category TEXT NOT NULL,
      target_id TEXT,
      ip_address TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrations for existing database instances: Add columns if missing
  const userColumns = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
  if (!userColumns.includes('state_name')) {
    db.exec(`ALTER TABLE users ADD COLUMN state_name TEXT NOT NULL DEFAULT 'Tamil Nadu'`);
  }
  if (!userColumns.includes('district_name')) {
    db.exec(`ALTER TABLE users ADD COLUMN district_name TEXT DEFAULT 'Chennai'`);
  }
  if (!userColumns.includes('unit_name')) {
    db.exec(`ALTER TABLE users ADD COLUMN unit_name TEXT DEFAULT 'Sholinganallur'`);
  }

  const eventColumns = db.prepare(`PRAGMA table_info(event_records)`).all().map(c => c.name);
  if (!eventColumns.includes('state_name')) {
    db.exec(`ALTER TABLE event_records ADD COLUMN state_name TEXT NOT NULL DEFAULT 'Tamil Nadu'`);
  }
  if (!eventColumns.includes('district_name')) {
    db.exec(`ALTER TABLE event_records ADD COLUMN district_name TEXT DEFAULT 'Chennai'`);
  }
  if (!eventColumns.includes('unit_name')) {
    db.exec(`ALTER TABLE event_records ADD COLUMN unit_name TEXT DEFAULT 'Sholinganallur'`);
  }

  // Create performance indexes after schema migrations
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_userno ON users(user_no);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_events_unit ON event_records(unit_type);
    CREATE INDEX IF NOT EXISTS idx_events_state ON event_records(state_name);
    CREATE INDEX IF NOT EXISTS idx_events_district ON event_records(district_name);
    CREATE INDEX IF NOT EXISTS idx_events_user ON event_records(user_no);
    CREATE INDEX IF NOT EXISTS idx_images_record ON event_images(event_record_id);
    CREATE INDEX IF NOT EXISTS idx_entitlements_user ON user_entitlements(user_no);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
  `);
}

initDatabase();

module.exports = db;
