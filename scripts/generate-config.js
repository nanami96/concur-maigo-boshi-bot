const { isFilled, toQuestionId } = require("./generators/utils");
const { createExpenseTypes } = require("./generators/expenseTypes");
const { createRules } = require("./generators/rules");
const { createQuestions } = require("./generators/questions");
const XLSX = require("xlsx");
const fs = require("fs");

const companyId = process.argv[2] || "sample-company";
const workbook = XLSX.readFile(`excel/${companyId}.xlsx`);

function readSheet(name) {
  return XLSX.utils.sheet_to_json(workbook.Sheets[name] || {});
}

const companySheet = readSheet("99_company_settings");
const policySheet = readSheet("99_policies");
const expenseTypeSheet = readSheet("99_expense_types");
const simpleRuleSheet = readSheet("03_判定ルール");

// 03_判定ルールから申請内容を抽出
const categoryRows = simpleRuleSheet.filter((row) => isFilled(row["申請内容"]));

const resultColumns = ["経費タイプ", "案内メッセージ", "注意事項"];

const conditionColumns = Object.keys(categoryRows[0] || {}).filter(
  (columnName) => !resultColumns.includes(columnName),
);

const questions = createQuestions(categoryRows, conditionColumns);

const expenseTypes = createExpenseTypes(expenseTypeSheet);

const rules = createRules(
  categoryRows,
  conditionColumns,
  expenseTypes,
  toQuestionId,
);
const config = {
  company: companySheet[0],
  policies: policySheet,
  expenseTypes,
  questions,
  rules,
};

const outputDir = `rules/${companyId}`;

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(
  `${outputDir}/config.json`,
  JSON.stringify(config, null, 2),
  "utf8",
);

console.log("config.json を生成しました！");
