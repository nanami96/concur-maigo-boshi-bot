const HEADER_ROW_NUMBER = 1;
const META_ROW_NUMBER = 2;

const DATA_START_ROW_BY_SHEET = {
  "99_company_settings": 3,
  "99_policies": 3,
  "99_expense_types": 3,
  "03_判定ルール": 3,
  "99_questions": 2,
  "99_options": 2,
  "99_rules": 2,
  // 新スキーマ（関係モデル）: ヘッダー行の次から即データ、メタ行なし
  "01_基本設定": 2,
  "02_ポリシー": 2,
  "03_経費タイプ": 2,
  "04_質問": 2,
  "05_選択肢": 2,
  "06_判定ルール": 2,
};

function getDataStartRowNumber(sheetName) {
  return DATA_START_ROW_BY_SHEET[sheetName] || 3;
}

function toObjects(rows, sheetName) {
  const headers = rows[HEADER_ROW_NUMBER - 1] || [];
  const startIndex = getDataStartRowNumber(sheetName) - 1;
  const dataRows = rows.slice(startIndex);

  return dataRows
    .filter((row) => row.some((cell) => String(cell).trim() !== ""))
    .map((row) => {
      const item = {};

      headers.forEach((header, index) => {
        item[header] = row[index];
      });

      return item;
    });
}

function toMeta(rows) {
  const headers = rows[HEADER_ROW_NUMBER - 1] || [];
  const metaRow = rows[META_ROW_NUMBER - 1] || [];
  const meta = {};

  headers.forEach((header, index) => {
    meta[header] = metaRow[index];
  });

  return meta;
}

function getSheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    return [];
  }

  return require("xlsx").utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });
}

function readSheet(workbook, sheetName) {
  return toObjects(getSheetRows(workbook, sheetName), sheetName);
}

function readSheetMeta(workbook, sheetName) {
  return toMeta(getSheetRows(workbook, sheetName));
}

module.exports = {
  DATA_START_ROW_BY_SHEET,
  getDataStartRowNumber,
  readSheet,
  readSheetMeta,
  toMeta,
  toObjects,
};
