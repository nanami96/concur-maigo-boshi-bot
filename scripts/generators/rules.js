const { toValue, isFilled } = require("./utils");

function createRules(categoryRows, conditionColumns, expenseTypes, toQuestionId) {
  function findExpenseTypeId(expenseTypeName) {
    const expenseType = expenseTypes.find(
      (item) => item.name === expenseTypeName,
    );

    return expenseType ? expenseType.id : "";
  }

  return categoryRows.map((row, index) => {
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
}

module.exports = {
  createRules,
};