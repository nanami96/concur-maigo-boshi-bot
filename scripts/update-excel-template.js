const ExcelJS = require("exceljs");

const companyId = process.argv[2] || "sample-company";
const filePath = `excel/${companyId}.xlsx`;

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const expenseTypesSheet = workbook.getWorksheet("99_expense_types");
  const ruleSheet = workbook.getWorksheet("03_判定ルール");

  if (!expenseTypesSheet) {
    throw new Error("99_expense_types シートが見つかりません。");
  }

  if (!ruleSheet) {
    throw new Error("03_判定ルール シートが見つかりません。");
  }

  const firstExpenseTypeRow = 3;
  const lastExpenseTypeRow = expenseTypesSheet.rowCount;
  const listFormula = `'99_expense_types'!$C$${firstExpenseTypeRow}:$C$${lastExpenseTypeRow}`;
  const expenseTypeColumn = 4;

  for (let rowNumber = 3; rowNumber <= 100; rowNumber++) {
    const cell = ruleSheet.getCell(rowNumber, expenseTypeColumn);

    cell.dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [listFormula],
      showErrorMessage: true,
      errorTitle: "入力エラー",
      error: "一覧から経費タイプを選択してください。",
    };
  }

  await workbook.xlsx.writeFile(filePath);

  console.log(`${filePath} の入力規則を更新しました！`);
}

main().catch((error) => {
  console.error("Excelテンプレートの更新に失敗しました。");
  console.error(error.message);
  process.exit(1);
});
