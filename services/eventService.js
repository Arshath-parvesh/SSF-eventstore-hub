const db = require('../config/database');
const cacheService = require('./cacheService');

/**
 * Generate unique immutable Record ID (e.g. EVT-1001)
 */
function generateRecordId() {
  const row = db.prepare(`SELECT COUNT(*) as count FROM event_records`).get();
  const nextId = (row ? row.count : 0) + 1;
  return `EVT-${String(nextId).padStart(4, '0')}`;
}

/**
 * Create event record with multi-image BLOB batch insertion
 */
function createEventRecord(userNo, unitType, title, categories, eventDate, imageFiles = [], stateName = 'Tamil Nadu', districtName = 'Chennai', unitName = 'Sholinganallur') {
  const recordId = generateRecordId();
  const categoriesJson = JSON.stringify(Array.isArray(categories) ? categories : [categories]);

  const stmtRecord = db.prepare(`
    INSERT INTO event_records (record_id, unit_type, state_name, district_name, unit_name, user_no, title, categories, event_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const stmtImage = db.prepare(`
    INSERT INTO event_images (event_record_id, original_name, mime_type, file_size, image_data)
    VALUES (?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    stmtRecord.run(recordId, unitType, stateName, districtName || null, unitName || null, userNo, title, categoriesJson, eventDate);

    // Batch insert 100+ images as BLOB data
    if (Array.isArray(imageFiles) && imageFiles.length > 0) {
      for (const file of imageFiles) {
        stmtImage.run(
          recordId,
          file.originalname || 'image.jpg',
          file.mimetype || 'image/jpeg',
          file.size || file.buffer.length,
          file.buffer
        );
      }
    }
  });

  transaction();

  // Invalidate feed caches
  cacheService.deletePattern('^events:list');

  return getEventRecordById(recordId);
}

/**
 * Get event record by Record ID with image metadata (IDs, mime types, sizes - excluding binary payloads)
 */
function getEventRecordById(recordId) {
  const record = db.prepare(`
    SELECT r.id, r.record_id, r.unit_type, r.state_name, r.district_name, r.unit_name, r.user_no,
           r.title, r.categories, r.event_date, r.last_updated, r.created_at, u.username
    FROM event_records r
    JOIN users u ON r.user_no = u.user_no
    WHERE r.record_id = ?
  `).get(recordId);

  if (!record) return null;

  record.categories = JSON.parse(record.categories || '[]');
  
  // Fetch image metadata (no BLOB payload in metadata query to keep memory lean)
  const images = db.prepare(`
    SELECT id, original_name, mime_type, file_size, uploaded_at
    FROM event_images
    WHERE event_record_id = ?
    ORDER BY id ASC
  `).all(recordId);

  record.images = images;
  return record;
}

/**
 * Get image BLOB by Image ID (with in-memory caching)
 */
function getImageBlobById(imageId) {
  const cacheKey = `image_blob:${imageId}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  const image = db.prepare(`
    SELECT mime_type, image_data, original_name
    FROM event_images
    WHERE id = ?
  `).get(imageId);

  if (image) {
    cacheService.set(cacheKey, image, 600); // 10 minutes RAM cache
  }

  return image;
}

/**
 * Query event records with optional filters (unit_type, district_name, state_name, category, event_date)
 */
function getEventRecords(filters = {}) {
  const { unit_type, district_name, state_name, category, event_date } = filters;
  const cacheKey = `events:list:${unit_type || 'all'}:${district_name || 'all'}:${state_name || 'all'}:${category || 'all'}:${event_date || 'all'}`;

  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  let query = `
    SELECT r.id, r.record_id, r.unit_type, r.state_name, r.district_name, r.unit_name, r.user_no,
           r.title, r.categories, r.event_date, r.last_updated, r.created_at, u.username,
           (SELECT COUNT(*) FROM event_images WHERE event_record_id = r.record_id) as image_count,
           (SELECT id FROM event_images WHERE event_record_id = r.record_id LIMIT 1) as cover_image_id
    FROM event_records r
    JOIN users u ON r.user_no = u.user_no
    WHERE 1=1
  `;
  const params = [];

  if (unit_type) {
    query += ` AND r.unit_type = ?`;
    params.push(unit_type);
  }

  if (district_name) {
    query += ` AND r.district_name = ?`;
    params.push(district_name);
  }

  if (state_name) {
    query += ` AND r.state_name = ?`;
    params.push(state_name);
  }

  if (event_date) {
    query += ` AND r.event_date = ?`;
    params.push(event_date);
  }

  query += ` ORDER BY r.created_at DESC`;

  let records = db.prepare(query).all(...params);

  records = records.map(r => ({
    ...r,
    categories: JSON.parse(r.categories || '[]')
  }));

  if (category) {
    records = records.filter(r => r.categories.includes(category));
  }

  cacheService.set(cacheKey, records, 60); // 1 minute cache
  return records;
}

/**
 * Delete event record (Checks ownership / unit role enforcement)
 */
function deleteEventRecord(recordId, currentUser) {
  const record = db.prepare(`SELECT * FROM event_records WHERE record_id = ?`).get(recordId);

  if (!record) {
    throw new Error('Event record not found.');
  }

  // Strict ownership check: Only record creator or super admin can delete
  if (!currentUser.is_admin && record.user_no !== currentUser.user_no) {
    throw new Error('Unauthorized action: You can only delete records that you posted.');
  }

  // Also enforce unit level match
  if (!currentUser.is_admin && record.unit_type !== currentUser.unit_type) {
    throw new Error('Unauthorized action: Role level mismatch.');
  }

  // Delete images (Cascade via SQLite foreign key, or explicit deletion)
  db.prepare(`DELETE FROM event_images WHERE event_record_id = ?`).run(recordId);
  db.prepare(`DELETE FROM event_records WHERE record_id = ?`).run(recordId);

  // Invalidate caches
  cacheService.deletePattern('^events:list');
  cacheService.deletePattern('^image_blob:');

  return true;
}

module.exports = {
  createEventRecord,
  getEventRecordById,
  getImageBlobById,
  getEventRecords,
  deleteEventRecord
};
