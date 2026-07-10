import { describe, expect, it } from "vitest";
import sheetReader from "../scripts/generators/sheetReader";

const { getDataStartRowNumber, toObjects } = sheetReader;

const metadataRows = [
  ["id", "name", "optional_note"],
  ["必須", "必須", "任意"],
  ["real-id", "実データ", "note"],
];

const directDataRows = [
  ["id", "name"],
  ["first-id", "1行目の実データ"],
  ["second-id", "2行目の実データ"],
];

describe("sheetReader", () => {
  it.each([
    "99_company_settings",
    "99_policies",
    "99_expense_types",
    "03_判定ルール",
  ])("%s は2行目の説明行を読み飛ばして3行目から読む", (sheetName) => {
    const rows = toObjects(metadataRows, sheetName);

    expect(getDataStartRowNumber(sheetName)).toBe(3);
    expect(rows).toEqual([
      {
        id: "real-id",
        name: "実データ",
        optional_note: "note",
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("必須");
    expect(JSON.stringify(rows)).not.toContain("任意");
  });

  it.each(["99_questions", "99_options", "99_rules"])(
    "%s は2行目から実データとして読む",
    (sheetName) => {
      const rows = toObjects(directDataRows, sheetName);

      expect(getDataStartRowNumber(sheetName)).toBe(2);
      expect(rows).toEqual([
        {
          id: "first-id",
          name: "1行目の実データ",
        },
        {
          id: "second-id",
          name: "2行目の実データ",
        },
      ]);
    },
  );
});
