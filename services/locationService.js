const db = require('../config/database');
const cacheService = require('./cacheService');

/**
 * Get all states
 */
function getAllStates() {
  const cacheKey = 'locations:states';
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  const states = db.prepare(`SELECT id, name, code, created_at FROM states ORDER BY name ASC`).all();
  cacheService.set(cacheKey, states, 300); // 5 minutes cache
  return states;
}

/**
 * Get state by ID or Name
 */
function getStateByName(name) {
  return db.prepare(`SELECT id, name, code FROM states WHERE UPPER(name) = UPPER(?)`).get(name);
}

/**
 * Create a new State
 */
function createState(name, code) {
  const cleanName = name.trim();
  const cleanCode = (code || cleanName.substring(0, 3)).trim().toUpperCase();

  const stmt = db.prepare(`INSERT INTO states (name, code) VALUES (?, ?)`);
  stmt.run(cleanName, cleanCode);
  cacheService.deletePattern('^locations:');

  return getStateByName(cleanName);
}

/**
 * Get districts by State ID or State Name
 */
function getDistrictsByState(stateIdOrName) {
  let stateId = stateIdOrName;

  if (typeof stateIdOrName === 'string' && isNaN(parseInt(stateIdOrName, 10))) {
    const state = getStateByName(stateIdOrName);
    if (!state) return [];
    stateId = state.id;
  }

  const districts = db.prepare(`
    SELECT d.id, d.state_id, d.name, d.code, s.name as state_name
    FROM districts d
    JOIN states s ON d.state_id = s.id
    WHERE d.state_id = ?
    ORDER BY d.name ASC
  `).all(stateId);

  return districts;
}

/**
 * Get all districts across all states
 */
function getAllDistricts() {
  return db.prepare(`
    SELECT d.id, d.state_id, d.name, d.code, s.name as state_name
    FROM districts d
    JOIN states s ON d.state_id = s.id
    ORDER BY s.name ASC, d.name ASC
  `).all();
}

/**
 * Create a new District under a State
 */
function createDistrict(stateId, name, code) {
  const cleanName = name.trim();
  const cleanCode = (code || cleanName.substring(0, 4)).trim().toUpperCase();

  const stmt = db.prepare(`INSERT INTO districts (state_id, name, code) VALUES (?, ?, ?)`);
  stmt.run(stateId, cleanName, cleanCode);
  cacheService.deletePattern('^locations:');

  return db.prepare(`SELECT * FROM districts WHERE state_id = ? AND name = ?`).get(stateId, cleanName);
}

/**
 * Get units by District ID or District Name
 */
function getUnitsByDistrict(districtIdOrName) {
  let districtId = districtIdOrName;

  if (typeof districtIdOrName === 'string' && isNaN(parseInt(districtIdOrName, 10))) {
    const dist = db.prepare(`SELECT id FROM districts WHERE UPPER(name) = UPPER(?)`).get(districtIdOrName);
    if (!dist) return [];
    districtId = dist.id;
  }

  const units = db.prepare(`
    SELECT u.id, u.district_id, u.name, u.code, d.name as district_name, s.name as state_name
    FROM units u
    JOIN districts d ON u.district_id = d.id
    JOIN states s ON d.state_id = s.id
    WHERE u.district_id = ?
    ORDER BY u.name ASC
  `).all(districtId);

  return units;
}

/**
 * Get all units across all districts
 */
function getAllUnits() {
  return db.prepare(`
    SELECT u.id, u.district_id, u.name, u.code, d.name as district_name, s.name as state_name
    FROM units u
    JOIN districts d ON u.district_id = d.id
    JOIN states s ON d.state_id = s.id
    ORDER BY s.name ASC, d.name ASC, u.name ASC
  `).all();
}

/**
 * Create a new Unit under a District
 */
function createUnit(districtId, name, code) {
  const cleanName = name.trim();
  const cleanCode = (code || cleanName.substring(0, 4)).trim().toUpperCase();

  const stmt = db.prepare(`INSERT INTO units (district_id, name, code) VALUES (?, ?, ?)`);
  stmt.run(districtId, cleanName, cleanCode);
  cacheService.deletePattern('^locations:');

  return db.prepare(`SELECT * FROM units WHERE district_id = ? AND name = ?`).get(districtId, cleanName);
}

/**
 * Get complete locations hierarchy tree (State -> Districts -> Units)
 */
function getLocationHierarchyTree() {
  const states = getAllStates();
  const districts = getAllDistricts();
  const units = getAllUnits();

  const tree = states.map(s => {
    const stateDistricts = districts.filter(d => d.state_id === s.id).map(d => {
      const distUnits = units.filter(u => u.district_id === d.id);
      return {
        ...d,
        units: distUnits
      };
    });

    return {
      ...s,
      districts: stateDistricts
    };
  });

  return tree;
}

module.exports = {
  getAllStates,
  getStateByName,
  createState,
  getDistrictsByState,
  getAllDistricts,
  createDistrict,
  getUnitsByDistrict,
  getAllUnits,
  createUnit,
  getLocationHierarchyTree
};
