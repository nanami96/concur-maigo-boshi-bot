import { describe, expect, it } from "vitest";
import excelRowAppender from "../scripts/excel-row-appender";

const {
  appendRowsToWorksheetXml,
  detectFirstDataRowNumber,
  getCellStylesByColumn,
  updateTableRef,
} = excelRowAppender;

function createWorksheetXml() {
  return [
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<dimension ref="A1:B3"/>',
    "<sheetData>",
    '<row r="1"><c r="A1" s="10"/><c r="B1" s="10"/></row>',
    '<row r="2"><c r="A2" s="20"/><c r="B2" s="21"/></row>',
    '<row r="3"><c r="A3" s="30"/><c r="B3" s="31"/></row>',
    "</sheetData>",
    "</worksheet>",
  ].join("");
}

describe("excel row appender", () => {
  it("uses the configured first data row instead of header or description rows", () => {
    const rows = [
      ["id", "name"],
      ["\u5fc5\u9808", "\u4efb\u610f"],
      ["train", "\u96fb\u8eca"],
    ];

    expect(detectFirstDataRowNumber(rows, "99_expense_types")).toBe(3);
    expect(
      detectFirstDataRowNumber(rows, "03_\u5224\u5b9a\u30eb\u30fc\u30eb"),
    ).toBe(3);
    expect(detectFirstDataRowNumber(rows, "99_policies")).toBe(3);
  });

  it("uses row 2 as the first data row for 01_questions", () => {
    const rows = [
      ["id", "text"],
      ["q_category", "\u7d4c\u8cbb\u306e\u7a2e\u985e\u306f\uff1f"],
    ];

    expect(detectFirstDataRowNumber(rows, "01_questions")).toBe(2);
  });

  it("auto-detects the first data row when a future sheet has a description row", () => {
    const rows = [
      ["id", "name"],
      ["\u5fc5\u9808", "\u4efb\u610f"],
      ["policy", "\u901a\u5e38\u7d4c\u8cbb"],
    ];

    expect(detectFirstDataRowNumber(rows, "future_sheet", {})).toBe(3);
  });

  it("appends new rows with the first data row style and leaves existing styles untouched", () => {
    const result = appendRowsToWorksheetXml(
      createWorksheetXml(),
      [["taxi", "\u30bf\u30af\u30b7\u30fc"]],
      {
        sheetName: "99_expense_types",
        existingRows: [
          ["id", "name"],
          ["\u5fc5\u9808", "\u4efb\u610f"],
          ["train", "\u96fb\u8eca"],
        ],
      },
    );

    expect(result.firstDataRowNumber).toBe(3);
    expect(result.xml).toContain('<dimension ref="A1:B4"/>');
    expect(result.xml).toContain('<row r="2"><c r="A2" s="20"/><c r="B2" s="21"/></row>');
    expect(result.xml).toContain('<row r="3"><c r="A3" s="30"/><c r="B3" s="31"/></row>');
    expect(result.xml).toContain('<c r="A4" t="inlineStr" s="30">');
    expect(result.xml).toContain('<c r="B4" t="inlineStr" s="31">');

    const appendedStyles = getCellStylesByColumn(result.xml, 4);
    expect(appendedStyles.get("A")).toBe("30");
    expect(appendedStyles.get("B")).toBe("31");
  });

  it("updates table and autofilter refs without changing other table XML", () => {
    const tableXml =
      '<table id="1" name="table1" ref="A1:B3"><autoFilter ref="A1:B3"/><tableColumns count="2"/></table>';

    expect(updateTableRef(tableXml, "A1:B4")).toBe(
      '<table id="1" name="table1" ref="A1:B4"><autoFilter ref="A1:B4"/><tableColumns count="2"/></table>',
    );
  });
});
