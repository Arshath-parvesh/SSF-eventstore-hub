const db = require('./database');
const { createUser, getUserByUsername } = require('../services/userService');
const { assignDefaultEntitlements } = require('../services/entitlementService');
const { createEventRecord } = require('../services/eventService');
const { loggerService } = require('../services/loggerService');

const { createState, createDistrict, createUnit, getAllStates } = require('../services/locationService');

/**
 * Seed initial system data (Bootstrap Admin, Default Users, Sample Records, Location Tree)
 */
async function seedDatabase() {
  try {
    // Seed initial States, Districts, and Units if states table is empty
    const existingStates = getAllStates();
    if (existingStates.length === 0) {
      console.log('[SEED] Seeding default States, Districts, and Units...');
      const tn = createState('Tamil Nadu', 'TN');
      const kl = createState('Kerala', 'KL');
      const ka = createState('Karnataka', 'KA');

      const chn = createDistrict(tn.id, 'Chennai', 'CHN');
      const cbe = createDistrict(tn.id, 'Coimbatore', 'CBE');
      const tpr = createDistrict(tn.id, 'Tirupur', 'TPR');
      const ekm = createDistrict(kl.id, 'Ernakulam', 'EKM');

      createUnit(chn.id, 'Sholinganallur', 'SLN');
      createUnit(chn.id, 'Anna Nagar', 'ANG');
      createUnit(cbe.id, 'Peelamedu', 'PMD');
      createUnit(cbe.id, 'R.S. Puram', 'RSP');
      createUnit(tpr.id, 'Avinashi', 'AVN');
      createUnit(ekm.id, 'Kochi', 'KCH');
    }

    const existingAdmin = getUserByUsername('admin');
    if (existingAdmin) {
      return; // Database already seeded
    }

    console.log('[SEED] Seeding system admin, hierarchy users, and initial event records...');

    // 1. Seed Bootstrap Super Admin
    const admin = await createUser({
      username: 'admin',
      email: 'admin@system.local',
      contact_no: '9876543210',
      secondary_no: '9876543211',
      contact_address: 'Central Admin Complex, Capital City',
      secondary_address: 'HQ Annex, Suite 100',
      aadhaar: '123456789012',
      password: 'AdminPassword123!',
      unit_type: 'state',
      state_name: 'Tamil Nadu',
      district_name: 'All',
      unit_name: 'All',
      is_admin: 1,
      status: 'active'
    });
    assignDefaultEntitlements(admin.user_no, 'state', true);

    // 2. Seed Unit Level User
    const unitUser = await createUser({
      username: 'unit_user',
      email: 'unit@system.local',
      contact_no: '9876543220',
      contact_address: 'Local Unit Office, Ward 4',
      aadhaar: '234567890123',
      password: 'UserPassword123!',
      unit_type: 'unit',
      state_name: 'Tamil Nadu',
      district_name: 'Chennai',
      unit_name: 'Sholinganallur',
      is_admin: 0,
      status: 'active'
    });
    assignDefaultEntitlements(unitUser.user_no, 'unit', false);

    // 3. Seed District Level User
    const districtUser = await createUser({
      username: 'district_user',
      email: 'district@system.local',
      contact_no: '9876543230',
      contact_address: 'District Headquarters, North Zone',
      aadhaar: '345678901234',
      password: 'UserPassword123!',
      unit_type: 'district',
      state_name: 'Tamil Nadu',
      district_name: 'Tirupur',
      unit_name: 'Avinashi',
      is_admin: 0,
      status: 'active'
    });
    assignDefaultEntitlements(districtUser.user_no, 'district', false);

    // 4. Seed State Level User
    const stateUser = await createUser({
      username: 'state_user',
      email: 'state@system.local',
      contact_no: '9876543240',
      contact_address: 'State Secretariat, Main Block',
      aadhaar: '456789012345',
      password: 'UserPassword123!',
      unit_type: 'state',
      state_name: 'Kerala',
      district_name: 'Ernakulam',
      unit_name: 'Kochi',
      is_admin: 0,
      status: 'active'
    });
    assignDefaultEntitlements(stateUser.user_no, 'state', false);

    // 5. Generate sample SVG image buffers for BLOB storage
    const createSampleSvgBuffer = (color, text) => {
      const svg = `
        <svg width="600" height="400" xmlns="http://www.w3.org/2000/svg">
          <rect width="100%" height="100%" fill="${color}"/>
          <circle cx="300" cy="180" r="80" fill="#3AB648" opacity="0.3"/>
          <text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="28" font-weight="bold" fill="#000000">${text}</text>
          <text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#3AB648">Event Management System</text>
        </svg>
      `;
      return Buffer.from(svg, 'utf-8');
    };

    const imgBuffer1 = createSampleSvgBuffer('#EFF6FF', 'Unit Annual Sports Event');
    const imgBuffer2 = createSampleSvgBuffer('#EFF6FF', 'District Awareness Convention');
    const imgBuffer3 = createSampleSvgBuffer('#EFF6FF', 'State Youth Summit 2026');

    // 6. Seed initial event records with BLOB images
    createEventRecord(
      unitUser.user_no,
      'unit',
      'Community Unit Health & Wellness Camp',
      ['Health', 'Community'],
      '2026-08-10',
      [{ originalname: 'health_camp.svg', mimetype: 'image/svg+xml', size: imgBuffer1.length, buffer: imgBuffer1 }],
      'Tamil Nadu',
      'Chennai',
      'Sholinganallur'
    );

    createEventRecord(
      districtUser.user_no,
      'district',
      'District Environment Protection Seminar',
      ['Environment', 'Conference'],
      '2026-08-15',
      [{ originalname: 'district_seminar.svg', mimetype: 'image/svg+xml', size: imgBuffer2.length, buffer: imgBuffer2 }],
      'Tamil Nadu',
      'Tirupur',
      'Avinashi'
    );

    createEventRecord(
      stateUser.user_no,
      'state',
      'State Cultural Festival & Award Ceremony',
      ['Culture', 'Awards'],
      '2026-08-25',
      [{ originalname: 'state_festival.svg', mimetype: 'image/svg+xml', size: imgBuffer3.length, buffer: imgBuffer3 }],
      'Kerala',
      'Ernakulam',
      'Kochi'
    );

    console.log('[SEED] System seeding complete successfully.');
  } catch (err) {
    console.error('[SEED ERROR]', err);
  }
}

module.exports = { seedDatabase };
