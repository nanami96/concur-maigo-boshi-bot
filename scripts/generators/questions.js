const { toValue, isFilled, toQuestionId } = require("./utils");

function createQuestions(categoryRows, conditionColumns) {
  function toQuestionText(columnName) {
    if (columnName === "申請内容") {
      return "今日は何を申請しますか？";
    }

    return `${columnName}ですか？`;
  }

  function getUniqueOptions(columnName) {
    const values = categoryRows
      .map((row) => row[columnName])
      .filter((value) => isFilled(value));

    return [...new Set(values)];
  }

  const questions = conditionColumns.map((columnName, index) => {
    const questionId = toQuestionId(columnName);
    const uniqueOptions = getUniqueOptions(columnName);

    const options = uniqueOptions.map((value) => {
      const optionValue = toValue(value, value);

      return {
        label: value,
        value: optionValue,
        nextQuestionId: getNextQuestionId(columnName, optionValue),
      };
    });

    return {
      id: questionId,
      text: toQuestionText(columnName),
      type: uniqueOptions.every((value) => ["はい", "いいえ"].includes(value))
        ? "yes_no"
        : "single_select",
      displayOrder: index + 1,
      options,
    };
  });

  function getNextQuestionId(currentColumnName, optionValue) {
    const currentIndex = conditionColumns.indexOf(currentColumnName);
    const laterColumns = conditionColumns.slice(currentIndex + 1);

    const matchedRows = categoryRows.filter((row) => {
      const rowValue = toValue(row[currentColumnName], row[currentColumnName]);
      return rowValue === optionValue;
    });

    const nextColumn = laterColumns.find((columnName) =>
      matchedRows.some((row) => isFilled(row[columnName])),
    );

    return nextColumn ? toQuestionId(nextColumn) : undefined;
  }

  return questions;
}

module.exports = {
  createQuestions,
};
