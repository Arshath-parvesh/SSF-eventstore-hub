const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const app = require('../app');
const { getSessionConfig } = require('../middleware/sessionTimeoutMiddleware');

test('Session Inactivity & UI-Server Interaction Test Suite', async (t) => {
  // 1. Verify Non-JS Configuration Loading
  await t.test('1. should load 5-minute timeout from config/session.json', () => {
    const config = getSessionConfig();
    assert.strictEqual(config.sessionIdleTimeoutMinutes, 5, 'Must be configured for 5 minutes');
    assert.strictEqual(config.idleTimeoutMs, 5 * 60 * 1000, 'Must calculate 300,000 ms');
    assert.strictEqual(config.warningCountdownSeconds, 30, 'Warning countdown must be 30 seconds');
    assert.strictEqual(config.heartbeatIntervalSeconds, 30, 'Heartbeat interval must be 30 seconds');
  });

  // Start test server on ephemeral port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 2. Fetch Login & CSRF
    let csrfSecret = '';
    let csrfToken = '';
    let sessionCookie = '';

    await t.test('2. should fetch login page and extract CSRF token', async () => {
      const res = await fetch(`${baseUrl}/login`);
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      csrfSecret = (res.headers.get('set-cookie') || '').split(';')[0];
      const match = html.match(/name="_csrf" value="([^"]+)"/);
      assert.ok(match, 'CSRF input must be present');
      csrfToken = match[1];
    });

    // 3. Authenticate and initialize session
    await t.test('3. should authenticate session and initialize activity tracking', async () => {
      const body = new URLSearchParams();
      body.append('_csrf', csrfToken);
      body.append('username', 'admin');
      body.append('password', 'AdminPassword123!');

      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': csrfSecret
        },
        body: body.toString(),
        redirect: 'manual'
      });

      assert.strictEqual(res.status, 302, 'Successful login must redirect');
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
      const sidCookie = setCookies.find(c => c.includes('connect.sid'));
      assert.ok(sidCookie, 'Session cookie connect.sid must be set');
      sessionCookie = sidCookie.split(';')[0];
    });

    const authHeaders = {
      'Cookie': [csrfSecret, sessionCookie].join('; ')
    };

    // 4. Query /api/session/status
    await t.test('4. should return active session status via GET /api/session/status', async () => {
      const res = await fetch(`${baseUrl}/api/session/status`, {
        headers: authHeaders
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.authenticated, true);
      assert.strictEqual(data.expired, false);
      assert.strictEqual(data.idleTimeoutMs, 300000);
      assert.ok(data.remainingMs > 280000 && data.remainingMs <= 300000, `Remaining ms should be near 300000, got ${data.remainingMs}`);
    });

    // 5. Send Heartbeat to /api/session/heartbeat
    await t.test('5. should refresh lastActivity timestamp on POST /api/session/heartbeat', async () => {
      const res = await fetch(`${baseUrl}/api/session/heartbeat`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.authenticated, true);
      assert.strictEqual(data.remainingMs, 300000);
    });

    // 6. Verify Authenticated Pages Include Modal and Monitor
    await t.test('6. should render session-inactivity-modal and session-monitor.js in authenticated views', async () => {
      const res = await fetch(`${baseUrl}/events`, {
        headers: authHeaders
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('id="session-inactivity-modal"'), 'Must contain inactivity warning modal');
      assert.ok(html.includes('session-monitor.js'), 'Must load session-monitor.js script');
      assert.ok(html.includes('sessionIdleTimeoutMinutes: 5'), 'Must inject 5 minute timeout config');
    });

    // 7. Explicit Session Timeout on Inactivity Expiry
    await t.test('7. should destroy session on POST /api/session/timeout and redirect', async () => {
      const res = await fetch(`${baseUrl}/api/session/timeout`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.expired, true);
      assert.strictEqual(data.redirect, '/login?expired=1');

      // Check that session is now dead
      const statusRes = await fetch(`${baseUrl}/api/session/status`, {
        headers: authHeaders
      });
      const statusData = await statusRes.json();
      assert.strictEqual(statusData.authenticated, false);
      assert.strictEqual(statusData.expired, true);
    });

    // 8. Verify Login Expiry Banner
    await t.test('8. should render clear session expiry notice on /login?expired=1', async () => {
      const res = await fetch(`${baseUrl}/login?expired=1`);
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('expired due to 5 minutes of inactivity'), 'Must display 5-minute inactivity message');
    });

    // 9. Server-side Inactivity Enforcement
    await t.test('9. should reject request and redirect to /login?expired=1 when inactivity exceeds threshold', async () => {
      const body = new URLSearchParams();
      body.append('_csrf', csrfToken);
      body.append('username', 'admin');
      body.append('password', 'AdminPassword123!');

      const loginRes = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': csrfSecret
        },
        body: body.toString(),
        redirect: 'manual'
      });
      const setCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get('set-cookie') || ''];
      const sid = setCookies.find(c => c.includes('connect.sid')).split(';')[0];
      const headers = { 'Cookie': [csrfSecret, sid].join('; ') };

      // Temporarily simulate timeout via env override
      process.env.SESSION_IDLE_TIMEOUT_MINUTES = '0.001'; // ~60ms
      await new Promise(r => setTimeout(r, 100));

      const expiredRes = await fetch(`${baseUrl}/events`, {
        headers,
        redirect: 'manual'
      });
      assert.strictEqual(expiredRes.status, 302);
      assert.strictEqual(expiredRes.headers.get('location'), '/login?expired=1');

      // Reset env back to default
      delete process.env.SESSION_IDLE_TIMEOUT_MINUTES;
    });

  } finally {
    server.close();
  }
});
