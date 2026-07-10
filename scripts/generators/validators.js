const RULE_SHEET_NAME = "03_判定ルール";
function validateExpenseTypes(categoryRows, expenseTypes, startRowNumber = 2) {
  const errors = [];

  categoryRows.forEach((row, index) => {
    const rowNumber = startRowNumber + index;
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
  validateDuplicateExpenseTypeIds,
  validatePolicyReferences,
  validateRequiredColumns,
};

function validateDuplicateExpenseTypeIds(expenseTypeSheet, startRowNumber = 2) {
  const errors = [];
  const seenIds = new Set();

  expenseTypeSheet.forEach((row, index) => {
    const rowNumber = startRowNumber + index;
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

function validatePolicyReferences(
  expenseTypeSheet,
  policySheet,
  startRowNumber = 2,
) {
  const errors = [];
  const policyIds = new Set(policySheet.map((row) => row.policy_id));

  expenseTypeSheet.forEach((row, index) => {
    const rowNumber = startRowNumber + index;
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

function validateRequiredColumns(rows, metadata, sheetName, startRowNumber = 2) {
  const errors = [];

  rows.forEach((row, index) => {
    const rowNumber = startRowNumber + index;

    Object.keys(metadata).forEach((columnName) => {
      if (metadata[columnName] !== "必須") {
        return;
      }

      if (!row[columnName]) {
        errors.push(
          [
            `【${sheetName}】`,
            `${rowNumber}行目`,
            `項目: ${columnName}`,
            "内容: 必須項目です。",
          ].join(" "),
        );
      }
    });
  });

  return errors;
}
