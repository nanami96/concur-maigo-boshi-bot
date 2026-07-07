// 必要な部品を読み込む
// 共通処理
const { isFilled, toQuestionId } = require("./generators/utils");
// 経費タイプ生成
const { createExpenseTypes } = require("./generators/expenseTypes");
// 判定ルール生成
const { createRules } = require("./generators/rules");
// 質問生成
const { createQuestions } = require("./generators/questions");

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
} = require("./generators/validators");

// 複数企業対応
const companyId = process.argv[2] || "sample-company";
const workbook = XLSX.readFile(`excel/${companyId}.xlsx`);

// ExcelシートをJSON配列に変換する
function readSheet(name) {
  return XLSX.utils.sheet_to_json(workbook.Sheets[name] || {});
}

// 必要なシートを読む
const companySheet = readSheet("99_company_settings");
const policySheet = readSheet("99_policies");
const expenseTypeSheet = readSheet("99_expense_types");
const simpleRuleSheet = readSheet("03_判定ルール");

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
  ...validateCompanySettings(companySheet),
  ...validateRequiredFields(categoryRows),
  ...validateExpenseTypes(categoryRows, expenseTypes),
  ...validateDuplicateExpenseTypeIds(expenseTypeSheet),
  ...validatePolicyReferences(expenseTypeSheet, policySheet),
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
