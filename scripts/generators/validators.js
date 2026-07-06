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
