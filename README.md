# MF NAV Monitor
A project that helps you track NAV for the mutual funds in India.
Like stocks, you can track 52-week highs and lows of the MF scheme for optimizing your investment decisions.

# Mutual Fund NAV Monitor (Google Sheets + Apps Script)

A configurable, free-to-run **Indian mutual fund NAV monitor** that stores scheme-wise historical NAVs in Google Sheets, compares NAVs over **1 month (1M), 3 months (3M), 6 months (6M), and 1 year (1-Yr)**, and optionally emails alerts. **Intended for personal monitoring, not investment advice**.

It reads historical scheme NAVs from the public [MFAPI](https://www.mfapi.in/) service (`https://api.mfapi.in/mf/<scheme-code>`). It does **not** create, maintain or modify Dashboard or Index tabs; this README includes step-by-step instructions to build them, add conditional formatting and configure Gmail inbox delivery.

## Features

- One Google Sheets tab for each configured mutual fund.
- **First run:** download available historical NAV records and populate comparison columns for every historical NAV date, newest first.
- Accepts MFAPI dates in its standard **DD-MM-YYYY** format (and optional **DD/MM/YYYY** input); dates are displayed as **DD/MM/YYYY** text in Google Sheets.
- **Later runs:** insert only the newest NAV observation **if its date is not already in the sheet**. No duplicate rows on Sundays or exchange holidays, even if the time-based trigger runs.
- Calendar-based lookbacks, **not** fixed trading-day offsets: 1M, 3M, 6M, 1-Yr.
- When the target date has no NAV (weekend/market holiday), use the **latest published NAV on or before that target date**. This may be a few days earlier; the sheet displays the **actual date used**.
- If the fund did not exist yet and no prior NAV is available, show `N/A` in the three comparison fields rather than leaving them blank. Future NAVs are never substituted for missing historical data.
- Email alerts for an absolute **1M NAV change >= 5%** or a NAV in the **bottom/top 5% of its preceding calendar year's published NAVs**. Both thresholds are configurable.
- Script lock reduces overlapping runs. Individual fund errors are logged without stopping other funds.

### Sheet columns

| Column(s) | Content |
|---|---|
| A–B | Latest Date, Latest NAV |
| C–E | 1M Prior Date, 1M Prior NAV, % Difference (1M) |
| F–H | 3M Prior Date, 3M Prior NAV, % Difference (3M) |
| I–K | 6M Prior Date, 6M Prior NAV, % Difference (6M) |
| L–N | 1-Yr Prior Date, 1-Yr Prior NAV, % Difference (1-Yr) |
| O | Email Alert Sent? |

Percentage change is **`((latest NAV / prior NAV) - 1) × 100`**, rounded to two decimals. This is a **NAV price change**, not an investor's XIRR and not necessarily the total-return performance reported by third-party fund tools (e.g., differences may arise from IDCW distributions, valuation timestamps or data vendors).

### Example: calendar lookback

If the latest NAV observation is **23 Oct 2026**:

- 1M target is **23 Sep 2026**.
- 3M target is **23 Jul 2026**.
- 6M target is **23 Apr 2026**.
- 1-Yr target is **23 Oct 2025**.

If NAV wasn't published on a target date, the script picks the newest published NAV **on or before** it (not after it). For month-ends that don't exist in the target month, the target is clamped to that month's last calendar day (e.g. **31 Mar → 28 Feb**, or 29 Feb in a leap year). The actual selected NAV date is always shown in the `Prior Date` column.

## Requirements

- A Google account and access to **Google Sheets** and **Apps Script**.
- Network access from Apps Script to the third-party MFAPI endpoint.
- Permission to edit your spreadsheet and, if enabled, send mail as your Google account.
- Available Apps Script / Google Sheets daily quotas and execution time. For many funds with long histories, the first backfill may be slow; retry failed funds or reduce the configured fund list temporarily.

## Quick start: install and run

1. Create a new Google Sheet at [sheets.google.com](https://sheets.google.com), or use a **backup copy** of an existing monitor.
2. In the sheet, open **Extensions → Apps Script**. This makes a *spreadsheet-bound* Apps Script project.
3. Open the script editor (usually `Code.gs`). Replace its contents with everything from **[`MF_NAV_Monitor.gs`](MF_NAV_Monitor.gs)**. The `.gs` extension is for GitHub; pasting its contents into `Code.gs` is sufficient. Do not paste another duplicate set of functions.
4. Modify the `MF_CONFIG` configuration near the top. **Set `recipientEmail` to your own email address**. You may leave the placeholder if you want to suppress outgoing emails, but qualifying rows will show `Not sent (email not configured)`.
5. **Important for upgrades from the old 30/90/180-day format:** back up your workbook, then **delete just the old individual fund tabs** listed in `MF_CONFIG.funds`, or rename them. Do not delete your separate Dashboard/Index tabs if you wish to keep them. The new script intentionally rejects old column layouts instead of silently overwriting them.
6. Save. In the Apps Script function selector, choose **`monitorMutualFundsWithBackfill`** and click **Run**. Approve the requested permissions.
7. Inspect the newly populated individual fund sheets. For a test fund, check the latest NAV date, the prior **actual** NAV date, and the corresponding calculation. Open **Executions** in Apps Script if a fund failed.
8. Set up a schedule using **Triggers (clock icon) → Add Trigger**:
   - Function: `monitorMutualFundsWithBackfill`
   - Event source: **Time-driven**
   - Type: **Day timer**
   - Select an evening time window in **Asia/Kolkata** after NAV data normally becomes available. Google's timer is not guaranteed to fire at an exact minute.
   - In **Project Settings**, set timezone to **Asia/Kolkata** if applicable.
9. **Do not add a second daily trigger** if you already have one pointing to the same function.
10. Optional: follow [Build the Index sheet](#build-the-index-sheet-manually-scheme-code-reference), [Build the Dashboard](#build-the-dashboard-sheet-manually), [Conditional formatting](#conditional-formatting-dashboard-and-individual-fund-tabs), and [Email deliverability](#ensure-email-alerts-dont-end-up-in-spam-gmail) instructions below.

You do **not** need to deploy this as a web app or publish it. A bound script and a time-driven trigger are enough. If sharing the GitHub repository, share these source files; each friend installs their own bound script and authorizes it under their own Google account. No shared login or API key is required by this example.

## Personalize your fund list

Edit the `funds` array in `MF_CONFIG`:

```javascript
funds: [
  { name: 'My Flexi Cap', code: '122639' },
  { name: 'My Midcap', code: '118834' }
],
```

- `name` becomes the Google Sheets tab name; keep it unique, under Google Sheets' tab-name limit, and avoid invalid sheet-name characters. Choose names that don't collide with your manual Dashboard/Index tabs.
- `code` is the **MFAPI scheme code**, **not** the AMC's fund code or an ISIN. Search for your plan in the [MFAPI directory](https://www.mfapi.in/) or check the [MFAPI API](https://api.mfapi.in/mf) and verify the correct **Direct/Regular** and **Growth/IDCW** plan before using it.
- Adding a fund: add one entry, save and run. Its new tab will be backfilled automatically.
- Removing a fund: remove it from the array. The tab is **not deleted** automatically.
- Renaming an entry: a new tab will be created; old tabs are left as-is. Delete/rename the old tab manually as appropriate.

### Configurable settings

```javascript
recipientEmail: 'you@example.com',
alertThreshold1M: 5,
percentileThreshold: 5,
sendAlertsOnInitialBackfill: false,
missingValue: 'N/A'
```

- `alertThreshold1M`: send an alert if the absolute **1-month** NAV change reaches or exceeds this percentage.
- `percentileThreshold`: by default, compare the latest NAV against the fifth and ninety-fifth percentiles of all published observations in the **preceding calendar year** (excluding latest). At least 20 earlier observations are needed.
- `sendAlertsOnInitialBackfill: false`: **recommended**; first-time historical loading never emails, even if today's NAV crosses a threshold. Set `true` if you want the most recent backfilled NAV to be evaluated and emailed.
- `missingValue`: substitute text for comparisons that predate the fund's inception. Leave as `N/A` if your dashboard may need to distinguish insufficient history from a zero return.

**Alert status semantics:** `No` means no alert was sent for that row (including historical rows). `Yes (...)` means the script successfully submitted an email. `Not sent (email not configured)` or `Email failed` means it didn't send successfully. The script doesn't automatically resend for an existing latest NAV date; inspect logs and fix settings if necessary.

## Weekends, market holidays and duplicates

There is **no need to maintain a stock-exchange holiday calendar**. On Sunday, holidays, or days when MFAPI has not yet published a new observation, the latest API NAV date will normally match an existing date in column A, and the program skips inserting it. If the API returns an older observation than the sheet's latest date, that observation is also skipped. This is more reliable than simply skipping weekends because a weekday can also have no new NAV.

Note: the script takes **only the newest API NAV entry per run** once the sheet exists. If the trigger is disabled for several NAV-publishing days, intermediate dates will **not** automatically be inserted on restart; for a full rebuild, delete that fund's tab and run again. See the next section for limitations.

## Build the `Index` sheet manually (scheme-code reference)

The monitor **does not create `Index` or `Dashboard`**. These are optional Google Sheets tabs you create yourself after the fund tabs have been populated. You do **not** need to add more Apps Script code for the steps below. The script's fund list remains in `MF_CONFIG.funds`; the Index is a human-readable reference and does **not** configure the monitor automatically.

### 1. Add source links

1. Click **+** at the bottom of the spreadsheet to create a tab; rename it **`Index`** (exact spelling).
2. Enter the following labels and links:

   | Cell | Value |
   |---|---|
   | A1 | `NAV source / documentation` |
   | B1 | `https://www.mfapi.in/docs/` |
   | A2 | `Search and verify schemes` |
   | B2 | `https://www.mfapi.in/` |
   | A3 | `Scheme directory (JSON)` |
   | B3 | `https://api.mfapi.in/mf` |

3. In **A5:D5**, enter these headers: `Scheme code` · `Fund tab name` · `Scheme label (verify exact plan)` · `NAV history link`.
4. Paste the following **tab-separated** block into **A6** (it fills columns A–C). These are the *configured fund labels and codes* from the provided script, not a claim that every scheme's official API name has been independently verified:

```tsv
122639	PPFAS Flexicap	Parag Parikh Flexi Cap
118834	Mirae Lrg-n-Midcp	Mirae Large & Midcap
125497	SBI Smallcp	SBI Small Cap
120503	Axis ELSS	Axis ELSS
153244	Axis Nifty500Mom50	Axis Nifty 500 Momentum 50
151739	UTI Nifty500V50	UTI Nifty 500 Value 50
140228	Edelweiss MidCp	Edelweiss Mid Cap
120596	ICICI Lrg-n-Midcp	ICICI Large & Midcap
147946	Bandhan small cap	Bandhan Small Cap
120685	ICICI Pru Gold	ICICI Prudential Gold
153474	Nippon Nifty500 Lv50	Nippon Nifty 500 Low Volatility 50
```

5. In **D6**, enter the link formula below and fill it down through **D16** (and further when you add funds):

```gs
=IF(A6="","",HYPERLINK("https://api.mfapi.in/mf/"&A6,"NAV history / verify plan"))
```

6. Open the API link for each scheme and inspect `meta.scheme_name` to verify **Direct vs Regular** and **Growth vs IDCW**. Scheme codes are **MFAPI codes**, not ISINs. Correct the code in **both** this Index and `MF_CONFIG.funds` if necessary. Editing Index alone will **not** change what the script fetches.

7. Format the header row in bold, freeze through row 5 (**View → Freeze → Up to row 5**), and optionally apply **Data → Create a filter** to row 5 onwards. Keep column **B below row 5** reserved for fund tab names: the dashboard formulas below read it automatically.

Reference: [MFAPI API documentation](https://www.mfapi.in/docs/) (scheme search and NAV history endpoints).

## Build the `Dashboard` sheet manually

This creates **two views in one tab**: a current cross-fund performance summary and, optionally, a day-by-day NAV matrix similar to the original workbook. It works with the **1M / 3M / 6M / 1-Yr** script, whose fund columns are **A:O**. The script itself never edits the Dashboard.

### 2A. Current comparison summary (recommended)

1. Create another tab and name it **`Dashboard`**.
2. In **A1:I1**, paste the following headers:

   | A | B | C | D | E | F | G | H | I |
   |---|---|---|---|---|---|---|---|---|
   | Fund tab | Latest NAV date | Latest NAV | 1M % | 3M % | 6M % | 1-Yr % | Email alert | NAV age (days) |

3. In **A2**, enter this single formula; it will *spill* the Index fund-tab names downward. Do **not** type in the cells below A2 where the formula needs to expand.

```gs
=IFERROR(FILTER(Index!B6:B,Index!B6:B<>""),"")
```

4. Put these formulas into the indicated **row 2** cells, then copy **B2:I2** down as far as needed (at least 11 rows for the supplied configuration). They dynamically point to the tabs named in column A:

| Cell | Formula |
|---|---|
| **B2 — NAV date** | `=IF($A2="","",IFERROR(INDIRECT("'"&$A2&"'!A2"),"N/A"))` |
| **C2 — NAV** | `=IF($A2="","",IFERROR(INDIRECT("'"&$A2&"'!B2"),"N/A"))` |
| **D2 — 1M** | `=IF($A2="","",IFERROR(INDIRECT("'"&$A2&"'!E2"),"N/A"))` |
| **E2 — 3M** | `=IF($A2="","",IFERROR(INDIRECT("'"&$A2&"'!H2"),"N/A"))` |
| **F2 — 6M** | `=IF($A2="","",IFERROR(INDIRECT("'"&$A2&"'!K2"),"N/A"))` |
| **G2 — 1-Yr** | `=IF($A2="","",IFERROR(INDIRECT("'"&$A2&"'!N2"),"N/A"))` |
| **H2 — Alert** | `=IF($A2="","",IFERROR(INDIRECT("'"&$A2&"'!O2"),"N/A"))` |
| **I2 — Age** | `=IF($A2="","",IFERROR(TODAY()-IF(ISNUMBER(B2),INT(B2),DATE(VALUE(RIGHT(B2,4)),VALUE(MID(B2,4,2)),VALUE(LEFT(B2,2)))),"N/A"))` |

5. **Important:** The script records return figures as numbers such as **`5.25` for 5.25%**, not `0.0525`. Format **D:G** as `0.00` or choose **Format → Number → Custom number format → `0.00"%"`** to show a percent symbol. **Do not use the standard Percent format**, which would incorrectly display 5.25 as 525%.
6. Format NAVs in **C** to four decimals (`0.0000`), and the age in **I** to a whole number. Apply bold headers, freeze row 1, and optionally turn on a filter.

When a new fund is added, update `MF_CONFIG.funds` **and** append its record to the Index; the Dashboard fund-name list updates from Index automatically. Copy formulas in columns **B:I** down to the new row.

### 2B. Optional daily NAV-history matrix (like the original Dashboard)

In the **same `Dashboard` tab**, start the historical view below the current summary:

1. Enter `Date` in **A17**. In **B17**, enter the following and fill it right across the number of funds you track (e.g., **B17:L17** for 11 funds). It reads names from the Index:

```gs
=IFERROR(INDEX(FILTER(Index!$B$6:$B,Index!$B$6:$B<>""),COLUMN()-1),"")
```

2. In **A18**, enter `=TODAY()`; in **A19**, enter `=A18-1`, then fill down (for example, through A108 for approximately 90 days). Format column A as a **Date**.
3. In **B18**, use this formula, fill **right** to the other fund columns and **down** for your daily history:

```gs
=IF(B$17="","",IFERROR(LET(
  navDates,INDIRECT("'"&B$17&"'!$A$2:$A$5000"),
  navValues,INDIRECT("'"&B$17&"'!$B$2:$B$5000"),
  actualDates,ARRAYFORMULA(IFERROR(IF(ISNUMBER(navDates),INT(navDates),
    DATE(VALUE(RIGHT(navDates,4)),VALUE(MID(navDates,4,2)),VALUE(LEFT(navDates,2)))),0)),
  INDEX(navValues,MATCH(1,ARRAYFORMULA((actualDates>0)*(actualDates<=$A18)),0))
),"N/A"))
```

**Why this formula is different from the old Dashboard:** the script's column A may contain **`DD/MM/YYYY` text**, not true Google Sheets date values. The formula converts text to dates, works if values are already date-typed, and selects the **most recent NAV on or before each Dashboard day**. It therefore repeats Friday's NAV on Saturday/Sunday, as intended, and shows `N/A` before the fund's first NAV. Fund tabs are sorted **newest first**, which makes the first matching observation the correct one.

**Performance:** cross-sheet date conversion is relatively expensive. Start with **30–90 rows of history**; if the file becomes slow, shorten the history or reduce the `$5000` lookback range (provided it still covers the dates you need). This is a read-only Dashboard formula, not a replacement for the production script.

**Optional visualization:** select the date column plus **one** fund's NAV column (for example A17:B108), then **Insert → Chart → Line chart**. Each fund has a different NAV base, so a chart comparing raw NAV levels across funds is *not* a meaningful comparison of investment performance. Use the 1M/3M/6M/1-Yr columns for cross-fund changes instead.

## Conditional formatting: Dashboard and individual fund tabs

Google Sheets procedure: select a range → **Format → Conditional formatting** → choose **Single color** → set **Format cells if** to a number condition or **Custom formula is** → set fill/font colors → **Done**. See [Google's formatting guide](https://support.google.com/docs/answer/78413).

### 3A. Dashboard — current comparison (D:G)

Select **D2:G** in `Dashboard`. Add these two rules:

| Rule | Test | Suggested appearance |
|---|---|---|
| Positive return | **Greater than** `0` | Pale green background, dark green text |
| Negative return | **Less than** `0` | Pale red background, dark red text |

`N/A`, empty cells, and zero values remain uncolored. If you'd like to flag large monthly drops, add **D2:D** → **Custom formula is** → `=AND(ISNUMBER(D2),D2<=-5)` and use a stronger red. This matches the default **absolute 1M move >= 5%** alert threshold but highlights **drops only**.

For email status, apply to **H2:H**:

- **Custom formula:** `=LEFT(TO_TEXT($H2),3)="Yes"` → light yellow or green (alert sent).
- **Custom formula:** `=OR($H2="Email failed",LEFT(TO_TEXT($H2),8)="Not sent")` → red (delivery/configuration problem).

To flag possibly stale data, apply to **I2:I**: **Custom formula** `=AND(ISNUMBER($I2),$I2>=4)` → light orange. Calendar age is an **indicator**, not proof of an API issue: long holiday closures can trigger it.

### 3B. Individual fund tabs — all historical rows

Use the column names produced by this script (not the older 30/90/180-day arrangement):

| Field | Column |
|---|---|
| 1M % | **E** |
| 3M % | **H** |
| 6M % | **K** |
| 1-Yr % | **N** |
| Email status | **O** |

For **each** of the ranges **E2:E, H2:H, K2:K, N2:N**, add **Greater than `0`** (green) and **Less than `0`** (red). To highlight larger moves, add a rule for values **less than or equal to `-5`** (strong red), and/or **greater than or equal to `5`** (strong green). If overlapping styles conflict, use nonoverlapping custom-formula conditions or order your rules explicitly.

On **O2:O**, add the same two email-status custom-formula rules using **`$O2`** rather than `$H2`.

**Practical tips:** Apply rules to **entire data columns starting at row 2**, not just existing rows (for example, `E2:E`), since each newly published NAV is inserted at row 2. The script sets the new row's number format to `0.00`, so if you manually added a `%` suffix to existing individual-fund cells, check whether the suffix persists on new rows; the header already indicates `% Difference` and the underlying values should **not** be multiplied by 100. You can copy conditional formatting to other fund tabs with **Paste special → Conditional formatting only**, then check that relative-column references are correct.

### 3C. Optional daily-matrix NAV movement highlighting

If you built the historical matrix from **2B**, apply these rules to **B18:L107** (or the actual range). They compare each calendar day with the day immediately below it:

- **Green, NAV up:** `=AND(ISNUMBER(B18),ISNUMBER(B19),B18>B19)`
- **Red, NAV down:** `=AND(ISNUMBER(B18),ISNUMBER(B19),B18<B19)`

Repeated NAVs on weekends/holidays remain uncolored. This is **day-to-day NAV movement**, not the 1M/3M/6M/1-Yr return calculation. Don't apply the same color scale across different funds' absolute NAV levels.

## Ensure email alerts don't end up in Spam (Gmail)

The code uses **`MailApp.sendEmail()`**. Typically, alerts are sent from the **Google account that authorized/runs the Apps Script**, to the address in `MF_CONFIG.recipientEmail`. That means if you send alerts to yourself, your **sender and recipient may be the same address**; check the **From** field of one actual alert before configuring a filter.

### 4A. Create a Gmail filter (recommended)

1. Sign in to **[Gmail](https://mail.google.com/)** with the **recipient** account on a desktop browser.
2. In the search bar, click the **Show search options** sliders icon.
3. Set **From** to the actual sender address from an alert (usually the script-owning Google account). Set **Subject** to `MF NAV Alert:` — this is the exact prefix used by this script. Combining sender + subject avoids trusting unrelated messages from the same address.
4. Click **Create filter**.
5. Tick **Never send it to Spam**. Optionally tick **Always mark it as important**, and choose **Apply the label → New label → `MF NAV Alerts`**. Click **Create filter** again to save.
6. If an alert already went to **Spam**, select it and click **Not spam**. Optionally add the sender to [Google Contacts](https://contacts.google.com/) as an extra safeguard.

Google's official instructions: [Create Gmail filters](https://support.google.com/mail/answer/6579) and [Fix legitimate messages in Spam](https://support.google.com/mail/answer/16457426).

### 4B. Test and troubleshoot delivery

- **First historical backfill:** `sendAlertsOnInitialBackfill: false` means the monitor intentionally sends **no emails** on first creation of a fund tab. A lack of emails at this stage is expected.
- **Later runs:** an email is attempted only for a *new* NAV date meeting the 1M threshold or top/bottom 5% condition. A duplicate date is skipped and **does not trigger another email**.
- Check **Apps Script → Executions** for `Email failed` or other errors and check the new fund row's **column O**:
  - `Yes (...)` = Google accepted the send request; **not** proof it reached the Inbox.
  - `Not sent (email not configured)` = set `MF_CONFIG.recipientEmail` to a real address and save.
  - `Email failed` = inspect execution logs, permissions and Google email-sending quotas.
  - `No` = no alert was sent for that row (including historical backfill).
- Search Gmail **Inbox, All Mail, and Spam** for subject `MF NAV Alert:`. If sender and recipient are the same Gmail account, a matching email may appear in an existing conversation or under **All Mail**, rather than as a new obvious Inbox item.
- To **test only the Gmail filter**, manually send a sample message from the same sender to the recipient with subject `MF NAV Alert: Test` and verify the label/inbox behavior. This doesn't test the threshold-detection code.
- Gmail filters reduce accidental Spam classification but **cannot guarantee delivery**, especially to non-Gmail inboxes or addresses with organization-level mail rules. Do not attempt to bypass institutional spam/security controls; use the recipient organization's allowlist process if needed.


## Troubleshooting

| Symptom | What to check |
|---|---|
| `No valid NAV records` | Update to the corrected script: MFAPI uses **DD-MM-YYYY** dates. If the problem persists, inspect **Executions**; the new error includes the API record count and a sample rejected record. Also verify the scheme code and MFAPI response. |
| Old fund tab is rejected | Its header still uses the old 30/90/180 layout; back up, delete or rename that old tab, and rerun |
| No row inserted on a Sunday/holiday | Expected: latest source NAV date is already in column A |
| No row inserted on an ordinary weekday | Source may not have published a new NAV yet; check API and retry later |
| `N/A` in comparisons | That historical NAV predates the fund's 1M/3M/6M/1-Yr history; no valid earlier NAV exists |
| Unexpected comparison date | The target fell on a closure or nonexistent month-day; the actual NAV date used is shown |
| No email | Check `recipientEmail`, alert thresholds, project permissions and Apps Script **Executions** |
| First run times out | Google Apps Script has execution limits; temporarily split funds into smaller groups, run and then restore full list |
| Dashboard shows `#REF!` | Confirm exact tab names in `Index!B6:B`, confirm those individual tabs exist, and check for blocked spilled formulas in `Dashboard!A2:A` |

## Privacy, security and limitations

- Do **not** commit personal email addresses, account details, credentials or proprietary fund information to a public GitHub repository. The shared example defaults to `CHANGE_ME@example.com` intentionally.
- The third-party MFAPI service is not guaranteed to be available, current or complete. Verify NAVs with your AMC/AMFI for financial decisions; this code does not provide a market-holiday calendar.
- Calculations use published NAV observations; they do not account for investment cash flows, exit loads, taxes or investor-specific XIRR.
- Trigger execution and email delivery are subject to Google Apps Script quotas and authorization.
- MFAPI uses **DD-MM-YYYY** in responses; the script accepts both `DD-MM-YYYY` and `DD/MM/YYYY` while writing **DD/MM/YYYY strings** to Google Sheets to avoid locale conversion surprises. Comparison NAVs are numeric, with `N/A` where a comparison cannot be computed.
- A time-driven trigger may run multiple times per day, but duplicate-date protection prevents inserting the **same source NAV date twice**.

## Files

```text
MF_NAV_Monitor.gs  # Paste into spreadsheet-bound Google Apps Script
README.md          # This documentation
```

## Disclaimer

Unofficial personal-use project. Not affiliated with Google, MFAPI, AMFI or any mutual fund company. This is informational software, not a recommendation to buy or sell mutual funds.
