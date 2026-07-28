import { describe, it, expect } from "vitest";
import { buildConfigFromFlow } from "../src/flow/buildConfigFromFlow";

// mappingはすべてテスト専用のダミー値であり、実際のConcur Expense Type
// Codeではない。

function buildMinimalFlow() {
  return {
    rootQuestionId: "q1",
    questions: {
      q1: { text: "何に使いましたか？", type: "single_select", optionIds: ["o1", "o2"] },
    },
    options: {
      o1: {
        label: "タクシー",
        next: {
          type: "result",
          candidates: [
            { sourceRuleId: "r1", expenseTypeId: "taxi", message: "タクシー代です。", warningMessage: "" },
          ],
        },
      },
      o2: {
        label: "その他",
        next: {
          type: "result",
          candidates: [
            { sourceRuleId: "r2", expenseTypeId: "other", message: "その他経費です。", warningMessage: "" },
          ],
        },
      },
    },
  };
}

function buildBaseData(overrides = {}) {
  return {
    company: { company_id: "sample-company", company_name: "サンプル会社" },
    policies: [{ policy_id: "normal_expense", policy_name: "通常経費" }],
    expenseTypes: [{ id: "taxi", policyId: "normal_expense", name: "タクシー" }],
    ...overrides,
  };
}

describe("buildConfigFromFlow - concurExpenseTypeMappings", () => {
  it("baseData.concurExpenseTypeMappingsが、そのままconfig.concur.expenseTypeMappingsへ載る", () => {
    const mappings = [
      { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI" },
    ];

    const config = buildConfigFromFlow(buildMinimalFlow(), buildBaseData({ concurExpenseTypeMappings: mappings }));

    expect(config.concur).toEqual({ expenseTypeMappings: mappings });
  });

  it("concurExpenseTypeMappingsを渡さない場合は空配列になる（既存会社はこれに該当）", () => {
    const config = buildConfigFromFlow(buildMinimalFlow(), buildBaseData());

    expect(config.concur).toEqual({ expenseTypeMappings: [] });
  });

  it("concurExpenseTypeMappingsが配列でない不正な値でも空配列になる（安全側）", () => {
    const config = buildConfigFromFlow(
      buildMinimalFlow(),
      buildBaseData({ concurExpenseTypeMappings: "not-an-array" }),
    );

    expect(config.concur).toEqual({ expenseTypeMappings: [] });
  });

  it("baseDataを一切渡さない場合も例外にならず空配列になる", () => {
    const config = buildConfigFromFlow(buildMinimalFlow());

    expect(config.concur).toEqual({ expenseTypeMappings: [] });
  });

  it("company/policies/expenseTypesはこれまで通り素通しされる（回帰確認）", () => {
    const baseData = buildBaseData({ concurExpenseTypeMappings: [] });
    const config = buildConfigFromFlow(buildMinimalFlow(), baseData);

    expect(config.company).toBe(baseData.company);
    expect(config.policies).toBe(baseData.policies);
    expect(config.expenseTypes).toBe(baseData.expenseTypes);
  });

  it("questions/rulesの生成結果は、concurExpenseTypeMappingsの有無に関わらず一切変わらない", () => {
    const flow = buildMinimalFlow();

    const withMappings = buildConfigFromFlow(
      flow,
      buildBaseData({
        concurExpenseTypeMappings: [
          { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI" },
        ],
      }),
    );
    const withoutMappings = buildConfigFromFlow(flow, buildBaseData());

    expect(withMappings.questions).toEqual(withoutMappings.questions);
    expect(withMappings.rules).toEqual(withoutMappings.rules);

    expect(withoutMappings.questions).toHaveLength(1);
    expect(withoutMappings.rules).toHaveLength(2);
    expect(withoutMappings.rules.map((rule) => rule.resultExpenseTypeId)).toEqual(["taxi", "other"]);
  });
});
