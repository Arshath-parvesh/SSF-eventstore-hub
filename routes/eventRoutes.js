const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');
const { validateEventCreation } = require('../middleware/validationMiddleware');
const { createEventRecord, getEventRecordById, getImageBlobById, getEventRecords, deleteEventRecord } = require('../services/eventService');
const { getUserByNo } = require('../services/userService');
const { maskAadhaar } = require('../config/security');
const { logAuditEvent } = require('../services/auditService');

// All event routes require authentication
router.use(requireAuth);

// GET /events - Event Listing Feed
router.get('/', (req, res, next) => {
  try {
    const { getAllStates, getAllDistricts } = require('../services/locationService');
    const filters = {
      unit_type: req.query.unit_type || null,
      state_name: req.query.state_name || null,
      district_name: req.query.district_name || null,
      category: req.query.category || null,
      event_date: req.query.event_date || null
    };

    const records = getEventRecords(filters);

    res.render('events/list', {
      title: 'Event Records - Event Management System',
      records,
      filters,
      states: getAllStates(),
      districts: getAllDistricts(),
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    next(err);
  }
});

// GET /events/create - Create Event Form
router.get('/create', (req, res) => {
  const { getAllStates, getAllDistricts, getAllUnits } = require('../services/locationService');
  res.render('events/create', {
    title: 'Post New Event Record',
    states: getAllStates(),
    districts: getAllDistricts(),
    units: getAllUnits(),
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

    const { title, categories, event_date } = req.body;

    const parsedCategories = Array.isArray(categories) ? categories : [categories];
    const imageFiles = req.files || [];

    const newRecord = createEventRecord(
      userNo, unitType, title, parsedCategories, event_date, imageFiles,
      stateName, districtName, unitName
    );
    logAuditEvent(userNo, 'EVENT_RECORD_CREATED', 'EVENT', newRecord.record_id, req.ip);

    res.redirect('/events?success=' + encodeURIComponent(`Event Record ${newRecord.record_id} published successfully.`));
  } catch (err) {
    res.redirect('/events/create?error=' + encodeURIComponent(err.message));
  }
});

// GET /events/images/:id - Dynamic Binary Image Endpoint from Database BLOB
router.get('/images/:id', (req, res, next) => {
  try {
    const imageId = req.params.id;
    const image = getImageBlobById(imageId);

    if (!image) {
      return res.status(404).send('Image payload not found.');
    }

    res.setHeader('Content-Type', image.mime_type);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 24-hour client cache
    res.send(image.image_data);
  } catch (err) {
    next(err);
  }
});

// GET /events/:id - Event Record Detail View
router.get('/:id', (req, res, next) => {
  try {
    const recordId = req.params.id;
    const record = getEventRecordById(recordId);

    if (!record) {
      const err = new Error('Event record not found.');
      err.status = 404;
      return next(err);
    }

    // Fetch creator details for entitlement display with masked Aadhaar
    const creator = getUserByNo(record.user_no);
    const maskedAadhaar = creator ? maskAadhaar(creator.aadhaar_encrypted) : 'XXXX-XXXX-XXXX';

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
      creator,
      maskedAadhaar,
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
