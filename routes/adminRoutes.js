const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/rbacMiddleware');
const { validateUserCreation } = require('../middleware/validationMiddleware');
const { createUser, getAllUsers, setUserStatus, setUserAdminRole, getUserByNo } = require('../services/userService');
const { assignDefaultEntitlements, getAllEntitlements, addEntitlement, removeEntitlement } = require('../services/entitlementService');
const { getAuditLogs, logAuditEvent } = require('../services/auditService');
const {
  getAllStates,
  getAllDistricts,
  getAllUnits,
  getLocationHierarchyTree,
  createState,
  createDistrict,
  createUnit
} = require('../services/locationService');
const db = require('../config/database');

// All admin routes require authentication and super admin entitlement
router.use(requireAuth, requireAdmin);

// GET /admin - Admin Dashboard
router.get('/', (req, res, next) => {
  try {
    const userStats = db.prepare(`
      SELECT unit_type, count(*) as count FROM users GROUP BY unit_type
    `).all();

    const eventStats = db.prepare(`
      SELECT unit_type, count(*) as count FROM event_records GROUP BY unit_type
    `).all();

    const totalUsers = db.prepare(`SELECT count(*) as count FROM users`).get().count;
    const totalEvents = db.prepare(`SELECT count(*) as count FROM event_records`).get().count;
    const totalImages = db.prepare(`SELECT count(*) as count FROM event_images`).get().count;

    const recentLogs = getAuditLogs(10);

    res.render('admin/dashboard', {
      title: 'Admin Dashboard - Event Management System',
      totalUsers,
      totalEvents,
      totalImages,
      userStats,
      eventStats,
      recentLogs
    });
  } catch (err) {
    next(err);
  }
});

// GET /admin/users - User Management List
router.get('/users', (req, res, next) => {
  try {
    const users = getAllUsers();

    res.render('admin/userList', {
      title: 'User Management - Admin',
      users,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    next(err);
  }
});

// GET /admin/users/create - User Creation Page
router.get('/users/create', (req, res) => {
  res.render('admin/userCreate', {
    title: 'Create User - Admin',
    states: getAllStates(),
    districts: getAllDistricts(),
    units: getAllUnits(),
    tree: getLocationHierarchyTree(),
    error: req.query.error || null
  });
});

// POST /admin/users/create - Process User Creation
router.post('/users/create', validateUserCreation, async (req, res, next) => {
  try {
    const newUser = await createUser(req.body);
    assignDefaultEntitlements(
      newUser.user_no,
      newUser.unit_type,
      newUser.is_admin === 1,
      newUser.state_name,
      newUser.district_name,
      newUser.unit_name
    );

    logAuditEvent(req.session.user.user_no, 'USER_CREATED', 'ADMIN', newUser.user_no, req.ip);

    res.redirect('/admin/users?success=' + encodeURIComponent(`User ${newUser.user_no} created successfully.`));
  } catch (err) {
    res.redirect('/admin/users/create?error=' + encodeURIComponent(err.message));
  }
});

// POST /admin/users/status - Toggle User Active/Inactive Status
router.post('/users/status', (req, res, next) => {
  try {
    const { user_no, status } = req.body;
    if (!user_no || !['active', 'inactive'].includes(status)) {
      const err = new Error('Invalid parameters for status update.');
      err.status = 400;
      return next(err);
    }

    // Prevent deactivating own account
    if (user_no === req.session.user.user_no) {
      const err = new Error('Action blocked: You cannot deactivate your own active session.');
      err.status = 400;
      return next(err);
    }

    setUserStatus(user_no, status);
    logAuditEvent(req.session.user.user_no, `USER_STATUS_${status.toUpperCase()}`, 'ADMIN', user_no, req.ip);

    res.redirect('/admin/users?success=' + encodeURIComponent(`User ${user_no} status set to ${status}.`));
  } catch (err) {
    next(err);
  }
});

// POST /admin/users/role - Grant or Revoke Admin Role for a User
router.post('/users/role', (req, res, next) => {
  try {
    const { user_no, is_admin } = req.body;
    if (!user_no || is_admin === undefined) {
      const err = new Error('Invalid parameters for role update.');
      err.status = 400;
      return next(err);
    }

    const targetUser = getUserByNo(user_no);
    if (!targetUser) {
      const err = new Error('Target user not found.');
      err.status = 404;
      return next(err);
    }

    const grantAdmin = Number(is_admin) === 1;

    // Block revoking admin access for primary "admin" user alone
    if (targetUser.username === 'admin' && !grantAdmin) {
      const err = new Error('Action blocked: Admin privileges for the primary "admin" user cannot be revoked.');
      err.status = 403;
      return next(err);
    }

    // Prevent revoking own admin access
    if (user_no === req.session.user.user_no && !grantAdmin) {
      const err = new Error('Action blocked: You cannot revoke your own admin access.');
      err.status = 400;
      return next(err);
    }

    setUserAdminRole(user_no, grantAdmin);

    const actionText = grantAdmin ? 'ADMIN_ROLE_GRANTED' : 'ADMIN_ROLE_REVOKED';
    logAuditEvent(req.session.user.user_no, actionText, 'ADMIN', user_no, req.ip);

    const msg = grantAdmin
      ? `Admin access granted to ${user_no} (${targetUser.username}).`
      : `Admin access revoked for ${user_no} (${targetUser.username}).`;

    res.redirect('/admin/users?success=' + encodeURIComponent(msg));
  } catch (err) {
    next(err);
  }
});

// GET /admin/entitlements - Entitlement Management View
router.get('/entitlements', (req, res, next) => {
  try {
    const entitlements = getAllEntitlements();
    const users = getAllUsers();

    res.render('admin/entitlementList', {
      title: 'Entitlement Management - Admin',
      entitlements,
      users,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    next(err);
  }
});

// POST /admin/entitlements/add - Add Entitlement
router.post('/entitlements/add', (req, res, next) => {
  try {
    const { user_no, entitlement } = req.body;
    if (!user_no || !entitlement) {
      const err = new Error('UserNo and Entitlement name are required.');
      err.status = 400;
      return next(err);
    }

    const user = getUserByNo(user_no);
    if (!user) {
      const err = new Error('Target user not found.');
      err.status = 404;
      return next(err);
    }

    addEntitlement(user_no, user.unit_type, entitlement.trim().toUpperCase());
    logAuditEvent(req.session.user.user_no, 'ENTITLEMENT_ADDED', 'ADMIN', user_no, req.ip);

    res.redirect('/admin/entitlements?success=' + encodeURIComponent(`Entitlement ${entitlement} granted to ${user_no}.`));
  } catch (err) {
    next(err);
  }
});

// POST /admin/entitlements/remove - Remove Entitlement
router.post('/entitlements/remove', (req, res, next) => {
  try {
    const { user_no, entitlement } = req.body;
    if (!user_no || !entitlement) {
      const err = new Error('UserNo and Entitlement are required.');
      err.status = 400;
      return next(err);
    }

    const targetUser = getUserByNo(user_no);
    if (targetUser && targetUser.username === 'admin' && ['MANAGE_USERS', 'MANAGE_ENTITLEMENTS', 'VIEW_AUDIT_LOGS'].includes(entitlement)) {
      const err = new Error('Action blocked: Cannot revoke core administrative entitlements from primary "admin" user.');
      err.status = 403;
      return next(err);
    }

    removeEntitlement(user_no, entitlement);
    logAuditEvent(req.session.user.user_no, 'ENTITLEMENT_REMOVED', 'ADMIN', user_no, req.ip);

    res.redirect('/admin/entitlements?success=' + encodeURIComponent(`Entitlement ${entitlement} revoked from ${user_no}.`));
  } catch (err) {
    next(err);
  }
});

// GET /admin/audit-logs - PII-Free Audit Log Feed
router.get('/audit-logs', (req, res, next) => {
  try {
    const logs = getAuditLogs(200);
    res.render('admin/auditLogs', {
      title: 'Audit Trail (PII-Free) - Admin',
      logs
    });
  } catch (err) {
    next(err);
  }
});

// GET /admin/locations - Location Hierarchy Management View
router.get('/locations', (req, res, next) => {
  try {
    const tree = getLocationHierarchyTree();
    const states = getAllStates();
    const districts = getAllDistricts();

    res.render('admin/locations', {
      title: 'State, District & Unit Location Management - Admin',
      tree,
      states,
      districts,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    next(err);
  }
});

// POST /admin/locations/state - Create State
router.post('/locations/state', (req, res) => {
  try {
    const { name, code } = req.body;

    if (!name) {
      return res.redirect('/admin/locations?error=' + encodeURIComponent('State name is required.'));
    }

    const state = createState(name, code);
    logAuditEvent(req.session.user.user_no, 'LOCATION_STATE_CREATED', 'ADMIN', state.name, req.ip);

    res.redirect('/admin/locations?success=' + encodeURIComponent(`State '${state.name}' created successfully.`));
  } catch (err) {
    res.redirect('/admin/locations?error=' + encodeURIComponent(err.message));
  }
});

// POST /admin/locations/district - Create District
router.post('/locations/district', (req, res) => {
  try {
    const { state_id, name, code } = req.body;

    if (!state_id || !name) {
      return res.redirect('/admin/locations?error=' + encodeURIComponent('State and District name are required.'));
    }

    const dist = createDistrict(parseInt(state_id, 10), name, code);
    logAuditEvent(req.session.user.user_no, 'LOCATION_DISTRICT_CREATED', 'ADMIN', dist.name, req.ip);

    res.redirect('/admin/locations?success=' + encodeURIComponent(`District '${dist.name}' created successfully.`));
  } catch (err) {
    res.redirect('/admin/locations?error=' + encodeURIComponent(err.message));
  }
});

// POST /admin/locations/unit - Create Unit
router.post('/locations/unit', (req, res) => {
  try {
    const { district_id, name, code } = req.body;

    if (!district_id || !name) {
      return res.redirect('/admin/locations?error=' + encodeURIComponent('District and Unit name are required.'));
    }

    const unit = createUnit(parseInt(district_id, 10), name, code);
    logAuditEvent(req.session.user.user_no, 'LOCATION_UNIT_CREATED', 'ADMIN', unit.name, req.ip);

    res.redirect('/admin/locations?success=' + encodeURIComponent(`Unit '${unit.name}' created successfully.`));
  } catch (err) {
    res.redirect('/admin/locations?error=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
