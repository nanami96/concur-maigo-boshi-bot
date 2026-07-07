const RULE_SHEET_NAME = "03_判定ルール";
function validateExpenseTypes(categoryRows, expenseTypes) {
  const errors = [];

  categoryRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const expenseTypeName = row["経費タイプ"];
    if (!expenseTypeName) {
      return;
    }
    const exists = expenseTypes.some((item) => item.name === expenseTypeName);

    if (!exists) {
      errors.push(
        [
          `【${RULE_SHEET_NAME}】`,
          `${rowNumber}行目`,
          "項目: 経費タイプ",
          `内容: 「${expenseTypeName}」が 99_expense_types に存在しません。`,
        ].join(" "),
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

function validateRequiredFields(categoryRows, metadata) {
  const errors = [];

  categoryRows.forEach((row, index) => {
    const rowNumber = index + 2;

    if (metadata["申請内容"] === "必須" && !row["申請内容"]) {
      errors.push(
        [
          `【${RULE_SHEET_NAME}】`,
          `${rowNumber}行目`,
          "項目: 申請内容",
          "内容: 必須項目です。",
        ].join(" "),
      );
    }

    if (metadata["経費タイプ"] === "必須" && !row["経費タイプ"]) {
      errors.push(
        [
          `【${RULE_SHEET_NAME}】`,
          `${rowNumber}行目`,
          "項目: 経費タイプ",
          "内容: 必須項目です。",
        ].join(" "),
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
        [
          "【99_expense_types】",
          `${rowNumber}行目`,
          "項目: expense_type_id",
          `内容: 「${expenseTypeId}」が重複しています。`,
        ].join(" "),
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
        [
          "【99_expense_types】",
          `${rowNumber}行目`,
          "項目: policy_id",
          `内容: 「${policyId}」が 99_policies に存在しません。`,
        ].join(" "),
      );
    }
  });

  return errors;
}

function validateCompanySettings(companySheet, metadata) {
  const errors = [];
  const company = companySheet[0] || {};

  if (metadata["company_id"] === "必須" && !company.company_id) {
    errors.push(
      [
        "【99_company_settings】",
        "2行目",
        "項目: company_id",
        "内容: 必須項目です。",
      ].join(" "),
    );
  }

  if (metadata["company_name"] === "必須" && !company.company_name) {
    errors.push(
      [
        "【99_company_settings】",
        "2行目",
        "項目: company_name",
        "内容: 必須項目です。",
      ].join(" "),
    );
  }

  if (metadata["default_policy_id"] === "必須" && !company.default_policy_id) {
    errors.push(
      [
        "【99_company_settings】",
        "2行目",
        "項目: default_policy_id",
        "内容: 必須項目です。",
      ].join(" "),
    );
  }

  return errors;
}
