const DEFAULT_FIRST_DATA_ROW_BY_SHEET = {
  "99_expense_types": 3,
  "03_\u5224\u5b9a\u30eb\u30fc\u30eb": 3,
  "99_policies": 3,
  "01_questions": 2,
};

const DESCRIPTION_ROW_VALUES = new Set([
  "\u5fc5\u9808",
  "\u4efb\u610f",
  "required",
  "optional",
]);

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

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

function columnNameToNumber(columnName) {
  return columnName
    .toUpperCase()
    .split("")
    .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

function getAttribute(xml, attributeName) {
  const match = xml.match(new RegExp(`${attributeName}="([^"]*)"`, "i"));
  return match ? match[1] : "";
}

function hasRowValues(row) {
  return row.some((value) => String(value ?? "").trim() !== "");
}

function isDescriptionRow(row) {
  const values = row
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  return (
    values.length > 0 &&
    values.every((value) => DESCRIPTION_ROW_VALUES.has(value.toLowerCase()))
  );
}

function detectFirstDataRowNumber(
  rows,
  sheetName,
  firstDataRowBySheet = DEFAULT_FIRST_DATA_ROW_BY_SHEET,
) {
  if (firstDataRowBySheet[sheetName]) {
    return firstDataRowBySheet[sheetName];
  }

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] || [];

    if (!hasRowValues(row)) {
      continue;
    }

    if (index === 1 && isDescriptionRow(row)) {
      continue;
    }

    return index + 1;
  }

  return 2;
}

function getWorksheetDimension(sheetXml) {
  const dimensionTag = sheetXml.match(/<dimension\b[^>]*>/)?.[0];
  const ref = dimensionTag ? getAttribute(dimensionTag, "ref") : "";
  const [, endColumn = "A", endRow = "1"] =
    ref.match(/:?\$?([A-Z]+)\$?(\d+)$/i) || [];

  return {
    ref,
    endColumn: endColumn.toUpperCase(),
    endRow: Number(endRow),
  };
}

function getLastRowNumber(sheetXml) {
  const rowRegex = /<row\b[^>]*\br="(\d+)"[^>]*>/g;
  let rowMatch;
  let lastRowNumber = 0;

  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    lastRowNumber = Math.max(lastRowNumber, Number(rowMatch[1]));
  }

  return lastRowNumber;
}

function getCellStylesByColumn(sheetXml, rowNumber) {
  const rowRegex = new RegExp(
    `<row\\b[^>]*\\br="${rowNumber}"[^>]*>[\\s\\S]*?<\\/row>`,
    "i",
  );
  const rowXml = sheetXml.match(rowRegex)?.[0] || "";
  const cellRegex = /<c\b[^>]*>/g;
  const styles = new Map();
  let cellMatch;

  while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
    const cellTag = cellMatch[0];
    const cellRef = getAttribute(cellTag, "r");
    const columnName = cellRef.match(/^\$?([A-Z]+)/i)?.[1]?.toUpperCase();
    const style = getAttribute(cellTag, "s");

    if (columnName && style !== "") {
      styles.set(columnName, style);
    }
  }

  return styles;
}

function buildCellXml(value, rowNumber, columnNumber, sourceStylesByColumn) {
  const columnName = columnNumberToName(columnNumber);
  const cellRef = `${columnName}${rowNumber}`;
  const style = sourceStylesByColumn.get(columnName);
  const styleAttribute = style === undefined ? "" : ` s="${escapeXml(style)}"`;

  if (value === null || value === undefined || value === "") {
    return `<c r="${cellRef}"${styleAttribute}/>`;
  }

  if (typeof value === "number") {
    return `<c r="${cellRef}"${styleAttribute}><v>${value}</v></c>`;
  }

  return `<c r="${cellRef}" t="inlineStr"${styleAttribute}><is><t>${escapeXml(
    value,
  )}</t></is></c>`;
}

function buildRowXml(rowValues, rowNumber, sourceStylesByColumn) {
  const cells = rowValues
    .map((value, index) =>
      buildCellXml(value, rowNumber, index + 1, sourceStylesByColumn),
    )
    .join("");

  return `<row r="${rowNumber}">${cells}</row>`;
}

function updateDimension(sheetXml, nextLastRowNumber, columnCount) {
  const dimension = getWorksheetDimension(sheetXml);
  const currentEndColumnNumber = columnNameToNumber(dimension.endColumn);
  const nextEndColumn = columnNumberToName(
    Math.max(currentEndColumnNumber, columnCount, 1),
  );
  const nextRef = `A1:${nextEndColumn}${Math.max(
    dimension.endRow,
    nextLastRowNumber,
  )}`;

  if (/<dimension\b[^>]*>/.test(sheetXml)) {
    return sheetXml.replace(
      /<dimension\b[^>]*>/,
      (dimensionTag) =>
        dimensionTag.includes("ref=")
          ? dimensionTag.replace(/ref="[^"]*"/, `ref="${nextRef}"`)
          : dimensionTag.replace(/\/?>$/, ` ref="${nextRef}"/>`),
    );
  }

  return sheetXml.replace(
    "<sheetViews",
    `<dimension ref="${nextRef}"/><sheetViews`,
  );
}

function appendRowsToWorksheetXml(sheetXml, rowsToAppend, options = {}) {
  if (!rowsToAppend.length) {
    return {
      xml: sheetXml,
      firstDataRowNumber: options.firstDataRowNumber,
      appendedRowCount: 0,
    };
  }

  if (!sheetXml.includes("</sheetData>")) {
    throw new Error("worksheet XML does not contain sheetData.");
  }

  const firstDataRowNumber =
    options.firstDataRowNumber ||
    detectFirstDataRowNumber(
      options.existingRows || [],
      options.sheetName || "",
      options.firstDataRowBySheet,
    );
  const sourceStylesByColumn = getCellStylesByColumn(
    sheetXml,
    firstDataRowNumber,
  );
  const lastRowNumber = getLastRowNumber(sheetXml);
  const maxColumnCount = Math.max(...rowsToAppend.map((row) => row.length));
  const appendedRowsXml = rowsToAppend
    .map((row, index) =>
      buildRowXml(row, lastRowNumber + index + 1, sourceStylesByColumn),
    )
    .join("");
  const appendedLastRowNumber = lastRowNumber + rowsToAppend.length;
  const appendedXml = sheetXml.replace(
    "</sheetData>",
    `${appendedRowsXml}</sheetData>`,
  );

  return {
    xml: updateDimension(appendedXml, appendedLastRowNumber, maxColumnCount),
    firstDataRowNumber,
    appendedRowCount: rowsToAppend.length,
    appendedFirstRowNumber: lastRowNumber + 1,
    appendedLastRowNumber,
  };
}

function updateTableRef(tableXml, ref) {
  return tableXml
    .replace(/(<table\b[^>]*\bref=")[^"]*(")/, `$1${ref}$2`)
    .replace(/(<autoFilter\b[^>]*\bref=")[^"]*(")/, `$1${ref}$2`);
}

module.exports = {
  DEFAULT_FIRST_DATA_ROW_BY_SHEET,
  appendRowsToWorksheetXml,
  buildRowXml,
  detectFirstDataRowNumber,
  getCellStylesByColumn,
  updateTableRef,
};
