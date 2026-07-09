import { describe, expect, it } from "vitest";
import { generateReportHtml } from "../scripts/report-generator";

const config = {
  company: {
    company_id: "sample-company",
    company_name: "Sample Company",
  },
  questions: [
    {
      id: "q-category",
      text: "What are you claiming?",
      options: [
        {
          label: "Train",
          value: "train",
        },
      ],
    },
  ],
  rules: [
    {
      id: "r-train",
      conditions: {
        "q-category": "train",
      },
      resultExpenseTypeId: "train",
      message: "Use train.",
      active: true,
    },
  ],
  expenseTypes: [
    {
      id: "train",
      name: "Train",
      receiptRequired: false,
      active: true,
    },
  ],
};

describe("generateReportHtml", () => {
  it("renders a review report with the required sections", () => {
    const html = generateReportHtml(config, "sample-company");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("会社情報");
    expect(html).toContain("質問一覧");
    expect(html).toContain("判定ルール一覧");
    expect(html).toContain("経費タイプ一覧");
    expect(html).toContain("設定チェック結果");
    expect(html).toContain("判定フロー概要");
    expect(html).toContain("Sample Company");
    expect(html).toContain("r-train");
  });

  it("escapes HTML in config values", () => {
    const html = generateReportHtml(
      {
        ...config,
        company: {
          company_name: "<script>alert(1)</script>",
        },
      },
      "sample-company",
    );

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
