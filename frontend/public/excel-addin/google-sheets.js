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
 * Returns the NAV for a scheme on or before a given date (handles weekends & holidays).
 * @param {number} code Scheme code
 * @param {Date|string} date Date as DD-MM-YYYY string or a date-formatted cell
 * @return {number} NAV on the nearest trading day on or before that date
 * @customfunction
 */
function MF_NAV_ON(code, date) {
  const endDate = toApiDate_(date);
  // Look back 5 days so weekends and holidays resolve to the nearest trading day
  const d = new Date(endDate + 'T00:00:00');
  d.setDate(d.getDate() - 5);
  const startDate = Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd');
  const result = mfGet_(API_BASE + '/schemes/' + code + '/nav?startDate=' + startDate + '&endDate=' + endDate);
  if (!result.data || result.data.length === 0) throw new Error('No NAV data around ' + endDate);
  return result.data[0].nav; // newest-first, so first entry = nearest trading day
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

/**
 * Returns the previous trading day's NAV for a scheme.
 * @param {number} code Scheme code
 * @return {number} Previous NAV
 * @customfunction
 */
function MF_PREV_NAV(code) {
  return _lastTwoNavs_(code)[1].nav;
}

/**
 * Returns today's NAV change vs previous trading day as a percentage.
 * @param {number} code Scheme code
 * @return {number} Daily change % (e.g. 0.74 means +0.74%)
 * @customfunction
 */
function MF_DAILY_CHANGE(code) {
  const d = _lastTwoNavs_(code);
  return ((d[0].nav - d[1].nav) / d[1].nav) * 100;
}

/**
 * Returns today's absolute NAV change vs previous trading day.
 * @param {number} code Scheme code
 * @return {number} Absolute change in NAV value
 * @customfunction
 */
function MF_DAILY_CHANGE_ABS(code) {
  const d = _lastTwoNavs_(code);
  return d[0].nav - d[1].nav;
}

// Fetches last 7 days of NAV, returns two most recent entries (newest first).
// 7-day window handles weekends and market holidays automatically.
function _lastTwoNavs_(code) {
  const today   = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const start   = Utilities.formatDate(weekAgo, 'Asia/Kolkata', 'yyyy-MM-dd');
  const end     = Utilities.formatDate(today,   'Asia/Kolkata', 'yyyy-MM-dd');
  const d = mfGet_(API_BASE + '/schemes/' + code + '/nav?startDate=' + start + '&endDate=' + end);
  if (!d.data || d.data.length < 2) throw new Error('Not enough NAV data');
  return d.data;
}
