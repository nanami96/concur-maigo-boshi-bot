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
  it("renders a designed review report with the required sections", async () => {
    const html = await generateReportHtml(config, "sample-company");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("設定レビューレポート");
    expect(html).toContain("サマリー");
    expect(html).toContain("会社情報");
    expect(html).toContain("質問一覧");
    expect(html).toContain("判定ルール一覧");
    expect(html).toContain("経費タイプ一覧");
    expect(html).toContain("設定チェック結果");
    expect(html).toContain("設定差分");
    expect(html).toContain("判定フロー概要");
    expect(html).toContain("差分はありません");
    expect(html).toContain("Review Notes");
    expect(html).toContain("AIレビューコメント");
    expect(html).toContain("Rule-based Advisor");
    expect(html).toContain("良い点");
    expect(html).toContain("改善候補");
    expect(html).toContain("ai-review-grid");
    expect(html).toContain("severity-badge");
    expect(html).toContain("review-fields");
    expect(html).toContain("review-result");
    expect(html).toContain("review-comment");
    expect(html).toContain("checkbox");
    expect(html).toContain("comment-box");
    expect(html).toContain("@media print");
    expect(html).toContain("Sample Company");
    expect(html).toContain("r-train");
  });

  it("escapes HTML in config values", async () => {
    const html = await generateReportHtml(
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

  it("renders config diff details when compareConfig is provided", async () => {
    const compareConfig = {
      ...config,
      questions: [
        {
          ...config.questions[0],
          text: "Old question text",
        },
      ],
      rules: [],
      expenseTypes: [],
    };

    const html = await generateReportHtml(config, "sample-company", {
      compareConfig,
    });

    expect(html).toContain("Added");
    expect(html).toContain("Removed");
    expect(html).toContain("Changed");
    expect(html).toContain("変更項目");
    expect(html).toContain("Before");
    expect(html).toContain("After");
    expect(html).toContain("Old question text");
    expect(html).toContain("What are you claiming?");
  });
});
