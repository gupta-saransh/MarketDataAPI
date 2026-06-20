/* global CustomFunctions */

const API = 'https://market-data-api-psi.vercel.app/api';

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new CustomFunctions.Error(CustomFunctions.ErrorCode.notAvailable, `HTTP ${r.status}`);
  return r.json();
}

// Accepts DD-MM-YYYY string, YYYY-MM-DD string, or Excel serial date number.
function toApiDate(input) {
  if (typeof input === 'number') {
    return new Date((input - 25569) * 86400000).toISOString().slice(0, 10);
  }
  const s = String(input).trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split('-');
    return `${yyyy}-${mm}-${dd}`;
  }
  return s;
}

/**
 * Returns the latest NAV value for a scheme.
 * @customfunction
 * @param {number} code Scheme code
 * @returns {number}
 */
async function NAV(code) {
  const d = await get(`${API}/schemes/${code}/nav/latest`);
  return d.nav;
}

/**
 * Returns the date of the latest NAV for a scheme.
 * @customfunction
 * @param {number} code Scheme code
 * @returns {string}
 */
async function NAV_DATE(code) {
  const d = await get(`${API}/schemes/${code}/nav/latest`);
  const [yyyy, mm, dd] = d.nav_date.split('-');
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Returns the NAV for a scheme on a specific date (DD-MM-YYYY).
 * @customfunction
 * @param {number} code Scheme code
 * @param {any} date Date in DD-MM-YYYY format, or a cell formatted as a date
 * @returns {number}
 */
async function NAV_ON(code, date) {
  const apiDate = toApiDate(date);
  const d = await get(`${API}/schemes/${code}/nav?startDate=${apiDate}&endDate=${apiDate}`);
  if (!d.data || d.data.length === 0) {
    throw new CustomFunctions.Error(CustomFunctions.ErrorCode.notAvailable, 'No NAV for that date');
  }
  return d.data[0].nav;
}

/**
 * Returns the scheme name for a given scheme code.
 * @customfunction
 * @param {number} code Scheme code
 * @returns {string}
 */
async function NAME(code) {
  const d = await get(`${API}/schemes/${code}`);
  return d.data.scheme_name;
}

/**
 * Returns the fund house (AMC) name for a given scheme code.
 * @customfunction
 * @param {number} code Scheme code
 * @returns {string}
 */
async function FUND_HOUSE(code) {
  const d = await get(`${API}/schemes/${code}`);
  return d.data.fund_house;
}

CustomFunctions.associate('NAV',       NAV);
CustomFunctions.associate('NAV_DATE',  NAV_DATE);
CustomFunctions.associate('NAV_ON',    NAV_ON);
CustomFunctions.associate('NAME',      NAME);
CustomFunctions.associate('FUND_HOUSE', FUND_HOUSE);
