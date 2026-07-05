const { createQuestions } = require("./generators/questions");
const XLSX = require("xlsx");
const fs = require("fs");
const { toValue, isFilled } = require("./generators/utils");

const workbook = XLSX.readFile("excel/sample-company.xlsx");

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

function toQuestionId(columnName) {
  if (columnName === "申請内容") {
    return "q-category";
  }

  const questionIdMap = {
    出張に関係: "q-business-trip",
    領収書あり: "q-receipt",
  };

  return questionIdMap[columnName] || `q-${toValue(columnName, columnName)}`;
}

const expenseTypes = expenseTypeSheet.map((item) => ({
  id: item.expense_type_id,
  policyId: item.policy_id,
  name: item.expense_type_name,
  receiptRequired: item.receipt_required === "Y",
  active: item.active === "Y",
  note: item.note || "",
}));

function findExpenseTypeId(expenseTypeName) {
  const expenseType = expenseTypes.find(
    (item) => item.name === expenseTypeName,
  );
  return expenseType ? expenseType.id : "";
}

const rules = categoryRows.map((row, index) => {
  const conditions = {};

  conditionColumns.forEach((columnName) => {
    if (isFilled(row[columnName])) {
      conditions[toQuestionId(columnName)] = toValue(
        row[columnName],
        row[columnName],
      );
    }
  });

  return {
    id: `r${String(index + 1).padStart(3, "0")}`,
    priority: index + 1,
    conditions,
    resultExpenseTypeId: findExpenseTypeId(row["経費タイプ"]),
    message: row["案内メッセージ"] || "",
    warningMessage: row["注意事項"] || "",
    active: true,
  };
});

const config = {
  company: companySheet[0],
  policies: policySheet,
  expenseTypes,
  questions,
  rules,
};

fs.writeFileSync(
  "rules/sample-company/config.json",
  JSON.stringify(config, null, 2),
  "utf8",
);

console.log("config.json を生成しました！");
