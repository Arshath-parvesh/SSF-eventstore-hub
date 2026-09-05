const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../app');
const db = require('../config/database');
const { createUser, getUserByNo, setUserAdminRole } = require('../services/userService');
const { createEventRecord, getEventRecordById, deleteEventRecord, generateRecordId } = require('../services/eventService');
const { assignDefaultEntitlements } = require('../services/entitlementService');

let server;
let baseUrl;

// Helper to make HTTP requests and manage cookies
function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = options.headers || {};
    if (options.cookie) {
      headers['Cookie'] = options.cookie;
    }

    const req = http.request(url, {
      method: options.method || 'GET',
      headers,
    }, (res) => {
      let data = '';
      const setCookieHeaders = res.headers['set-cookie'] || [];
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          cookies: setCookieHeaders,
          body: data
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// Extract CSRF token from HTML body or cookies
function extractCsrfToken(html, cookies = []) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/value="([^"]+)"\s+name="_csrf"/);
  if (match) return match[1];

  for (const c of cookies) {
    if (c.includes('_csrfSecret=')) {
      const parts = c.split(';')[0].split('=');
      return parts[1];
    }
  }
  return null;
}

// Extract session cookie string
function extractSessionCookie(cookies) {
  return cookies.map(c => c.split(';')[0]).join('; ');
}

describe('SSF Event Store Hub - Complete QA Test Suite', () => {
  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  // ==========================================
  // 1. Security Headers & Attack Surface
  // ==========================================
  describe('1. Security Headers & Defense in Depth', () => {
    it('should include strict security headers on all responses', async () => {
      const res = await makeRequest('/login');
      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['x-frame-options'], 'X-Frame-Options header present');
      assert.equal(res.headers['x-frame-options'], 'DENY');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.ok(res.headers['content-security-policy'], 'CSP header present');
      assert.ok(res.headers['strict-transport-security'], 'HSTS header present');
    });

    it('should block path traversal sequences with HTTP 400', async () => {
      const res = await makeRequest('/events?page=..%2F..%2Fetc%2Fpasswd');
      assert.equal(res.statusCode, 400);
      assert.match(res.body, /path traversal/i);
    });

    it('should reject state-changing requests without CSRF token with HTTP 403', async () => {
      const res = await makeRequest('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'username=admin&password=AdminPassword123!'
      });
      assert.equal(res.statusCode, 403);
      assert.match(res.body, /CSRF/i);
    });
  });

  // ==========================================
  // 2. Authentication & Session Management
  // ==========================================
  describe('2. Authentication & Session Security', () => {
    it('should reject login with invalid credentials', async () => {
      const getLogin = await makeRequest('/login');
      const csrf = extractCsrfToken(getLogin.body, getLogin.cookies);
      const cookie = extractSessionCookie(getLogin.cookies);

      const postLogin = await makeRequest('/login', {
        method: 'POST',
        cookie,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=admin&password=WrongPassword!&_csrf=${csrf}`
      });

      // Should redirect back to /login with error
      assert.equal(postLogin.statusCode, 302);
      assert.ok(postLogin.headers.location.includes('error='), 'Redirected with error parameter');
    });

    it('should successfully authenticate super admin and redirect to /admin', async () => {
      const getLogin = await makeRequest('/login');
      const csrf = extractCsrfToken(getLogin.body, getLogin.cookies);
      const cookie = extractSessionCookie(getLogin.cookies);

      const postLogin = await makeRequest('/login', {
        method: 'POST',
        cookie,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=admin&password=AdminPassword123!&_csrf=${csrf}`
      });

      assert.equal(postLogin.statusCode, 302);
      assert.equal(postLogin.headers.location, '/admin');
    });

    it('should successfully authenticate standard user and redirect to /events', async () => {
      const getLogin = await makeRequest('/login');
      const csrf = extractCsrfToken(getLogin.body, getLogin.cookies);
      const cookie = extractSessionCookie(getLogin.cookies);

      const postLogin = await makeRequest('/login', {
        method: 'POST',
        cookie,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=unit_user&password=UserPassword123!&_csrf=${csrf}`
      });

      assert.equal(postLogin.statusCode, 302);
      assert.equal(postLogin.headers.location, '/events');
    });

    it('should reject unauthenticated access to /events by redirecting to /login', async () => {
      const res = await makeRequest('/events');
      assert.equal(res.statusCode, 302);
      assert.ok(res.headers.location.includes('/login'));
    });
  });

  // ==========================================
  // 3. RBAC & Access Control
  // ==========================================
  describe('3. Role-Based Access Control (RBAC)', () => {
    it('should block non-admin users from accessing /admin with HTTP 403', async () => {
      // Login as standard unit_user
      const getLogin = await makeRequest('/login');
      const csrf = extractCsrfToken(getLogin.body, getLogin.cookies);
      const initialCookie = extractSessionCookie(getLogin.cookies);

      const postLogin = await makeRequest('/login', {
        method: 'POST',
        cookie: initialCookie,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=unit_user&password=UserPassword123!&_csrf=${csrf}`
      });
      const authCookie = extractSessionCookie(postLogin.cookies);

      // Attempt to access /admin
      const adminRes = await makeRequest('/admin', { cookie: authCookie });
      assert.equal(adminRes.statusCode, 403);
      assert.match(adminRes.body, /Admin privileges required/i);
    });

    it('should allow admin user to access /admin dashboard and management pages', async () => {
      // Login as admin
      const getLogin = await makeRequest('/login');
      const csrf = extractCsrfToken(getLogin.body, getLogin.cookies);
      const initialCookie = extractSessionCookie(getLogin.cookies);

      const postLogin = await makeRequest('/login', {
        method: 'POST',
        cookie: initialCookie,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=admin&password=AdminPassword123!&_csrf=${csrf}`
      });
      const adminCookie = extractSessionCookie(postLogin.cookies);

      const dashboardRes = await makeRequest('/admin', { cookie: adminCookie });
      assert.equal(dashboardRes.statusCode, 200);
      assert.match(dashboardRes.body, /Admin Dashboard/i);

      const usersRes = await makeRequest('/admin/users', { cookie: adminCookie });
      assert.equal(usersRes.statusCode, 200);
      assert.match(usersRes.body, /User Management/i);
    });
  });

  // ==========================================
  // 4. Admin Role Delegation & Protection Rules
  // ==========================================
  describe('4. Admin Role Delegation & Immutable Primary Protection', () => {
    let testUserNo;

    before(async () => {
      // Create a dedicated user for delegation testing
      const testUser = await createUser({
        username: 'qa_delegation_user',
        email: 'qa_delegation@system.local',
        contact_no: '9888777665',
        contact_address: 'QA Test Lab',
        aadhaar: '888877776666',
        password: 'Password123!',
        unit_type: 'unit',
        is_admin: 0
      });
      testUserNo = testUser.user_no;
      assignDefaultEntitlements(testUserNo, 'unit', false);
    });

    after(() => {
      if (testUserNo) {
        db.prepare('DELETE FROM user_entitlements WHERE user_no = ?').run(testUserNo);
        db.prepare('DELETE FROM users WHERE user_no = ?').run(testUserNo);
      }
    });

    it('should create new user as standard user (is_admin: 0) by default', () => {
      const u = getUserByNo(testUserNo);
      assert.equal(u.is_admin, 0);
      assert.ok(u.user_no.startsWith('USR-'));
    });

    it('should allow admin to grant admin role to standard user and sync entitlements', () => {
      setUserAdminRole(testUserNo, true);
      const u = getUserByNo(testUserNo);
      assert.equal(u.is_admin, 1);

      const entitlements = db.prepare('SELECT entitlement FROM user_entitlements WHERE user_no = ?')
        .all(testUserNo)
        .map(e => e.entitlement);
      assert.ok(entitlements.includes('MANAGE_USERS'), 'Has MANAGE_USERS entitlement');
      assert.ok(entitlements.includes('MANAGE_ENTITLEMENTS'), 'Has MANAGE_ENTITLEMENTS entitlement');
      assert.ok(entitlements.includes('VIEW_AUDIT_LOGS'), 'Has VIEW_AUDIT_LOGS entitlement');
    });

    it('should allow admin to revoke admin role from that user and strip admin entitlements', () => {
      setUserAdminRole(testUserNo, false);
      const u = getUserByNo(testUserNo);
      assert.equal(u.is_admin, 0);

      const entitlements = db.prepare('SELECT entitlement FROM user_entitlements WHERE user_no = ?')
        .all(testUserNo)
        .map(e => e.entitlement);
      assert.equal(entitlements.includes('MANAGE_USERS'), false);
      assert.equal(entitlements.includes('MANAGE_ENTITLEMENTS'), false);
      assert.equal(entitlements.includes('VIEW_AUDIT_LOGS'), false);
    });

    it('should strictly BLOCK revoking admin privileges from primary admin user', () => {
      assert.throws(() => {
        setUserAdminRole('ADM-0001', false);
      }, /Action blocked: Admin privileges for the primary "admin" user cannot be revoked/);

      // Verify admin account is still admin
      const admin = getUserByNo('ADM-0001');
      assert.equal(admin.is_admin, 1);
    });
  });

  // ==========================================
  // 5. Aadhaar Data Protection & Privacy
  // ==========================================
  describe('5. Strict Aadhaar Privacy & Non-Disclosure in UI', () => {
    it('should verify Aadhaar is stored encrypted and masked in the database', () => {
      const user = db.prepare('SELECT aadhaar_encrypted, aadhaar_masked FROM users WHERE user_no = ?').get('ADM-0001');
      assert.ok(user.aadhaar_encrypted, 'Encrypted Aadhaar exists');
      assert.ok(user.aadhaar_encrypted.includes(':'), 'Encrypted payload has IV:tag:ciphertext format');
      assert.equal(user.aadhaar_masked, 'XXXX-XXXX-9012');
    });

    it('should NOT render Aadhaar or Masked Aadhaar in /admin/users HTML table', async () => {
      // Login as admin
      const getLogin = await makeRequest('/login');
      const csrf = extractCsrfToken(getLogin.body, getLogin.cookies);
      const initialCookie = extractSessionCookie(getLogin.cookies);

      const postLogin = await makeRequest('/login', {
        method: 'POST',
        cookie: initialCookie,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=admin&password=AdminPassword123!&_csrf=${csrf}`
      });
      const adminCookie = extractSessionCookie(postLogin.cookies);

      const usersRes = await makeRequest('/admin/users', { cookie: adminCookie });
      assert.equal(usersRes.statusCode, 200);
      assert.equal(usersRes.body.includes('Masked Aadhaar'), false, 'Header "Masked Aadhaar" not in UI');
      assert.equal(usersRes.body.includes('XXXX-XXXX-'), false, 'Masked values not in UI');
    });

    it('should NOT render MASKED AADHAAR in event detail page', async () => {
      // Get any existing event record
      const event = db.prepare('SELECT record_id FROM event_records LIMIT 1').get();
      if (event) {
        const getLogin = await makeRequest('/login');
        const csrf = extractCsrfToken(getLogin.body, getLogin.cookies);
        const initialCookie = extractSessionCookie(getLogin.cookies);

        const postLogin = await makeRequest('/login', {
          method: 'POST',
          cookie: initialCookie,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `username=unit_user&password=UserPassword123!&_csrf=${csrf}`
        });
        const userCookie = extractSessionCookie(postLogin.cookies);

        const detailRes = await makeRequest(`/events/${event.record_id}`, { cookie: userCookie });
        assert.equal(detailRes.statusCode, 200);
        assert.equal(detailRes.body.includes('MASKED AADHAAR'), false, 'MASKED AADHAAR section removed from detail page');
      }
    });
  });

  // ==========================================
  // 6. ID Generation Resilience (No Collisions)
  // ==========================================
  describe('6. ID Generation Resilience After Deletions', () => {
    it('should not collide Event IDs after record deletion', () => {
      const sampleBuffer = Buffer.from('<svg></svg>', 'utf8');
      const fakeImage = {
        originalname: 'test.svg',
        mimetype: 'image/svg+xml',
        size: sampleBuffer.length,
        buffer: sampleBuffer
      };

      // Create record 1
      const rec1 = createEventRecord('ADM-0001', 'state', 'Test Collide 1', ['Health'], '2026-09-05', [fakeImage]);
      // Create record 2
      const rec2 = createEventRecord('ADM-0001', 'state', 'Test Collide 2', ['Culture'], '2026-09-05', [fakeImage]);

      // Delete record 1
      deleteEventRecord(rec1.record_id, { is_admin: 1, user_no: 'ADM-0001', unit_type: 'state' });

      // Create record 3 - Must NOT throw unique constraint or collide with rec2!
      const rec3 = createEventRecord('ADM-0001', 'state', 'Test Collide 3', ['Environment'], '2026-09-05', [fakeImage]);

      assert.notEqual(rec3.record_id, rec2.record_id, 'Record IDs are unique');
      const rec3Num = parseInt(rec3.record_id.split('-')[1], 10);
      const rec2Num = parseInt(rec2.record_id.split('-')[1], 10);
      assert.ok(rec3Num > rec2Num, 'Next ID is strictly greater than existing max ID');

      // Cleanup
      deleteEventRecord(rec2.record_id, { is_admin: 1, user_no: 'ADM-0001', unit_type: 'state' });
      deleteEventRecord(rec3.record_id, { is_admin: 1, user_no: 'ADM-0001', unit_type: 'state' });
    });
  });

  // ==========================================
  // 7. Dynamic Binary Image Serving
  // ==========================================
  describe('7. Binary Image BLOB Serving Endpoint', () => {
    let authCookie;

    before(async () => {
      const getLogin = await makeRequest('/login');
      const csrf = extractCsrfToken(getLogin.body, getLogin.cookies);
      const initialCookie = extractSessionCookie(getLogin.cookies);

      const postLogin = await makeRequest('/login', {
        method: 'POST',
        cookie: initialCookie,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=unit_user&password=UserPassword123!&_csrf=${csrf}`
      });
      authCookie = extractSessionCookie(postLogin.cookies);
    });

    it('should serve cached binary image with proper Content-Type and Cache-Control headers', async () => {
      const imageRow = db.prepare('SELECT id, mime_type FROM event_images LIMIT 1').get();
      if (imageRow) {
        const res = await makeRequest(`/events/images/${imageRow.id}`, { cookie: authCookie });
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['content-type'], imageRow.mime_type);
        assert.ok(res.headers['cache-control'].includes('public'), 'Cache-Control header enabled');
      }
    });

    it('should return 404 for non-existent image ID', async () => {
      const res = await makeRequest('/events/images/999999', { cookie: authCookie });
      assert.equal(res.statusCode, 404);
    });
  });

  // ==========================================
  // 8. Event Deletion Authorization
  // ==========================================
  describe('8. Event Deletion Authorization Rules', () => {
    let testRecordId;

    before(() => {
      // Created by unit_user (USR-0001)
      const rec = createEventRecord('USR-0001', 'unit', 'Unit User Record', ['Community'], '2026-09-05', []);
      testRecordId = rec.record_id;
    });

    after(() => {
      if (testRecordId) {
        db.prepare('DELETE FROM event_records WHERE record_id = ?').run(testRecordId);
      }
    });

    it('should reject deletion attempt by another non-admin user with HTTP 403', () => {
      assert.throws(() => {
        // district_user (USR-0002) tries to delete unit_user (USR-0001) record
        deleteEventRecord(testRecordId, {
          is_admin: 0,
          user_no: 'USR-0002',
          unit_type: 'district'
        });
      }, (err) => {
        return err.status === 403 && /Unauthorized action/i.test(err.message);
      });
    });

    it('should allow super admin to delete any record regardless of creator', () => {
      const result = deleteEventRecord(testRecordId, {
        is_admin: 1,
        user_no: 'ADM-0001',
        unit_type: 'state'
      });
      assert.equal(result, true);

      // Verify record is gone
      const check = getEventRecordById(testRecordId);
      assert.equal(check, null);
      testRecordId = null; // Already deleted
    });
  });

  // ==========================================
  // 9. UI Components & Dynamic Hierarchy Cascading
  // ==========================================
  describe('9. UI Components & Dynamic Hierarchy Cascading', () => {
    let adminCookie;
    let userCookie;

    before(async () => {
      // Admin session
      const getLoginA = await makeRequest('/login');
      const csrfA = extractCsrfToken(getLoginA.body, getLoginA.cookies);
      const cookieA = extractSessionCookie(getLoginA.cookies);
      const postLoginA = await makeRequest('/login', {
        method: 'POST',
        cookie: cookieA,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=admin&password=AdminPassword123!&_csrf=${csrfA}`
      });
      adminCookie = extractSessionCookie(postLoginA.cookies);

      // User session
      const getLoginU = await makeRequest('/login');
      const csrfU = extractCsrfToken(getLoginU.body, getLoginU.cookies);
      const cookieU = extractSessionCookie(getLoginU.cookies);
      const postLoginU = await makeRequest('/login', {
        method: 'POST',
        cookie: cookieU,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=unit_user&password=UserPassword123!&_csrf=${csrfU}`
      });
      userCookie = extractSessionCookie(postLoginU.cookies);
    });

    it('should render /events/create with dynamic location tree and client-side cascading script', async () => {
      const res = await makeRequest('/events/create', { cookie: userCookie });
      assert.equal(res.statusCode, 200);
      assert.ok(res.body.includes('locationTree ='), 'Script defines locationTree variable');
      assert.ok(res.body.includes('onStateSelectChange'), 'Script has onStateSelectChange');
      assert.ok(res.body.includes('onDistrictSelectChange'), 'Script has onDistrictSelectChange');
      assert.ok(res.body.includes('Tamil Nadu'), 'Contains default state in options');
      assert.ok(!res.body.includes('aadhaar'), 'Does not leak Aadhaar in event create form');
    });

    it('should render /admin/users/create with dynamic cascading and no duplicate options', async () => {
      const res = await makeRequest('/admin/users/create', { cookie: adminCookie });
      assert.equal(res.statusCode, 200);
      assert.ok(res.body.includes('locationTree ='), 'User create defines locationTree variable');
      assert.ok(res.body.includes('onStateSelectChange'), 'User create has onStateSelectChange');

      // Check no duplicated hardcoded values like "<option value=\"Tamil Nadu\">Tamil Nadu</option>" repeated twice
      const occurrences = (res.body.match(/<option value="Tamil Nadu">Tamil Nadu<\/option>/g) || []).length;
      assert.equal(occurrences, 1, 'State option appears exactly once, without duplicate hardcoding');
    });

    it('should verify getLocationHierarchyTree returns hierarchical State -> District -> Unit structure', () => {
      const { getLocationHierarchyTree } = require('../services/locationService');
      const tree = getLocationHierarchyTree();
      assert.ok(Array.isArray(tree), 'Tree is an array of states');
      assert.ok(tree.length > 0, 'Tree has states');

      const tn = tree.find(s => s.name === 'Tamil Nadu');
      assert.ok(tn, 'Tamil Nadu found in tree');
      assert.ok(Array.isArray(tn.districts), 'Districts is an array');

      const chn = tn.districts.find(d => d.name === 'Chennai');
      assert.ok(chn, 'Chennai found in Tamil Nadu districts');
      assert.ok(Array.isArray(chn.units), 'Units is an array');

      const shol = chn.units.find(u => u.name === 'Sholinganallur');
      assert.ok(shol, 'Sholinganallur found in Chennai units');
    });

    it('should render alerts with dismiss button and proper accessibility markup', async () => {
      const res = await makeRequest('/events?success=OperationCompleted', { cookie: userCookie });
      assert.equal(res.statusCode, 200);
      assert.ok(res.body.includes('class="alert alert-success"'), 'Renders alert-success class');
      assert.ok(res.body.includes('class="alert-close"'), 'Renders dismiss close button');
      assert.ok(res.body.includes('aria-label="Close alert"'), 'Renders accessible aria-label');
      assert.ok(res.body.includes('OperationCompleted'), 'Renders alert message text');
    });
  });

  // ==========================================
  // 10. Validation Middleware & Edge Cases
  // ==========================================
  describe('10. Validation Middleware & Edge Cases', () => {
    it('should reject event creation when categories is missing or empty', () => {
      const { validateEventCreation } = require('../middleware/validationMiddleware');
      const req = {
        body: {
          title: 'Valid Title',
          event_date: '2026-09-05',
          state_name: 'Tamil Nadu',
          district_name: 'Chennai',
          unit_name: 'Sholinganallur',
          categories: []
        }
      };
      let capturedError;
      const next = (err) => { capturedError = err; };

      validateEventCreation(req, {}, next);
      assert.ok(capturedError, 'Validation error triggered');
      assert.equal(capturedError.status, 400);
      assert.match(capturedError.message, /category/i);
    });

    it('should reject user creation when contact_no is invalid format', () => {
      const { validateUserCreation } = require('../middleware/validationMiddleware');
      const req = {
        body: {
          username: 'validuser',
          email: 'valid@example.org',
          contact_no: 'abc-not-a-number',
          contact_address: '123 Main St',
          aadhaar: '123456789012',
          password: 'Password123!',
          unit_type: 'unit',
          state_name: 'Tamil Nadu',
          district_name: 'Chennai',
          unit_name: 'Sholinganallur'
        }
      };
      let capturedError;
      const next = (err) => { capturedError = err; };

      validateUserCreation(req, {}, next);
      assert.ok(capturedError, 'Validation error triggered');
      assert.equal(capturedError.status, 400);
      assert.match(capturedError.message, /contact number/i);
    });
  });

  // ==========================================
  // 11. Memory Leak Prevention & Performance
  // ==========================================
  describe('11. Memory Leak Prevention & High-Scale Performance', () => {
    let authCookie;

    before(async () => {
      const getLogin = await makeRequest('/login');
      const csrf = extractCsrfToken(getLogin.body, getLogin.cookies);
      const cookie = extractSessionCookie(getLogin.cookies);
      const postLogin = await makeRequest('/login', {
        method: 'POST',
        cookie,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=unit_user&password=UserPassword123!&_csrf=${csrf}`
      });
      authCookie = extractSessionCookie(postLogin.cookies);
    });

    it('should enforce bounded memory cache and auto-sweep expired entries', () => {
      const cacheService = require('../services/cacheService');
      const initialStats = cacheService.getStats();
      assert.ok(initialStats.maxItems <= 250, 'Max items capped at 250 to prevent heap bloat');

      // Set item with 1ms TTL and sweep
      cacheService.set('temp_test_key', { data: 'test' }, 0.001);
      setTimeout(() => {
        cacheService.sweepExpired();
        assert.equal(cacheService.get('temp_test_key'), null, 'Expired item was purged by sweeper');
      }, 5);
    });

    it('should serve images with ETag and return HTTP 304 Not Modified on cache hit', async () => {
      const imageRow = db.prepare('SELECT id, mime_type, file_size FROM event_images LIMIT 1').get();
      if (imageRow) {
        // Initial request
        const res1 = await makeRequest(`/events/images/${imageRow.id}`, { cookie: authCookie });
        assert.equal(res1.statusCode, 200);
        const etag = res1.headers['etag'];
        assert.ok(etag, 'ETag header is present');
        assert.ok(res1.headers['cache-control'].includes('immutable'), 'Immutable cache header is enabled');

        // Subsequent conditional request
        const res2 = await makeRequest(`/events/images/${imageRow.id}`, {
          cookie: authCookie,
          headers: { 'If-None-Match': etag }
        });
        assert.equal(res2.statusCode, 304, 'Returns 304 Not Modified to eliminate bandwidth & RAM overhead');
        assert.equal(res2.body, '', 'Empty body on 304 response');
      }
    });

    it('should execute server-side paginated queries without loading full dataset', () => {
      const { getEventRecords } = require('../services/eventService');
      const result = getEventRecords({}, 1, 5);

      assert.ok(result.records, 'Result has records array');
      assert.ok(Array.isArray(result.records));
      assert.ok(result.records.length <= 5, 'Records capped by pageSize');
      assert.ok(typeof result.totalRecords === 'number', 'Total records count computed');
      assert.ok(result.totalPages >= 1, 'Total pages computed');
      assert.equal(result.currentPage, 1);
      assert.equal(result.pageSize, 5);
    });
  });

  // ==========================================
  // 12. Zero Creator ID Exposure Across All Views
  // ==========================================
  describe('12. Zero Creator ID Exposure in UI', () => {
    let authCookie;
    let testRecordId;

    before(async () => {
      const getLogin = await makeRequest('/login');
      const csrf = extractCsrfToken(getLogin.body, getLogin.cookies);
      const cookie = extractSessionCookie(getLogin.cookies);
      const postLogin = await makeRequest('/login', {
        method: 'POST',
        cookie,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=unit_user&password=UserPassword123!&_csrf=${csrf}`
      });
      authCookie = extractSessionCookie(postLogin.cookies);

      const firstRec = db.prepare('SELECT record_id FROM event_records LIMIT 1').get();
      if (firstRec) {
        testRecordId = firstRec.record_id;
      }
    });

    it('should NOT render Creator ID or user_no in /events feed HTML cards', async () => {
      const res = await makeRequest('/events', { cookie: authCookie });
      assert.equal(res.statusCode, 200);
      assert.ok(!res.body.includes('👤 Creator:'), 'Does not render Creator label in event cards');
      assert.ok(!res.body.includes('Creator: <strong>'), 'No creator strong tag');
    });

    it('should NOT render RECORD CREATOR or creator ID in /events/:id detail view', async () => {
      if (testRecordId) {
        const res = await makeRequest(`/events/${testRecordId}`, { cookie: authCookie });
        assert.equal(res.statusCode, 200);
        assert.ok(!res.body.includes('RECORD CREATOR'), 'Does not render RECORD CREATOR section');
        assert.ok(!res.body.includes('Record Creator'), 'Case-insensitive check for Record Creator');
      }
    });
  });

  // =========================================================================
  // 13. Event Description & Notes - Storage, 100-Word Truncation & Modal
  // =========================================================================
  describe('13. Event Description & Notes Storage, 100-Word Truncation & Modal', () => {
    let authCookie;
    let longDescRecordId;
    let shortDescRecordId;

    // Generate 120 words long description
    const longDescWords = Array.from({ length: 120 }, (_, i) => `word${i + 1}`);
    const longDesc = longDescWords.join(' ');
    const testNotes = 'Special internal committee follow-up notes and resolutions.';

    // Generate 30 words short description
    const shortDesc = 'This is a brief 30-word event description commemorating annual academic awards and youth leadership programs conducted at the Sholinganallur unit level with community members present.';

    before(async () => {
      const getLogin = await makeRequest('/login');
      const csrf = extractCsrfToken(getLogin.body, getLogin.cookies);
      const cookie = extractSessionCookie(getLogin.cookies);
      const postLogin = await makeRequest('/login', {
        method: 'POST',
        cookie,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=unit_user&password=UserPassword123!&_csrf=${csrf}`
      });
      authCookie = extractSessionCookie(postLogin.cookies);

      const userRow = db.prepare("SELECT user_no FROM users WHERE username = 'unit_user' LIMIT 1").get();
      const validUserNo = userRow ? userRow.user_no : 'USR-0001';

      // Create an event record with >100 words description and notes
      const recLong = createEventRecord(
        validUserNo,
        'unit',
        'Long Description Conference 2026',
        ['Conference', 'Culture'],
        '2026-04-15',
        [],
        'Tamil Nadu',
        'Chennai',
        'Sholinganallur',
        longDesc,
        testNotes
      );
      longDescRecordId = recLong.record_id;

      // Create an event record with <=100 words description
      const recShort = createEventRecord(
        validUserNo,
        'unit',
        'Short Description Gathering 2026',
        ['Community'],
        '2026-04-16',
        [],
        'Tamil Nadu',
        'Chennai',
        'Sholinganallur',
        shortDesc,
        ''
      );
      shortDescRecordId = recShort.record_id;
    });

    after(() => {
      if (longDescRecordId) {
        db.prepare('DELETE FROM event_records WHERE record_id = ?').run(longDescRecordId);
      }
      if (shortDescRecordId) {
        db.prepare('DELETE FROM event_records WHERE record_id = ?').run(shortDescRecordId);
      }
    });

    it('should store and retrieve description and notes in SQLite database', async () => {
      const stored = getEventRecordById(longDescRecordId);
      assert.ok(stored, 'Record retrieved');
      assert.equal(stored.description, longDesc);
      assert.equal(stored.notes, testNotes);
    });

    it('should render title only on /events list feed cards without description text box', async () => {
      const res = await makeRequest('/events', { cookie: authCookie });
      assert.equal(res.statusCode, 200);

      assert.ok(res.body.includes(longDescRecordId), 'Event card rendered on list page');
      assert.ok(res.body.includes('Long Description Conference 2026'), 'Title is rendered');
      assert.ok(!res.body.includes('event-card-desc-box'), 'No description text box rendered in list cards');
    });

    it('should render 50-word brief description and inline "Show More" on /events/:id detail page', async () => {
      const res = await makeRequest(`/events/${longDescRecordId}`, { cookie: authCookie });
      assert.equal(res.statusCode, 200);

      // Verify 50-word brief description snippet appears on detail page
      assert.ok(res.body.includes('show-more-inline-btn'), 'Has Show More button on detail page');
      assert.ok(res.body.includes(`openDescriptionModal('${longDescRecordId}')`), 'Calls openDescriptionModal with record ID');

      // The 50th word should be followed by ellipsis
      assert.ok(res.body.includes('word50...'), 'Has truncated ellipsis after word 50');

      // Hidden payload should exist with the complete raw description
      assert.ok(res.body.includes(`desc-payload-${longDescRecordId}`), 'Hidden payload container present');
      assert.ok(res.body.includes(testNotes), 'Notes included in hidden payload');
    });

    it('should NOT render "Show More" button when description is <= 50 words on detail page', async () => {
      const res = await makeRequest(`/events/${shortDescRecordId}`, { cookie: authCookie });
      assert.equal(res.statusCode, 200);

      assert.ok(res.body.includes(shortDesc), 'Displays full short description');
      assert.ok(!res.body.includes('show-more-inline-btn'), 'No Show More button for short description');
    });

    it('should include full description modal markup, backdrop, and handlers in detail page HTML', async () => {
      const res = await makeRequest(`/events/${longDescRecordId}`, { cookie: authCookie });
      assert.equal(res.statusCode, 200);

      assert.ok(res.body.includes('id="event-description-modal"'), 'Modal overlay exists');
      assert.ok(res.body.includes('desc-modal-backdrop'), 'Modal backdrop class exists');
      assert.ok(res.body.includes('desc-modal-container'), 'Modal container exists');
      assert.ok(res.body.includes('desc-modal-body'), 'Modal scrollable body exists');
      assert.ok(res.body.includes('openDescriptionModal'), 'openDescriptionModal function defined');
      assert.ok(res.body.includes('closeDescriptionModal'), 'closeDescriptionModal function defined');
      assert.ok(res.body.includes("e.key === 'Escape'"), 'Escape key handler present');
      assert.ok(res.body.includes('e.target === modal'), 'Click-outside detector present');
    });
  });

  // =========================================================================
  // 14. Reusable Helpers & Utilities (textHelper.js)
  // =========================================================================
  describe('14. Reusable Helpers & Utilities', () => {
    const { truncateWords, formatDate, slugify } = require('../helpers/textHelper');

    it('should safely handle empty, null, or non-string inputs in truncateWords', () => {
      assert.deepEqual(truncateWords(null), { text: '', isTruncated: false, wordCount: 0, original: '' });
      assert.deepEqual(truncateWords(undefined), { text: '', isTruncated: false, wordCount: 0, original: '' });
      assert.deepEqual(truncateWords(''), { text: '', isTruncated: false, wordCount: 0, original: '' });
      assert.deepEqual(truncateWords('   '), { text: '', isTruncated: false, wordCount: 0, original: '' });
      assert.deepEqual(truncateWords(12345), { text: '', isTruncated: false, wordCount: 0, original: '' });
    });

    it('should not truncate text with <= 50 words', () => {
      const sample = 'Sunni Students Federation Tamil Nadu state committee annual convention.';
      const res = truncateWords(sample, 50);
      assert.equal(res.isTruncated, false);
      assert.equal(res.wordCount, 9);
      assert.equal(res.text, sample);
      assert.equal(res.original, sample);
    });

    it('should accurately truncate text exceeding 50 words and append suffix', () => {
      const words = Array.from({ length: 65 }, (_, i) => `token${i + 1}`);
      const longText = words.join('   ');
      const res = truncateWords(longText, 50);

      assert.equal(res.isTruncated, true);
      assert.equal(res.wordCount, 65);
      assert.ok(res.text.endsWith('...'));
      assert.ok(res.text.includes('token50...'));
      assert.ok(!res.text.includes('token51'));
    });

    it('should format dates properly into human-readable strings', () => {
      const formatted = formatDate('2026-04-15');
      assert.ok(formatted.includes('2026'));
      assert.ok(formatted.includes('Apr'));
      assert.equal(formatDate(null), '');
      assert.equal(formatDate('not-a-date'), 'not-a-date');
    });

    it('should slugify strings for valid element IDs and URLs', () => {
      assert.equal(slugify('State Level Event #2026!'), 'state-level-event-2026');
      assert.equal(slugify('  Hello---World  '), 'hello-world');
      assert.equal(slugify(''), '');
    });
  });
});


