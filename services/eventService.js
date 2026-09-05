const db = require('../config/database');
const cacheService = require('./cacheService');

/**
 * Generate unique immutable Record ID (e.g. EVT-1001)
 * Monotonically increases based on highest existing ID to prevent collisions after record deletions
 */
function generateRecordId() {
  const rows = db.prepare(`SELECT record_id FROM event_records WHERE record_id LIKE 'EVT-%'`).all();
  let maxId = 0;
  for (const row of rows) {
    const parts = row.record_id.split('-');
    const numPart = parseInt(parts[1], 10);
    if (!isNaN(numPart) && numPart > maxId) {
      maxId = numPart;
    }
  }
  const nextId = maxId + 1;
  return `EVT-${String(nextId).padStart(4, '0')}`;
}

/**
 * Create event record with multi-image BLOB batch insertion
 */
function createEventRecord(userNo, unitType, title, categories, eventDate, imageFiles = [], stateName = 'Tamil Nadu', districtName = 'Chennai', unitName = 'Sholinganallur', description = '', notes = '') {
  const recordId = generateRecordId();
  const categoriesJson = JSON.stringify(Array.isArray(categories) ? categories : [categories]);

  const stmtRecord = db.prepare(`
    INSERT INTO event_records (record_id, unit_type, state_name, district_name, unit_name, user_no, title, categories, event_date, description, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const stmtImage = db.prepare(`
    INSERT INTO event_images (event_record_id, original_name, mime_type, file_size, image_data)
    VALUES (?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    stmtRecord.run(recordId, unitType, stateName, districtName || null, unitName || null, userNo, title, categoriesJson, eventDate, description || '', notes || '');

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
           r.title, r.categories, r.event_date, r.description, r.notes, r.last_updated, r.created_at, u.username
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
 * Get image BLOB by Image ID directly from SQLite database.
 * Does not cache multi-megabyte binary Buffers in V8 heap to prevent memory bloat.
 * SQLite in WAL mode reads rows by primary key in microseconds.
 */
function getImageBlobById(imageId) {
  const image = db.prepare(`
    SELECT mime_type, image_data, original_name, file_size
    FROM event_images
    WHERE id = ?
  `).get(imageId);

  return image;
}

/**
 * Query event records with optional filters (unit_type, district_name, state_name, unit_name, category, event_date)
 * Features server-side pagination (default 12/page) and SQL category filtering for crores of records.
 */
function getEventRecords(filters = {}, page = 1, limit = 12) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 12));
  const offset = (pageNum - 1) * pageSize;

  const { unit_type, district_name, state_name, unit_name, category, event_date } = filters;
  const cacheKey = `events:list:${unit_type || 'all'}:${state_name || 'all'}:${district_name || 'all'}:${unit_name || 'all'}:${category || 'all'}:${event_date || 'all'}:p${pageNum}:l${pageSize}`;

  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  let whereClause = ` WHERE 1=1`;
  const params = [];

  if (unit_type) {
    whereClause += ` AND r.unit_type = ?`;
    params.push(unit_type);
  }

  if (state_name) {
    whereClause += ` AND r.state_name = ?`;
    params.push(state_name);
  }

  if (district_name) {
    whereClause += ` AND r.district_name = ?`;
    params.push(district_name);
  }

  if (unit_name) {
    whereClause += ` AND r.unit_name = ?`;
    params.push(unit_name);
  }

  if (event_date) {
    whereClause += ` AND r.event_date = ?`;
    params.push(event_date);
  }

  if (category) {
    whereClause += ` AND r.categories LIKE ?`;
    params.push(`%"${category}"%`);
  }

  // Fast count query using indexes
  const countQuery = `SELECT COUNT(*) as total FROM event_records r ${whereClause}`;
  const countRow = db.prepare(countQuery).get(...params);
  const totalRecords = countRow ? countRow.total : 0;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  // Lean data query with LIMIT and OFFSET, omitting creator username for privacy
  const dataQuery = `
    SELECT r.id, r.record_id, r.unit_type, r.state_name, r.district_name, r.unit_name, r.user_no,
           r.title, r.categories, r.event_date, r.description, r.notes, r.last_updated, r.created_at,
           (SELECT COUNT(*) FROM event_images WHERE event_record_id = r.record_id) as image_count,
           (SELECT id FROM event_images WHERE event_record_id = r.record_id LIMIT 1) as cover_image_id
    FROM event_records r
    ${whereClause}
    ORDER BY r.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const queryParams = [...params, pageSize, offset];
  let rawRecords = db.prepare(dataQuery).all(...queryParams);

  const records = rawRecords.map(r => ({
    ...r,
    categories: JSON.parse(r.categories || '[]')
  }));

  const result = {
    records,
    totalRecords,
    totalPages,
    currentPage: pageNum,
    pageSize
  };

  cacheService.set(cacheKey, result, 30); // 30 seconds cache for dynamic lists
  return result;
}

/**
 * Delete event record (Checks ownership / unit role enforcement)
 */
function deleteEventRecord(recordId, currentUser) {
  const record = db.prepare(`SELECT * FROM event_records WHERE record_id = ?`).get(recordId);

  if (!record) {
    const err = new Error('Event record not found.');
    err.status = 404;
    throw err;
  }

  // Strict ownership check: Only record creator or super admin can delete
  if (!currentUser.is_admin && record.user_no !== currentUser.user_no) {
    const err = new Error('Unauthorized action: You can only delete records that you posted.');
    err.status = 403;
    throw err;
  }

  // Also enforce unit level match
  if (!currentUser.is_admin && record.unit_type !== currentUser.unit_type) {
    const err = new Error('Unauthorized action: Role level mismatch.');
    err.status = 403;
    throw err;
  }

  // Atomically delete images and event record in a single transaction
  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM event_images WHERE event_record_id = ?`).run(recordId);
    db.prepare(`DELETE FROM event_records WHERE record_id = ?`).run(recordId);
  });
  transaction();

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
