import { describe, it, expect } from "vitest";
import {
  resolveConcurExpenseTypeMappings,
  resolveDefaultCurrencyCode,
} from "../src/lib/concurRegistrationConfig.js";

// mappingsはすべてテスト専用のダミー値であり、実際のConcur Expense Type
// Codeではない（本番データはこのファイル・呼び出し元のどちらにも追加しない）。

describe("resolveConcurExpenseTypeMappings", () => {
  it("config.concur.expenseTypeMappingsが設定されている場合はそのまま取得できる", () => {
    const config = {
      company: { company_id: "sample-company" },
      concur: {
        expenseTypeMappings: [
          { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI" },
        ],
      },
    };

    expect(resolveConcurExpenseTypeMappings(config)).toEqual([
      { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI" },
    ]);
  });

  it("config.concurが無い（既存会社の設定そのまま）場合は空配列を返す", () => {
    const config = {
      company: { company_id: "sample-company", company_name: "サンプル会社" },
      policies: [],
      expenseTypes: [],
      questions: [],
      rules: [],
    };

    expect(resolveConcurExpenseTypeMappings(config)).toEqual([]);
  });

  it("configがnull・undefinedでも例外にならず空配列を返す（既存会社設定が壊れない）", () => {
    expect(resolveConcurExpenseTypeMappings(null)).toEqual([]);
    expect(resolveConcurExpenseTypeMappings(undefined)).toEqual([]);
  });

  it("expenseTypeMappingsが配列でない不正な形の場合も空配列扱いにする（安全側）", () => {
    expect(resolveConcurExpenseTypeMappings({ concur: { expenseTypeMappings: "not-an-array" } })).toEqual([]);
    expect(resolveConcurExpenseTypeMappings({ concur: {} })).toEqual([]);
  });
});

describe("resolveDefaultCurrencyCode", () => {
  it("既存configにデフォルト通貨の概念が無いため、常にJPYを返す", () => {
    expect(resolveDefaultCurrencyCode({ company: { company_id: "sample-company" } })).toBe("JPY");
    expect(resolveDefaultCurrencyCode(null)).toBe("JPY");
    expect(resolveDefaultCurrencyCode(undefined)).toBe("JPY");
  });
});
