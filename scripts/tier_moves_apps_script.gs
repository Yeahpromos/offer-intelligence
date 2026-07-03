const OVERRIDES_SHEET_NAME = 'Tier Overrides';
const HEADERS = [
  'Key',
  'Merchant ID',
  'Merchant Name',
  'Source Tier',
  'Target Tier',
  'Moved At',
  'Updated At',
  'Updated By',
  'Active'
];

function configuredSecret_() {
  return String(PropertiesService.getScriptProperties().getProperty('TIER_MOVES_WEBHOOK_SECRET') || '').trim();
}

function assertSecret_(payload) {
  const expected = configuredSecret_();
  if (!expected) return;
  const actual = String((payload && payload.secret) || '').trim();
  if (actual !== expected) {
    throw new Error('Invalid tier move secret');
  }
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  const spreadsheetId = String(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();
  const spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(OVERRIDES_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(OVERRIDES_SHEET_NAME);
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (current.join('\t') !== HEADERS.join('\t')) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  return sheet;
}

function rowToMove_(row) {
  return {
    key: String(row[0] || ''),
    merchantId: String(row[1] || ''),
    merchantName: String(row[2] || ''),
    sourceTier: String(row[3] || ''),
    targetTier: String(row[4] || ''),
    movedAt: String(row[5] || ''),
    updatedAt: String(row[6] || ''),
    updatedBy: String(row[7] || '')
  };
}

function activeMoves_() {
  const sheet = sheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet
    .getRange(2, 1, lastRow - 1, HEADERS.length)
    .getValues()
    .filter((row) => String(row[8] || 'TRUE').toUpperCase() !== 'FALSE')
    .map(rowToMove_)
    .filter((move) => move.key || move.merchantId);
}

function replaceMoves_(payload) {
  const sheet = sheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, HEADERS.length).clearContent();
  }
  const updatedAt = payload.updatedAt || new Date().toISOString();
  const updatedBy = payload.updatedBy || 'offer-intelligence-ui';
  const rows = (payload.moves || []).map((move) => [
    move.key || '',
    move.merchantId || '',
    move.merchantName || '',
    move.sourceTier || '',
    move.targetTier || '',
    move.movedAt || '',
    updatedAt,
    updatedBy,
    'TRUE'
  ]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  }
  return activeMoves_();
}

function doGet(e) {
  try {
    assertSecret_(e && e.parameter);
    return json_({ ok: true, configured: true, moves: activeMoves_() });
  } catch (error) {
    return json_({ ok: false, configured: true, error: String(error && error.message || error) });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    assertSecret_(payload);
    const action = String(payload.action || 'replace').toLowerCase();
    const moves = action === 'clear' ? replaceMoves_({ ...payload, moves: [] }) : replaceMoves_(payload);
    return json_({ ok: true, configured: true, action, moves });
  } catch (error) {
    return json_({ ok: false, configured: true, error: String(error && error.message || error) });
  }
}
