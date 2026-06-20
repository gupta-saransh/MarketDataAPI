// Market Data API — Google Sheets custom functions
// Paste this entire file into: Extensions → Apps Script → Code.gs → Save
// Then use =MF_NAV(101762) etc. directly in any cell.

const API_BASE = 'https://market-data-api-psi.vercel.app/api';

function mfGet_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
  return JSON.parse(res.getContentText());
}

// Accepts a Date cell, "DD-MM-YYYY" string, or "YYYY-MM-DD" string.
function toApiDate_(input) {
  if (input instanceof Date) {
    const yyyy = input.getFullYear();
    const mm = String(input.getMonth() + 1).padStart(2, '0');
    const dd = String(input.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }
  const s = String(input).trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const parts = s.split('-');
    return parts[2] + '-' + parts[1] + '-' + parts[0];
  }
  return s;
}

/**
 * Returns the latest NAV value for a mutual fund scheme.
 * @param {number} code Scheme code (e.g. 101762)
 * @return {number} Latest NAV
 * @customfunction
 */
function MF_NAV(code) {
  return mfGet_(API_BASE + '/schemes/' + code + '/nav/latest').nav;
}

/**
 * Returns the date of the latest NAV in DD-MM-YYYY format.
 * @param {number} code Scheme code
 * @return {string} NAV date
 * @customfunction
 */
function MF_NAV_DATE(code) {
  const d = mfGet_(API_BASE + '/schemes/' + code + '/nav/latest');
  const parts = d.nav_date.split('-');
  return parts[2] + '-' + parts[1] + '-' + parts[0];
}

/**
 * Returns the NAV for a scheme on a specific date.
 * @param {number} code Scheme code
 * @param {Date|string} date Date as DD-MM-YYYY string or a date-formatted cell
 * @return {number} NAV on that date
 * @customfunction
 */
function MF_NAV_ON(code, date) {
  const apiDate = toApiDate_(date);
  const d = mfGet_(API_BASE + '/schemes/' + code + '/nav?startDate=' + apiDate + '&endDate=' + apiDate);
  if (!d.data || d.data.length === 0) throw new Error('No NAV for that date');
  return d.data[0].nav;
}

/**
 * Returns the scheme name for a given scheme code.
 * @param {number} code Scheme code
 * @return {string} Scheme name
 * @customfunction
 */
function MF_NAME(code) {
  return mfGet_(API_BASE + '/schemes/' + code).data.scheme_name;
}

/**
 * Returns the fund house (AMC) name for a given scheme code.
 * @param {number} code Scheme code
 * @return {string} Fund house name
 * @customfunction
 */
function MF_FUND_HOUSE(code) {
  return mfGet_(API_BASE + '/schemes/' + code).data.fund_house;
}
