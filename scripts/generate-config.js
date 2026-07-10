// 必要な部品を読み込む
// 共通処理
const { isFilled, toQuestionId } = require("./generators/utils");
// 経費タイプ生成
const { createExpenseTypes } = require("./generators/expenseTypes");
// 判定ルール生成
const { createRules } = require("./generators/rules");
// 質問生成
const { createQuestions } = require("./generators/questions");
const {
  getDataStartRowNumber,
  readSheet,
  readSheetMeta,
} = require("./generators/sheetReader");

// Excelとファイル操作用のライブラリを読み込む
// xlsx：Excelを読むため
// fs：config.jsonを書き出すため
const XLSX = require("xlsx");
const fs = require("fs");
const {
  validateExpenseTypes,
  validateRequiredFields,
  validateDuplicateExpenseTypeIds,
  validatePolicyReferences,
  validateCompanySettings,
  validateRequiredColumns,
} = require("./generators/validators");

// 複数企業対応
const companyId = process.argv[2] || "sample-company";
const workbook = XLSX.readFile(`excel/${companyId}.xlsx`);

// 必要なシートを読む
const companySheet = readSheet(workbook, "99_company_settings");
const policySheet = readSheet(workbook, "99_policies");
const expenseTypeSheet = readSheet(workbook, "99_expense_types");
const simpleRuleSheet = readSheet(workbook, "03_判定ルール");

const companyMeta = readSheetMeta(workbook, "99_company_settings");
const policyMeta = readSheetMeta(workbook, "99_policies");
const expenseTypeMeta = readSheetMeta(workbook, "99_expense_types");
const simpleRuleMeta = readSheetMeta(workbook, "03_判定ルール");

// 申請内容がある行だけ使う
const categoryRows = simpleRuleSheet.filter((row) => isFilled(row["申請内容"]));

// 条件列を自動判定する
const resultColumns = ["経費タイプ", "案内メッセージ", "注意事項"];

const conditionColumns = Object.keys(categoryRows[0] || {}).filter(
  (columnName) => !resultColumns.includes(columnName),
);

// 質問を作る
const questions = createQuestions(categoryRows, conditionColumns);

// 経費タイプを作る
const expenseTypes = createExpenseTypes(expenseTypeSheet);

// Excelのエラーチェック
const validationErrors = [
  ...validateRequiredColumns(
    companySheet,
    companyMeta,
    "99_company_settings",
    getDataStartRowNumber("99_company_settings"),
  ),
  ...validateRequiredColumns(
    categoryRows,
    simpleRuleMeta,
    "03_判定ルール",
    getDataStartRowNumber("03_判定ルール"),
  ),
  ...validateExpenseTypes(
    categoryRows,
    expenseTypes,
    getDataStartRowNumber("03_判定ルール"),
  ),
  ...validateDuplicateExpenseTypeIds(
    expenseTypeSheet,
    getDataStartRowNumber("99_expense_types"),
  ),
  ...validatePolicyReferences(
    expenseTypeSheet,
    policySheet,
    getDataStartRowNumber("99_expense_types"),
  ),
];

if (validationErrors.length > 0) {
  console.error("config.json の生成に失敗しました。");
  console.error("");

  validationErrors.forEach((error) => console.error(`❌ ${error}`));

  process.exit(1);
}

// ルールを作る
const rules = createRules(
  categoryRows,
  conditionColumns,
  expenseTypes,
  toQuestionId,
);

// config.json全体を組み立てる
const config = {
  company: companySheet[0],
  policies: policySheet,
  expenseTypes,
  questions,
  rules,
};

// 出力フォルダを作る
const outputDir = `rules/${companyId}`;

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// config.jsonを書き出す
fs.writeFileSync(
  `${outputDir}/config.json`,
  JSON.stringify(config, null, 2),
  "utf8",
);

console.log("config.json を生成しました！");
