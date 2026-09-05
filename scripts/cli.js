#!/usr/bin/env node

/**
 * SSF EventStore Hub - Administrative & Developer CLI Utility
 *
 * Usage:
 *   node scripts/cli.js [command]
 *
 * Commands:
 *   --stats    Display detailed counts and storage footprint
 *   --health   Verify SQLite WAL mode, foreign keys, and integrity check
 *   --vacuum   Defragment database pages and run optimization
 *   --seed     Seed initial administrators, hierarchy, and sample records
 *   --help     Show this manual
 */

const path = require('path');
const fs = require('fs');
const db = require('../config/database');

const args = process.argv.slice(2);
const command = args[0] || '--help';

async function main() {
  switch (command.toLowerCase()) {
    case '--stats':
    case '-s':
    case 'stats':
      printStats();
      break;

    case '--health':
    case '-h':
    case 'health':
      checkHealth();
      break;

    case '--vacuum':
    case '-v':
    case 'vacuum':
      vacuumDatabase();
      break;

    case '--seed':
      await runSeed();
      break;

    case '--help':
    default:
      printHelp();
      break;
  }
}

function printStats() {
  console.log('\n============================================================');
  console.log('       SSF EventStore Hub - Database Statistics');
  console.log('============================================================\n');

  try {
    const userCount = db.prepare('SELECT count(*) as c FROM users').get().c;
    const eventCount = db.prepare('SELECT count(*) as c FROM event_records').get().c;
    const imageCount = db.prepare('SELECT count(*) as c FROM event_images').get().c;
    const auditCount = db.prepare('SELECT count(*) as c FROM audit_logs').get().c;
    const stateCount = db.prepare('SELECT count(*) as c FROM states').get().c;
    const districtCount = db.prepare('SELECT count(*) as c FROM districts').get().c;
    const unitCount = db.prepare('SELECT count(*) as c FROM units').get().c;

    const dbPath = path.join(__dirname, '../data.sqlite');
    const walPath = path.join(__dirname, '../data.sqlite-wal');

    const dbSize = fs.existsSync(dbPath) ? (fs.statSync(dbPath).size / 1024 / 1024).toFixed(2) + ' MB' : 'N/A';
    const walSize = fs.existsSync(walPath) ? (fs.statSync(walPath).size / 1024 / 1024).toFixed(2) + ' MB' : 'N/A';

    console.table([
      { Metric: 'Total Registered Users', Value: userCount.toLocaleString() },
      { Metric: 'Total Event Records', Value: eventCount.toLocaleString() },
      { Metric: 'Archived BLOB Images', Value: imageCount.toLocaleString() },
      { Metric: 'Audit Log Entries', Value: auditCount.toLocaleString() },
      { Metric: 'Configured States', Value: stateCount },
      { Metric: 'Configured Districts', Value: districtCount },
      { Metric: 'Configured Units', Value: unitCount },
      { Metric: 'SQLite Database File Size', Value: dbSize },
      { Metric: 'SQLite WAL File Size', Value: walSize }
    ]);
    console.log('');
  } catch (err) {
    console.error('[CLI ERROR] Failed to fetch database stats:', err.message);
  }
}

function checkHealth() {
  console.log('\n============================================================');
  console.log('       SSF EventStore Hub - Database Health Check');
  console.log('============================================================\n');

  try {
    const journalMode = db.pragma('journal_mode', { simple: true });
    const synchronous = db.pragma('synchronous', { simple: true });
    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    const integrity = db.pragma('quick_check', { simple: true });

    console.log(`  Journal Mode (Target: wal):     ${journalMode.toUpperCase()}  ${journalMode === 'wal' ? '✅' : '⚠️'}`);
    console.log(`  Synchronous (Target: normal):   ${synchronous}  ${synchronous === 1 || synchronous === '1' ? '✅' : 'ℹ️'}`);
    console.log(`  Foreign Keys Enabled:           ${foreignKeys === 1 ? 'YES ✅' : 'NO ❌'}`);
    console.log(`  Quick Integrity Check:          ${integrity.toUpperCase()}  ${integrity.toLowerCase() === 'ok' ? '✅' : '❌'}`);
    console.log('\nAll core database integrity checks completed.\n');
  } catch (err) {
    console.error('[CLI ERROR] Health check failed:', err.message);
  }
}

function vacuumDatabase() {
  console.log('\n[VACUUM] Defragmenting database pages and running optimization...');
  const start = Date.now();
  try {
    db.exec('VACUUM;');
    db.pragma('optimize;');
    const elapsed = Date.now() - start;
    console.log(`[VACUUM] Optimization complete in ${elapsed}ms. ✅\n`);
  } catch (err) {
    console.error('[CLI ERROR] Vacuum failed:', err.message);
  }
}

async function runSeed() {
  console.log('\n[SEED] Initializing seed routine...');
  try {
    const { seedDatabase } = require('../config/seed');
    await seedDatabase();
    console.log('[SEED] Seeding process complete. ✅\n');
  } catch (err) {
    console.error('[CLI ERROR] Seeding failed:', err.message);
  }
}

function printHelp() {
  console.log(`
SSF EventStore Hub - CLI Management Tool

Usage:
  npm run cli -- [options]
  node scripts/cli.js [options]

Options:
  --stats, -s     Display system records, BLOB counts, and disk footprint
  --health, -h    Verify WAL mode, foreign keys, and run SQLite quick integrity check
  --vacuum, -v    Defragment database pages and run pragma optimization
  --seed          Seed initial admin, users, locations, and sample events
  --help          Display this help documentation
  `);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
