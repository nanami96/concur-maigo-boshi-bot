const XLSX = require("xlsx");
const fs = require("fs");

// Excel読込
const workbook = XLSX.readFile("excel/sample-company.xlsx");

// company_settings シート
const companySheet = XLSX.utils.sheet_to_json(
  workbook.Sheets["company_settings"],
);

// policies シート
const policySheet = XLSX.utils.sheet_to_json(workbook.Sheets["policies"]);

// expense_types シート
const expenseTypeSheet = XLSX.utils.sheet_to_json(
  workbook.Sheets["expense_types"],
);

// questions シート
const questionSheet = XLSX.utils.sheet_to_json(workbook.Sheets["questions"]);

// options シート
const optionSheet = XLSX.utils.sheet_to_json(workbook.Sheets["options"]);
// rules シート
const ruleSheet = XLSX.utils.sheet_to_json(workbook.Sheets["rules"]);
// config生成
const config = {
  company: companySheet[0],

  policies: policySheet,

  expenseTypes: expenseTypeSheet.map((item) => ({
    id: item.expense_type_id,
    policyId: item.policy_id,
    name: item.expense_type_name,
    receiptRequired: item.receipt_required === "Y",
    active: item.active === "Y",
    note: item.note || "",
  })),
  questions: questionSheet
    .sort((a, b) => a.display_order - b.display_order)
    .map((question) => ({
      id: question.question_id,
      text: question.question_text,
      type: question.question_type,
      displayOrder: question.display_order,

      options: optionSheet
        .filter((option) => option.question_id === question.question_id)
        .map((option) => ({
          label: option.option_label,
          value: option.option_value,
          nextQuestionId: option.next_question_id || undefined,
        })),
    })),
  rules: ruleSheet.reduce((acc, row) => {
    let rule = acc.find((r) => r.id === row.rule_id);

    if (!rule) {
      rule = {
        id: row.rule_id,
        priority: Number(row.priority || 999),
        conditions: {},
        resultExpenseTypeId: row.result_expense_type_id,
        message: row.guidance_message,
        warningMessage: row.warning_message,
        active: true,
      };

      acc.push(rule);
    }

    rule.conditions[row.condition_key] = row.condition_value;

    return acc;
  }, []),
};

// JSON保存
fs.writeFileSync(
  "rules/sample-company/config.json",
  JSON.stringify(config, null, 2),
  "utf8",
);

console.log("config.json を生成しました！");
