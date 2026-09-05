const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');
const { validateEventCreation } = require('../middleware/validationMiddleware');
const { createEventRecord, getEventRecordById, getImageBlobById, getEventRecords, deleteEventRecord } = require('../services/eventService');
const { getUserByNo } = require('../services/userService');
const { logAuditEvent } = require('../services/auditService');
const {
  getAllStates,
  getAllDistricts,
  getAllUnits,
  getDistrictsByState,
  getUnitsByDistrict,
  getLocationHierarchyTree
} = require('../services/locationService');

// All event routes require authentication
router.use(requireAuth);

/**
 * GET /events - Event Listing Feed with multi-dimensional administrative filtering & pagination.
 */
router.get('/', (req, res, next) => {
  try {
    let { unit_type, state_name, district_name, unit_name, category, event_date } = req.query;

    unit_type = unit_type ? String(unit_type).trim() : null;
    state_name = state_name ? String(state_name).trim() : null;
    district_name = district_name ? String(district_name).trim() : null;
    unit_name = unit_name ? String(unit_name).trim() : null;
    category = category ? String(category).trim() : null;
    event_date = event_date ? String(event_date).trim() : null;

    // 1. If state is chosen, district comes only based on state. If no state is chosen, show all districts.
    let districts = [];
    if (state_name) {
      districts = getDistrictsByState(state_name);
      // Validate that chosen district_name belongs to chosen state_name
      if (district_name && !districts.some(d => d.name.toLowerCase() === district_name.toLowerCase())) {
        district_name = null;
        unit_name = null;
      }
    } else {
      districts = getAllDistricts();
    }

    // 2. If district is chosen, unit should only be based on district. Don't show all units.
    let units = [];
    if (district_name) {
      units = getUnitsByDistrict(district_name);
      // Validate that chosen unit_name belongs to chosen district_name
      if (unit_name && !units.some(u => u.name.toLowerCase() === unit_name.toLowerCase())) {
        unit_name = null;
      }
    } else {
      units = [];
      unit_name = null;
    }

    const filters = {
      unit_type: unit_type || null,
      state_name: state_name || null,
      district_name: district_name || null,
      unit_name: unit_name || null,
      category: category || null,
      event_date: event_date || null
    };

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 12));

    const { records, totalRecords, totalPages, currentPage, pageSize } = getEventRecords(filters, page, limit);

    res.render('events/list', {
      title: 'Event Records - Event Management System',
      records,
      totalRecords,
      totalPages,
      currentPage,
      pageSize,
      filters,
      states: getAllStates(),
      districts,
      units,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /events/create - Render Event Creation Form with Location Tree.
 */
router.get('/create', (req, res) => {
  res.render('events/create', {
    title: 'Post New Event Record',
    states: getAllStates(),
    districts: getAllDistricts(),
    units: getAllUnits(),
    tree: getLocationHierarchyTree(),
    error: req.query.error || null
  });
});

// POST /events - Process Event Record Creation (Support 100+ images)
router.post('/', validateEventCreation, (req, res, next) => {
  try {
    const userNo = req.session.user.user_no;
    const unitType = req.session.user.unit_type;
    const stateName = req.body.state_name || req.session.user.state_name || 'Tamil Nadu';
    const districtName = req.body.district_name || req.session.user.district_name || 'Chennai';
    const unitName = req.body.unit_name || req.session.user.unit_name || 'Sholinganallur';

    const { title, categories, event_date, description, notes } = req.body;

    const parsedCategories = Array.isArray(categories) ? categories : [categories];
    const imageFiles = req.files || [];

    const newRecord = createEventRecord(
      userNo, unitType, title, parsedCategories, event_date, imageFiles,
      stateName, districtName, unitName, description || '', notes || ''
    );
    logAuditEvent(userNo, 'EVENT_RECORD_CREATED', 'EVENT', newRecord.record_id, req.ip);

    res.redirect('/events?success=' + encodeURIComponent(`Event Record ${newRecord.record_id} published successfully.`));
  } catch (err) {
    res.redirect('/events/create?error=' + encodeURIComponent(err.message));
  }
});

// GET /events/images/:id - High-Performance Binary Image Serving with ETag & 304 Caching
router.get('/images/:id', (req, res, next) => {
  try {
    const imageId = req.params.id;
    const image = getImageBlobById(imageId);

    if (!image) {
      return res.status(404).send('Image payload not found.');
    }

    const etag = `"${imageId}-${image.file_size || (image.image_data ? image.image_data.length : 0)}"`;
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.setHeader('ETag', etag);
    res.setHeader('Content-Type', image.mime_type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(image.image_data);
  } catch (err) {
    next(err);
  }
});

// GET /events/:id - Event Record Detail View (PII-Free, No Creator ID in UI)
router.get('/:id', (req, res, next) => {
  try {
    const recordId = req.params.id;
    const record = getEventRecordById(recordId);

    if (!record) {
      const err = new Error('Event record not found.');
      err.status = 404;
      return next(err);
    }

    // Pagination for 100+ images gallery
    const page = parseInt(req.query.page, 10) || 1;
    const pageSize = 24; // 24 images per page
    const totalImages = record.images.length;
    const totalPages = Math.ceil(totalImages / pageSize) || 1;

    const paginatedImages = record.images.slice((page - 1) * pageSize, page * pageSize);

    res.render('events/detail', {
      title: `${record.title} - Event Record`,
      record,
      paginatedImages,
      currentPage: page,
      totalPages,
      totalImages
    });
  } catch (err) {
    next(err);
  }
});

// POST /events/:id/delete - Delete Event Record with Server-Side Ownership Check
router.post('/:id/delete', (req, res, next) => {
  try {
    const recordId = req.params.id;
    const currentUser = req.session.user;

    deleteEventRecord(recordId, currentUser);
    logAuditEvent(currentUser.user_no, 'EVENT_RECORD_DELETED', 'EVENT', recordId, req.ip);

    res.redirect('/events?success=' + encodeURIComponent(`Record ${recordId} deleted successfully.`));
  } catch (err) {
    // If permission mismatch, throws HTTP 403 / error
    next(err);
  }
});

module.exports = router;
