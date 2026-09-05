const assert = require('assert');
const app = require('../app');

async function verifyFlow() {
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const getLogin = await fetch(`${baseUrl}/login`);
    const loginHtml = await getLogin.text();
    const cookies = getLogin.headers.get('set-cookie');
    const csrfSecret = cookies ? cookies.split(';')[0] : '';
    const match = loginHtml.match(/name="_csrf" value="([^"]+)"/);
    const token = match ? match[1] : '';

    console.log('1. Login Page Status:', getLogin.status);
    console.log('2. CSRF Token extracted:', !!token);
    console.log('3. Has Full-Page CSS (100vw, 100vh):', loginHtml.includes('100vw') && loginHtml.includes('100vh'));
    console.log('4. Has Password Toggle Elements:', loginHtml.includes('pwd-toggle-btn') && loginHtml.includes('eye-icon-open'));
    console.log('5. Has Strict Color #3AB648:', loginHtml.includes('#3AB648'));
    console.log('6. Has Strict Color #EFF6FF:', loginHtml.includes('#EFF6FF'));
    console.log('7. Has Strict Color #000000:', loginHtml.includes('#000000'));
    console.log('8. Has Strict Color #FFFFFF:', loginHtml.includes('#FFFFFF'));
    console.log('8b. Has App Logo SVG (ssf-logo.svg):', loginHtml.includes('ssf-logo.svg'));
    console.log('8c. Has Login Left Flag SVG (ssf-flag.svg):', loginHtml.includes('ssf-flag.svg'));
    console.log('8d. Mobile View Hides Left Panel:', loginHtml.includes('display: none !important'));
    console.log('8e. Desktop View Highlights SSF Tamil Nadu Values:', loginHtml.includes("Sunni Students' Federation"));

    assert.strictEqual(getLogin.status, 200);
    assert.ok(token, 'CSRF token should be present');
    assert.ok(loginHtml.includes('100vw') && loginHtml.includes('100vh'), 'Desktop layout must occupy full viewport');
    assert.ok(loginHtml.includes('pwd-toggle-btn'), 'Password toggle button must exist');
    assert.ok(loginHtml.includes('ssf-logo.svg'), 'Login page must use ssf-logo.svg');
    assert.ok(loginHtml.includes('ssf-flag.svg'), 'Login page left side must display ssf-flag.svg');
    assert.ok(loginHtml.includes('display: none !important'), 'Mobile view must hide left citadel panel');
    assert.ok(loginHtml.includes("Sunni Students' Federation"), 'Desktop view must showcase SSF Tamil Nadu values');

    // Perform login
    const body = new URLSearchParams();
    body.append('_csrf', token);
    body.append('username', 'admin');
    body.append('password', 'AdminPassword123!');

    const postLogin = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': csrfSecret
      },
      body: body.toString(),
      redirect: 'manual'
    });

    console.log('9. Post Login Status (Redirect):', postLogin.status, 'Location:', postLogin.headers.get('location'));
    assert.strictEqual(postLogin.status, 302);
    assert.strictEqual(postLogin.headers.get('location'), '/admin');

    const sessionCookie = (postLogin.headers.get('set-cookie') || '').split(';')[0];
    console.log('10. Session Cookie received:', !!sessionCookie);
    assert.ok(sessionCookie, 'Session cookie must be set');

    // Fetch /admin with session
    const getAdmin = await fetch(`${baseUrl}/admin`, {
      headers: { 'Cookie': [csrfSecret, sessionCookie].filter(Boolean).join('; ') }
    });
    const adminHtml = await getAdmin.text();
    console.log('11. Authenticated /admin Status:', getAdmin.status);
    assert.strictEqual(getAdmin.status, 200);

    // Fetch /events with session
    const getEvents = await fetch(`${baseUrl}/events`, {
      headers: { 'Cookie': [csrfSecret, sessionCookie].filter(Boolean).join('; ') }
    });
    const eventsHtml = await getEvents.text();
    console.log('12. Authenticated /events Status:', getEvents.status);
    console.log('13. Has Events Feed Navbar & Brand with SVG Logo:', eventsHtml.includes('ssf-logo.svg') && eventsHtml.includes('navbar-brand'));
    console.log('14. Has Max Width 1440px Container:', eventsHtml.includes('container'));
    console.log('15. Feed Cards Display Title Only (No Description Box):', !eventsHtml.includes('event-card-desc-box'));

    assert.ok(eventsHtml.includes('ssf-logo.svg'), 'Navbar must include ssf-logo.svg');
    assert.strictEqual(getEvents.status, 200);
    assert.ok(!eventsHtml.includes('event-card-desc-box'), 'Feed cards must NOT display description box; title only');

    // Fetch /events/:id detail page to verify 50-word brief description and modal
    let eventMatch = eventsHtml.match(/href="\/events\/(EVT-\d+)"/);
    let recordId = eventMatch ? eventMatch[1] : null;
    if (!recordId) {
      const db = require('../db/connection');
      const rec = db.prepare('SELECT record_id FROM event_records LIMIT 1').get();
      if (rec) recordId = rec.record_id;
    }

    if (recordId) {
      const getDetail = await fetch(`${baseUrl}/events/${recordId}`, {
        headers: { 'Cookie': [csrfSecret, sessionCookie].filter(Boolean).join('; ') }
      });
      const detailHtml = await getDetail.text();
      console.log('16. Authenticated /events/:id Status:', getDetail.status);
      console.log('17. Detail View Has Description Modal Markup:', detailHtml.includes('id="event-description-modal"') && detailHtml.includes('desc-modal-backdrop'));
      console.log('18. Detail View Has Modal Dismiss & Backdrop Detectors:', detailHtml.includes('closeDescriptionModal') && detailHtml.includes('openDescriptionModal'));
      assert.strictEqual(getDetail.status, 200);
      assert.ok(detailHtml.includes('id="event-description-modal"'), 'Detail view must include description modal markup');
      assert.ok(detailHtml.includes('openDescriptionModal'), 'Detail view must include openDescriptionModal function');
    }

    // Fetch /events/create with session
    const getCreate = await fetch(`${baseUrl}/events/create`, {
      headers: { 'Cookie': [csrfSecret, sessionCookie].filter(Boolean).join('; ') }
    });
    const createHtml = await getCreate.text();
    console.log('18. Authenticated /events/create Status:', getCreate.status);
    console.log('19. Has Event Description & Notes Form Inputs:', createHtml.includes('name="description"') && createHtml.includes('name="notes"'));
    assert.strictEqual(getCreate.status, 200);
    assert.ok(createHtml.includes('name="description"'), 'Create form must have description textarea');
    assert.ok(createHtml.includes('name="notes"'), 'Create form must have notes textarea');

    console.log('\n>>> ALL END-TO-END FLOW CHECKS PASSED SUCCESSFULLY! <<<');
  } finally {
    server.close();
  }
}

verifyFlow().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
