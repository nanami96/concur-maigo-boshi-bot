const RULE_SHEET_NAME = "03_判定ルール";
function validateExpenseTypes(categoryRows, expenseTypes) {
  const errors = [];

  categoryRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const expenseTypeName = row["経費タイプ"];

    const exists = expenseTypes.some((item) => item.name === expenseTypeName);

    if (!exists) {
      errors.push(
        `${RULE_SHEET_NAME} ${rowNumber}行目: 経費タイプ「${expenseTypeName}」が 99_expense_types に存在しません。`,
      );
    }
  });

  return errors;
}

module.exports = {
  validateExpenseTypes,
  validateRequiredFields,
  validateDuplicateExpenseTypeIds,
  validatePolicyReferences,
  validateCompanySettings,
};

function validateRequiredFields(categoryRows) {
  const errors = [];

  categoryRows.forEach((row, index) => {
    const rowNumber = index + 2;

    if (!row["申請内容"]) {
      errors.push(
        `${RULE_SHEET_NAME} ${rowNumber}行目: 「申請内容」は必須です。`,
      );
    }

    if (!row["経費タイプ"]) {
      errors.push(
        `${RULE_SHEET_NAME} ${rowNumber}行目: 「経費タイプ」は必須です。`,
      );
    }
  });

  return errors;
}

function validateDuplicateExpenseTypeIds(expenseTypeSheet) {
  const errors = [];
  const seenIds = new Set();

  expenseTypeSheet.forEach((row, index) => {
    const rowNumber = index + 2;
    const expenseTypeId = row.expense_type_id;

    if (!expenseTypeId) {
      return;
    }

    if (seenIds.has(expenseTypeId)) {
      errors.push(
        `99_expense_types ${rowNumber}行目: expense_type_id「${expenseTypeId}」が重複しています。`,
      );
      return;
    }

    seenIds.add(expenseTypeId);
  });

  return errors;
}

function validatePolicyReferences(expenseTypeSheet, policySheet) {
  const errors = [];
  const policyIds = new Set(policySheet.map((row) => row.policy_id));

  expenseTypeSheet.forEach((row, index) => {
    const rowNumber = index + 2;
    const policyId = row.policy_id;

    if (!policyId) {
      return;
    }

    if (!policyIds.has(policyId)) {
      errors.push(
        `99_expense_types ${rowNumber}行目: policy_id「${policyId}」が 99_policies に存在しません。`,
      );
    }
  });

  return errors;
}

function validateCompanySettings(companySheet) {
  const errors = [];
  const company = companySheet[0] || {};

  if (!company.company_id) {
    errors.push("99_company_settings 2行目: 「company_id」は必須です。");
  }

  if (!company.company_name) {
    errors.push("99_company_settings 2行目: 「company_name」は必須です。");
  }

  if (!company.default_policy_id) {
    errors.push("99_company_settings 2行目: 「default_policy_id」は必須です。");
  }

  return errors;
}
