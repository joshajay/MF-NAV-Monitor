function monitorMutualFundsWithBackfill() {
  const funds = [
    { name: "PPFAS Flexicap", code: "122639" },
    { name: "Mirae Lrg-n-Midcp", code: "118834" },
    { name: "SBI Smallcp", code: "125497" },
    { name: "Axis ELSS", code: "120503" },
    { name: "Axis Nifty500Mom50", code: "153244" },
    { name: "UTI Nifty500V50", code: "151739" },
    { name: "Edelweiss MidCp", code: "140228" },
    { name: "ICICI Lrg-n-Midcp", code: "120596" },
    { name: "Bandhan small cap", code: "147946" },
    { name: "ICICI Pru Gold", code: "120685" },
    { name: "Nippon Nifty500 Lv50", code: "153474" },
  ];

  const threshold = 5; // % change threshold for 30d alert
  const recipientEmail = "joshi.ajay@gmail.com";

  funds.forEach(fund => {
    let sheet = getOrCreateSheet(fund.name);
    let navHistory = fetchNAVHistory(fund.code); // oldest → latest

    if (sheet.getLastRow() <= 1) {
      backfillNAVHistory(sheet, navHistory, threshold, recipientEmail, fund.name);
    } else {
      insertLatestNAV(sheet, navHistory, threshold, recipientEmail, fund.name);
    }
  });
}

function getOrCreateSheet(sheetName) {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow([
      "Latest Date", "Latest NAV",
      "30-Day Prior Date", "30-Day Prior NAV", "% Difference (30d)",
      "90-Day Prior Date", "90-Day Prior NAV", "% Difference (90d)",
      "180-Day Prior Date", "180-Day Prior NAV", "% Difference (180d)",
      "Email Alert Sent?"
    ]);
  }
  return sheet;
}

function fetchNAVHistory(code) {
  let url = `https://api.mfapi.in/mf/${code}`;
  let response = UrlFetchApp.fetch(url);
  let data = JSON.parse(response.getContentText());

  return data.data.map(e => ({
    date: e.date,
    nav: parseFloat(e.nav)
  })).reverse(); // oldest → latest
}

function findPriorNAV(navHistory, index, daysAgo) {
  let target = index - daysAgo;
  if (target < 0) return { date: "", nav: NaN };
  return navHistory[target];
}

function insertLatestNAV(sheet, navHistory, threshold, email, fundName) {
  let i = navHistory.length - 1;

  let latest = navHistory[i];
  let prior30 = findPriorNAV(navHistory, i, 21);
  let prior90 = findPriorNAV(navHistory, i, 63);
  let prior180 = findPriorNAV(navHistory, i, 125);

  let diff30 = calcDiff(latest.nav, prior30.nav);
  let diff90 = calcDiff(latest.nav, prior90.nav);
  let diff180 = calcDiff(latest.nav, prior180.nav);

  let is30dAlert = Math.abs(diff30) >= threshold;
 // let is1YearLow = checkOneYearLow(navHistory, i);
  let percentile = checkOneYearPercentile(navHistory, i);
  let alertLabel = buildAlertLabel(is30dAlert, percentile);

  if (is30dAlert || percentile.bottom5 || percentile.top5) {
    sendAlertEmail(
      email, fundName, latest, prior30, diff30,
      prior90, diff90, prior180, diff180, percentile
    );
}


  sheet.insertRowBefore(2);
  sheet.getRange(2, 1, 1, 12).setValues([[
    latest.date, latest.nav,
    prior30.date, prior30.nav, diff30,
    prior90.date, prior90.nav, diff90,
    prior180.date, prior180.nav, diff180,
    alertLabel
  ]]);
}

function backfillNAVHistory(sheet, navHistory, threshold, email, fundName) {
  let rows = [];

  for (let i = navHistory.length - 1; i >= 0; i--) {
    if (i - 180 < 0) continue;

    let latest = navHistory[i];
    let prior30 = findPriorNAV(navHistory, i, 21);
    let prior90 = findPriorNAV(navHistory, i, 63);
    let prior180 = findPriorNAV(navHistory, i, 125);

    let diff30 = calcDiff(latest.nav, prior30.nav);
    let diff90 = calcDiff(latest.nav, prior90.nav);
    let diff180 = calcDiff(latest.nav, prior180.nav);

    let isLatestRow = i === navHistory.length - 1;
    let is30dAlert = isLatestRow && Math.abs(diff30) >= threshold;
    //let is1YearLow = isLatestRow && checkOneYearLow(navHistory, i);
    let percentile = isLatestRow ? checkOneYearPercentile(navHistory, i) : { bottom5:false, top5:false };
    let alertLabel = buildAlertLabel(is30dAlert, percentile);

    if (isLatestRow && (is30dAlert || percentile.bottom5 || percentile.top5)) {
      sendAlertEmail(
        email, fundName, latest, prior30, diff30,
        prior90, diff90, prior180, diff180, percentile
    );

    }

    rows.push([
      latest.date, latest.nav,
      prior30.date, prior30.nav, diff30,
      prior90.date, prior90.nav, diff90,
      prior180.date, prior180.nav, diff180,
      alertLabel
    ]);
  }

  sheet.getRange(2, 1, rows.length, 12).setValues(rows);
}


function checkOneYearPercentile(navHistory, latestIndex) {
  const lookback = 260;
  const start = Math.max(0, latestIndex - lookback);

  let navs = [];
  for (let i = start; i < latestIndex; i++) {
    navs.push(navHistory[i].nav);
  }

  navs.sort((a, b) => a - b);

  if (navs.length < 20) return { bottom5: false, top5: false };

  let p5Index = Math.floor(0.05 * navs.length);
  let p95Index = Math.floor(0.95 * navs.length);

  let p5 = navs[p5Index];
  let p95 = navs[p95Index];

  let latestNAV = navHistory[latestIndex].nav;

  return {
    bottom5: latestNAV <= p5,
    top5: latestNAV >= p95
  };
}


function buildAlertLabel(is30d, percentile) {
  if (is30d && percentile.bottom5) return "Yes (30d + Bottom 5%)";
  if (is30d && percentile.top5) return "Yes (30d + Top 5%)";
  if (percentile.bottom5) return "Yes (Bottom 5%)";
  if (percentile.top5) return "Yes (Top 5%)";
  if (is30d) return "Yes (30d)";
  return "No";
}


function calcDiff(latest, prior) {
  if (!prior || isNaN(prior)) return "";
  return parseFloat((((latest - prior) / prior) * 100).toFixed(2));
}

//function sendAlertEmail(email, fundName, latest, prior30, diff30, prior90, diff90, prior180, diff180, is1YearLow) {
function sendAlertEmail(email, fundName, latest, prior30, diff30, prior90, diff90, prior180, diff180, percentile) {

  let subjectParts = [];
    if (percentile.bottom5) subjectParts.push("⚠️ Bottom 5%");
    if (percentile.top5) subjectParts.push("⚠️ Top 5%");
    if (Math.abs(diff30) >= 5) subjectParts.push("30-Day Move");


  let subject = `Alert: ${fundName} – ${subjectParts.join(" & ")}`;

let body =
  `${fundName} Alert\n\n` +
  `Latest NAV (${latest.date}): ₹${latest.nav}\n\n` +
  `30-Day NAV (${prior30.date}): ₹${prior30.nav} (${diff30}%)\n` +
  `90-Day NAV (${prior90.date}): ₹${prior90.nav} (${diff90}%)\n` +
  `180-Day NAV (${prior180.date}): ₹${prior180.nav} (${diff180}%)\n`;
  if (percentile.bottom5) {
    body += "\n⚠️ NAV is in the bottom 5% of the last 1 year.";
  }

  if (percentile.top5) {
    body += "\n⚠️ NAV is in the top 5% of the last 1 year.";
  }


    //(is1YearLow ? "⚠️ Latest NAV is around the lowest in the last 1 year.\n" : "");

  MailApp.sendEmail(email, subject, body);
}
