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
      aadhaar_masked TEXT,
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
      description TEXT DEFAULT '',
      notes TEXT DEFAULT '',
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

  // Migrations for existing database instances: Add columns safely if missing
  function safeAddColumn(table, colName, colDef) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      if (!cols.includes(colName)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
      }
    } catch (err) {
      if (!err.message || !err.message.includes('duplicate column name')) {
        throw err;
      }
    }
  }

  safeAddColumn('users', 'state_name', `state_name TEXT NOT NULL DEFAULT 'Tamil Nadu'`);
  safeAddColumn('users', 'district_name', `district_name TEXT DEFAULT 'Chennai'`);
  safeAddColumn('users', 'unit_name', `unit_name TEXT DEFAULT 'Sholinganallur'`);
  safeAddColumn('users', 'aadhaar_masked', `aadhaar_masked TEXT`);

  // Backfill aadhaar_masked for any existing user records
  const { maskAadhaar } = require('./security');
  const unmasked = db.prepare(`SELECT id, aadhaar_encrypted FROM users WHERE aadhaar_masked IS NULL`).all();
  if (unmasked.length > 0) {
    const updateStmt = db.prepare(`UPDATE users SET aadhaar_masked = ? WHERE id = ?`);
    for (const u of unmasked) {
      updateStmt.run(maskAadhaar(u.aadhaar_encrypted), u.id);
    }
  }

  safeAddColumn('event_records', 'state_name', `state_name TEXT NOT NULL DEFAULT 'Tamil Nadu'`);
  safeAddColumn('event_records', 'district_name', `district_name TEXT DEFAULT 'Chennai'`);
  safeAddColumn('event_records', 'unit_name', `unit_name TEXT DEFAULT 'Sholinganallur'`);
  safeAddColumn('event_records', 'description', `description TEXT DEFAULT ''`);
  safeAddColumn('event_records', 'notes', `notes TEXT DEFAULT ''`);

  // Backfill sample description and notes for any existing event records
  const blankEvents = db.prepare(`SELECT record_id, title FROM event_records WHERE description IS NULL OR description = ''`).all();
  if (blankEvents.length > 0) {
    const updateEventDesc = db.prepare(`UPDATE event_records SET description = ?, notes = ? WHERE record_id = ?`);
    for (const ev of blankEvents) {
      updateEventDesc.run(
        `Official proceedings and institutional documentation for ${ev.title}. Organized under the guidance of the Sunni Students' Federation (SSF) Tamil Nadu State Committee. The convention brought together registered unit delegates, state executive council members, campus leaders, and community volunteers to review key educational programs, higher academic guidance, moral mentorship initiatives, and student welfare activities across Tamil Nadu. Detailed resolutions were passed unanimously regarding regional student empowerment, merit awards, campus awareness conventions, and youth leadership training. The program concluded with formal commemorations honoring distinguished scholars, educators, and outstanding youth activists who have contributed significantly to student welfare and educational excellence.`,
        'Archived in the official SSF Tamil Nadu provenance database. Approved by the state committee executive council.',
        ev.record_id
      );
    }
  }

  // Create performance indexes after schema migrations
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_userno ON users(user_no);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_events_unit ON event_records(unit_type);
    CREATE INDEX IF NOT EXISTS idx_events_state ON event_records(state_name);
    CREATE INDEX IF NOT EXISTS idx_events_district ON event_records(district_name);
    CREATE INDEX IF NOT EXISTS idx_events_user ON event_records(user_no);
    CREATE INDEX IF NOT EXISTS idx_events_created ON event_records(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_date ON event_records(event_date);
    CREATE INDEX IF NOT EXISTS idx_events_filter ON event_records(state_name, district_name, unit_name, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_images_record ON event_images(event_record_id);
    CREATE INDEX IF NOT EXISTS idx_images_record_id ON event_images(event_record_id, id);
    CREATE INDEX IF NOT EXISTS idx_entitlements_user ON user_entitlements(user_no);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
  `);
}

initDatabase();

module.exports = db;
