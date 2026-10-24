/**
 * Mutual Fund NAV Monitor — calendar-relative comparisons.
 * Source: https://api.mfapi.in/mf/{schemeCode} (DD-MM-YYYY NAV dates).
 * Accepts DD-MM-YYYY and DD/MM/YYYY, displays DD/MM/YYYY in Sheets.
 * No dashboard or index sheet is created or edited.
 * Entry point: monitorMutualFundsWithBackfill
 */
const MF_CONFIG = {
  funds: [
    { name: 'PPFAS Flexicap', code: '122639' },
    { name: 'Mirae Lrg-n-Midcp', code: '118834' },
    { name: 'SBI Smallcp', code: '125497' },
    { name: 'Axis ELSS', code: '120503' },
    { name: 'Axis Nifty500Mom50', code: '153244' },
    { name: 'UTI Nifty500V50', code: '151739' },
    { name: 'Edelweiss MidCp', code: '140228' },
    { name: 'ICICI Lrg-n-Midcp', code: '120596' },
    { name: 'Bandhan small cap', code: '147946' },
    { name: 'ICICI Pru Gold', code: '120685' },
    { name: 'Nippon Nifty500 Lv50', code: '153474' }
  ],
  recipientEmail: 'CHANGE_ME@example.com', // REQUIRED: set your own email
  alertThreshold1M: 5,               // Absolute 1-month percentage NAV move
  percentileThreshold: 5,            // Bottom/top 5% of preceding calendar year
  sendAlertsOnInitialBackfill: false, // No surprise alerts when rebuilding fund sheets
  missingValue: 'N/A',                // Only before the fund has comparison history
  headers: [
    'Latest Date', 'Latest NAV',
    '1M Prior Date', '1M Prior NAV', '% Difference (1M)',
    '3M Prior Date', '3M Prior NAV', '% Difference (3M)',
    '6M Prior Date', '6M Prior NAV', '% Difference (6M)',
    '1-Yr Prior Date', '1-Yr Prior NAV', '% Difference (1-Yr)',
    'Email Alert Sent?'
  ]
};

/** Schedule this function daily, preferably after the NAV source updates. */
function monitorMutualFundsWithBackfill() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log('Another run is active; skipping this run.');
    return;
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error('Use a spreadsheet-bound Apps Script project.');
    MF_CONFIG.funds.forEach(function(fund) {
      try {
        const history = fetchNAVHistory(fund.code);
        if (!history.length) throw new Error('No valid NAV records returned.');
        const sheet = getOrCreateFundSheet(ss, fund.name);
        ensureExpectedHeaders(sheet);
        if (sheet.getLastRow() === 1) {
          backfillFundSheet(sheet, history, fund.name);
        } else {
          insertLatestIfNew(sheet, history, fund.name);
        }
        console.log('Completed ' + fund.name + ' (' + history[history.length - 1].date + ')');
      } catch (e) {
        console.error('FAILED ' + fund.name + ': ' + e.stack);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateFundSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, MF_CONFIG.headers.length).setValues([MF_CONFIG.headers]);
  }
  return sheet;
}

function ensureExpectedHeaders(sheet) {
  const hdr = sheet.getRange(1, 1, 1, MF_CONFIG.headers.length).getDisplayValues()[0];
  if (hdr.every(function(x) { return x === ''; }) && sheet.getLastRow() === 1) {
    sheet.getRange(1, 1, 1, MF_CONFIG.headers.length).setValues([MF_CONFIG.headers]);
    return;
  }
  if (hdr.some(function(x, i) { return x !== MF_CONFIG.headers[i]; })) {
    throw new Error('Unexpected columns in ' + sheet.getName() + '. Delete the OLD individual fund tab and rerun, or rename it before rebuilding.');
  }
}

function fetchNAVHistory(code) {
  const url = 'https://api.mfapi.in/mf/' + encodeURIComponent(code);
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();
  if (statusCode !== 200) {
    throw new Error('MFAPI HTTP ' + statusCode + ' for scheme ' + code + ': ' + responseText.slice(0, 200));
  }

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch (e) {
    throw new Error('MFAPI returned invalid JSON for scheme ' + code + ': ' + e.message);
  }
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error('MFAPI returned no data array for scheme ' + code +
      '. Status: ' + (payload && payload.status ? payload.status : 'unknown'));
  }

  const byKey = Object.create(null);
  let rejected = 0;
  let firstRejected = '';
  payload.data.forEach(function(item) {
    try {
      if (!item) throw new Error('empty item');
      const key = isoFromDMY(String(item.date || '').trim());
      const nav = Number(item.nav);
      if (!Number.isFinite(nav) || nav <= 0) throw new Error('invalid NAV: ' + item.nav);
      byKey[key] = { key: key, date: dmyFromISO(key), nav: nav };
    } catch (e) {
      rejected++;
      if (!firstRejected) {
        firstRejected = JSON.stringify(item).slice(0, 180) + ' (' + e.message + ')';
      }
    }
  });

  const history = Object.keys(byKey).sort().map(function(key) { return byKey[key]; });
  if (!history.length) {
    throw new Error('No valid NAV records for scheme ' + code + '. API records: ' +
      payload.data.length + ', rejected: ' + rejected +
      (firstRejected ? ', first rejection: ' + firstRejected : '') +
      '. Expected dates DD-MM-YYYY or DD/MM/YYYY.');
  }
  if (rejected) {
    console.warn('Scheme ' + code + ': skipped ' + rejected +
      ' malformed API records; first: ' + firstRejected);
  }
  return history;
}

/** MFAPI normally returns DD-MM-YYYY; support DD/MM/YYYY for compatibility. */
function isoFromDMY(s) {
  const m = /^(\d{2})([-\/])(\d{2})\2(\d{4})$/.exec(s);
  if (!m) throw new Error('Invalid NAV date (expected DD-MM-YYYY or DD/MM/YYYY): ' + s);
  const day = Number(m[1]), month = Number(m[3]), year = Number(m[4]);
  const key = String(year).padStart(4, '0') + '-' +
    String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month ||
      parsed.getUTCDate() !== day) throw new Error('Invalid calendar date: ' + s);
  return key;
}

function dmyFromISO(key) { return key.slice(8, 10) + '/' + key.slice(5, 7) + '/' + key.slice(0, 4); }

/** Pure UTC calendar arithmetic: Jan 31 -> Dec 31 (1M), Mar 31 -> Feb 28/29 (1M). */
function calendarLookbackKey(key, monthsBack) {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  const firstOfTarget = new Date(Date.UTC(year, month - 1 - monthsBack, 1));
  const y = firstOfTarget.getUTCFullYear();
  const m = firstOfTarget.getUTCMonth() + 1;
  const daysInTarget = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' +
    String(Math.min(day, daysInTarget)).padStart(2, '0');
}

/** Greatest observation with date <= requested calendar date; never uses a future NAV. */
function navOnOrBefore(history, targetKey) {
  let lo = 0, hi = history.length - 1, match = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (history[mid].key <= targetKey) { match = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return match < 0 ? null : history[match];
}

function differencePct(current, prior) {
  return Number((((current - prior) / prior) * 100).toFixed(2));
}

function makeFundRow(history, index, alertLabel) {
  const current = history[index];
  const out = [current.date, current.nav];
  const comparisons = [];
  [1, 3, 6, 12].forEach(function(months) {
    const target = calendarLookbackKey(current.key, months);
    const prior = navOnOrBefore(history, target);
    if (prior) {
      const diff = differencePct(current.nav, prior.nav);
      out.push(prior.date, prior.nav, diff);
      comparisons.push({ label: months === 12 ? '1-Yr' : months + 'M', target: target, prior: prior, diff: diff });
    } else {
      out.push(MF_CONFIG.missingValue, MF_CONFIG.missingValue, MF_CONFIG.missingValue);
      comparisons.push({ label: months === 12 ? '1-Yr' : months + 'M', target: target, prior: null, diff: null });
    }
  });
  out.push(alertLabel || 'No');
  return { values: out, current: current, comparisons: comparisons };
}

function backfillFundSheet(sheet, history, fundName) {
  // Full NAV history, including the fund's first year (undefined comparisons -> N/A).
  const rows = [];
  for (let i = history.length - 1; i >= 0; i--) rows.push(makeFundRow(history, i, 'No').values);
  if (rows.length) {
    // Add enough rows before bulk write; batches avoid oversized setValues calls.
    const missingRows = rows.length + 1 - sheet.getMaxRows();
    if (missingRows > 0) sheet.insertRowsAfter(sheet.getMaxRows(), missingRows);
    for (let offset = 0; offset < rows.length; offset += 500) {
      const batch = rows.slice(offset, offset + 500);
      sheet.getRange(offset + 2, 1, batch.length, MF_CONFIG.headers.length).setValues(batch);
    }
  }
  formatFundSheet(sheet);
  // Deliberate default: rebuilding history never triggers alerts or floods inboxes.
  if (MF_CONFIG.sendAlertsOnInitialBackfill) {
    const latest = makeFundRow(history, history.length - 1, 'No');
    processAlertForRow(sheet, 2, history, latest, fundName);
  }
}

function sheetDateKey(value, tz) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  const text = String(value == null ? '' : value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  try { return isoFromDMY(text); } catch (ignored) { return ''; }
}

function insertLatestIfNew(sheet, history, fundName) {
  const latest = history[history.length - 1];
  const tz = sheet.getParent().getSpreadsheetTimeZone();
  const existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  const existingKeys = Object.create(null);
  existing.forEach(function(row) {
    const key = sheetDateKey(row[0], tz);
    if (key) existingKeys[key] = true;
  });
  if (existingKeys[latest.key]) {
    console.log('Skipped duplicate NAV date: ' + fundName + ' (' + latest.date + ')');
    return;
  }
  const topKey = sheetDateKey(existing[0][0], tz);
  if (topKey && latest.key < topKey) {
    console.log('Skipped stale API date: ' + fundName + ' (' + latest.date + ')');
    return;
  }
  const prepared = makeFundRow(history, history.length - 1, 'No');
  sheet.insertRowBefore(2);
  sheet.getRange(2, 1, 1, MF_CONFIG.headers.length).setValues([prepared.values]);
  formatTopRow(sheet);
  processAlertForRow(sheet, 2, history, prepared, fundName);
}

/** Computes NAV percentile over the preceding CALENDAR year, excluding latest NAV. */
function oneYearPercentile(history, latestIndex) {
  const current = history[latestIndex];
  const startKey = calendarLookbackKey(current.key, 12);
  const navs = history.slice(0, latestIndex).filter(function(x) { return x.key >= startKey; })
    .map(function(x) { return x.nav; }).sort(function(a, b) { return a - b; });
  if (navs.length < 20) return { bottom5: false, top5: false };
  const p = MF_CONFIG.percentileThreshold / 100;
  const bottom = navs[Math.floor(p * navs.length)];
  const top = navs[Math.min(navs.length - 1, Math.floor((1 - p) * navs.length))];
  return { bottom5: current.nav <= bottom, top5: current.nav >= top };
}

function processAlertForRow(sheet, rowNumber, history, prepared, fundName) {
  const change1M = prepared.comparisons[0].diff;
  const monthMove = change1M !== null && Math.abs(change1M) >= MF_CONFIG.alertThreshold1M;
  const percentile = oneYearPercentile(history, history.length - 1);
  if (!monthMove && !percentile.bottom5 && !percentile.top5) return;
  const labels = [];
  if (monthMove) labels.push('1M');
  if (percentile.bottom5) labels.push('Bottom 5%');
  if (percentile.top5) labels.push('Top 5%');
  const status = 'Yes (' + labels.join(' + ') + ')';
  if (!MF_CONFIG.recipientEmail || MF_CONFIG.recipientEmail === 'CHANGE_ME@example.com') {
    console.warn('Skipping email for ' + fundName + ': configure recipientEmail in MF_CONFIG.');
    sheet.getRange(rowNumber, 15).setValue('Not sent (email not configured)');
    return;
  }
  const subject = 'MF NAV Alert: ' + fundName + ' — ' + labels.join(' & ');
  let body = fundName + '\nLatest NAV (' + prepared.current.date + '): ₹' + prepared.current.nav + '\n\n';
  prepared.comparisons.forEach(function(c) {
    body += c.label + ' target (' + dmyFromISO(c.target) + '): ' +
      (c.prior ? 'NAV on ' + c.prior.date + ' = ₹' + c.prior.nav + ' (' + c.diff + '%)' : 'N/A (fund has insufficient history)') + '\n';
  });
  if (percentile.bottom5) body += '\nNAV is in the bottom 5% of its preceding 1-year NAV range.\n';
  if (percentile.top5) body += '\nNAV is in the top 5% of its preceding 1-year NAV range.\n';
  try {
    MailApp.sendEmail(MF_CONFIG.recipientEmail, subject, body);
    sheet.getRange(rowNumber, 15).setValue(status);
  } catch (e) {
    sheet.getRange(rowNumber, 15).setValue('Email failed');
    console.error('Email failed for ' + fundName + ': ' + e.message);
  }
}

function formatFundSheet(sheet) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 15).setFontWeight('bold');
  const n = sheet.getLastRow() - 1;
  if (n > 0) {
    [2, 4, 7, 10, 13].forEach(function(c) { sheet.getRange(2, c, n, 1).setNumberFormat('0.0000'); });
    [5, 8, 11, 14].forEach(function(c) { sheet.getRange(2, c, n, 1).setNumberFormat('0.00'); });
  }
}

function formatTopRow(sheet) {
  sheet.getRange(2, 1, 1, 15).setVerticalAlignment('middle');
  [2, 4, 7, 10, 13].forEach(function(c) { sheet.getRange(2, c).setNumberFormat('0.0000'); });
  [5, 8, 11, 14].forEach(function(c) { sheet.getRange(2, c).setNumberFormat('0.00'); });
}
