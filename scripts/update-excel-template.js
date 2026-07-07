const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const XLSX = require("xlsx");

const companyId = process.argv[2] || "sample-company";
const inputFilePath = path.join("excel", `${companyId}.xlsx`);
const outputDir = path.join("excel", "output");
const outputFilePath = path.join(outputDir, `${companyId}.xlsx`);

const RULE_SHEET_NAME = "03_判定ルール";
const EXPENSE_TYPES_SHEET_NAME = "99_expense_types";
const RULE_EXPENSE_TYPE_HEADER = "経費タイプ";
const EXPENSE_TYPE_NAME_HEADER = "expense_type_name";
const HEADER_ROW_INDEX = 0;
const FIRST_DATA_ROW_NUMBER = 3;
const LAST_EXCEL_ROW_NUMBER = 1048576;

function columnNumberToName(columnNumber) {
  let dividend = columnNumber;
  let columnName = "";

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return columnName;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function readRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`${sheetName} シートが見つかりません。`);
  }

  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });
}

function findColumnNumber(headers, headerName, sheetName) {
  const index = headers.findIndex((header) => String(header).trim() === headerName);

  if (index === -1) {
    throw new Error(`${sheetName} シートに ${headerName} 列が見つかりません。`);
  }

  return index + 1;
}

function findLastDataRow(rows, columnNumber, sheetName) {
  const columnIndex = columnNumber - 1;
  let lastRowNumber = FIRST_DATA_ROW_NUMBER - 1;

  rows.forEach((row, index) => {
    const rowNumber = index + 1;

    if (rowNumber < FIRST_DATA_ROW_NUMBER) {
      return;
    }

    if (String(row[columnIndex] ?? "").trim() !== "") {
      lastRowNumber = rowNumber;
    }
  });

  if (lastRowNumber < FIRST_DATA_ROW_NUMBER) {
    throw new Error(`${sheetName} シートに実データがありません。`);
  }

  return lastRowNumber;
}

function getAttribute(xml, attributeName) {
  const match = xml.match(new RegExp(`${attributeName}="([^"]*)"`, "i"));
  return match ? match[1] : "";
}

function decodeRelationshipId(id) {
  return id.replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function normalizeWorksheetTarget(target) {
  const normalizedTarget = target.replace(/\\/g, "/").replace(/^\//, "");

  if (normalizedTarget.startsWith("xl/")) {
    return normalizedTarget;
  }

  return path.posix.normalize(`xl/${normalizedTarget}`);
}

async function getWorksheetPath(zip, sheetName) {
  const workbookXml = await zip.file("xl/workbook.xml").async("string");
  const workbookRelsXml = await zip
    .file("xl/_rels/workbook.xml.rels")
    .async("string");
  const sheetRegex = /<sheet\b[^>]*>/g;
  let sheetMatch;

  while ((sheetMatch = sheetRegex.exec(workbookXml)) !== null) {
    const sheetTag = sheetMatch[0];

    if (getAttribute(sheetTag, "name") !== sheetName) {
      continue;
    }

    const relationshipId = decodeRelationshipId(getAttribute(sheetTag, "r:id"));
    const relationshipRegex = /<Relationship\b[^>]*>/g;
    let relationshipMatch;

    while ((relationshipMatch = relationshipRegex.exec(workbookRelsXml)) !== null) {
      const relationshipTag = relationshipMatch[0];

      if (getAttribute(relationshipTag, "Id") === relationshipId) {
        return normalizeWorksheetTarget(getAttribute(relationshipTag, "Target"));
      }
    }
  }

  throw new Error(`${sheetName} シートのXMLファイルが見つかりません。`);
}

function getValidationSqref(validationXml) {
  return getAttribute(validationXml, "sqref")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function isValidationForColumn(validationXml, columnName) {
  const sqref = getValidationSqref(validationXml);
  const refs = sqref.split(/\s+/).filter(Boolean);

  return refs.some((ref) => {
    const [startRef, endRef = startRef] = ref.split(":");
    const startColumn = startRef.match(/^\$?([A-Z]+)/i)?.[1]?.toUpperCase();
    const endColumn = endRef.match(/^\$?([A-Z]+)/i)?.[1]?.toUpperCase();

    return startColumn === columnName && endColumn === columnName;
  });
}

function buildDataValidation(columnName, formula) {
  const sqref = `${columnName}${FIRST_DATA_ROW_NUMBER}:${columnName}${LAST_EXCEL_ROW_NUMBER}`;

  return [
    `<dataValidation type="list" allowBlank="1" showErrorMessage="1"`,
    ` errorTitle="${escapeXml("入力エラー")}"`,
    ` error="${escapeXml("一覧から経費タイプを選択してください。")}"`,
    ` sqref="${escapeXml(sqref)}">`,
    `<formula1>${escapeXml(formula)}</formula1>`,
    `</dataValidation>`,
  ].join("");
}

function rebuildDataValidationsBlock(existingBlock, columnName, formula) {
  const validationRegex = /<dataValidation\b[\s\S]*?<\/dataValidation>/g;
  const existingValidations = existingBlock
    ? existingBlock.match(validationRegex) || []
    : [];
  const validations = existingValidations.filter(
    (validationXml) => !isValidationForColumn(validationXml, columnName),
  );

  validations.push(buildDataValidation(columnName, formula));

  return `<dataValidations count="${validations.length}">${validations.join(
    "",
  )}</dataValidations>`;
}

function insertDataValidationsBlock(sheetXml, dataValidationsBlock) {
  const insertionTags = [
    "<hyperlinks",
    "<printOptions",
    "<pageMargins",
    "<pageSetup",
    "<headerFooter",
    "<rowBreaks",
    "<drawing",
    "<legacyDrawing",
    "<picture",
    "<oleObjects",
    "<controls",
    "<webPublishItems",
    "<tableParts",
    "<extLst",
  ];
  const insertionIndex = insertionTags
    .map((tag) => sheetXml.indexOf(tag))
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0];

  if (insertionIndex !== undefined) {
    return `${sheetXml.slice(0, insertionIndex)}${dataValidationsBlock}${sheetXml.slice(
      insertionIndex,
    )}`;
  }

  return sheetXml.replace(
    "</worksheet>",
    `${dataValidationsBlock}</worksheet>`,
  );
}

function updateDataValidations(sheetXml, columnName, formula) {
  const blockRegex = /<dataValidations\b[\s\S]*?<\/dataValidations>/;
  const existingBlock = sheetXml.match(blockRegex)?.[0];
  const dataValidationsBlock = rebuildDataValidationsBlock(
    existingBlock,
    columnName,
    formula,
  );

  if (existingBlock) {
    return sheetXml.replace(blockRegex, dataValidationsBlock);
  }

  return insertDataValidationsBlock(sheetXml, dataValidationsBlock);
}

async function main() {
  const sourceBuffer = fs.readFileSync(inputFilePath);
  const zip = await JSZip.loadAsync(sourceBuffer);
  const workbook = XLSX.read(sourceBuffer, { type: "buffer" });
  const ruleRows = readRows(workbook, RULE_SHEET_NAME);
  const expenseTypeRows = readRows(workbook, EXPENSE_TYPES_SHEET_NAME);
  const ruleExpenseTypeColumn = findColumnNumber(
    ruleRows[HEADER_ROW_INDEX] || [],
    RULE_EXPENSE_TYPE_HEADER,
    RULE_SHEET_NAME,
  );
  const expenseTypeNameColumn = findColumnNumber(
    expenseTypeRows[HEADER_ROW_INDEX] || [],
    EXPENSE_TYPE_NAME_HEADER,
    EXPENSE_TYPES_SHEET_NAME,
  );
  const lastExpenseTypeRow = findLastDataRow(
    expenseTypeRows,
    expenseTypeNameColumn,
    EXPENSE_TYPES_SHEET_NAME,
  );
  const ruleExpenseTypeColumnName = columnNumberToName(ruleExpenseTypeColumn);
  const expenseTypeNameColumnName = columnNumberToName(expenseTypeNameColumn);
  const formula = `'${EXPENSE_TYPES_SHEET_NAME}'!$${expenseTypeNameColumnName}$${FIRST_DATA_ROW_NUMBER}:$${expenseTypeNameColumnName}$${lastExpenseTypeRow}`;
  const ruleWorksheetPath = await getWorksheetPath(zip, RULE_SHEET_NAME);
  const ruleWorksheetFile = zip.file(ruleWorksheetPath);

  if (!ruleWorksheetFile) {
    throw new Error(`${ruleWorksheetPath} がxlsx内に見つかりません。`);
  }

  const ruleWorksheetXml = await ruleWorksheetFile.async("string");
  const updatedRuleWorksheetXml = updateDataValidations(
    ruleWorksheetXml,
    ruleExpenseTypeColumnName,
    formula,
  );

  zip.file(ruleWorksheetPath, updatedRuleWorksheetXml);

  fs.mkdirSync(outputDir, { recursive: true });

  const outputBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });

  fs.writeFileSync(outputFilePath, outputBuffer);

  console.log(`${outputFilePath} の入力規則を生成しました。`);
  console.log(`元ファイル ${inputFilePath} は変更していません。`);
  console.log(`${ruleWorksheetPath} の dataValidations だけを更新しました。`);
}

main().catch((error) => {
  console.error("Excelテンプレートの更新に失敗しました。");
  console.error(error.message);
  process.exit(1);
});
