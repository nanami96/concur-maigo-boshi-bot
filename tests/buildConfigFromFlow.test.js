import { describe, it, expect } from "vitest";
import { buildConfigFromFlow } from "../src/flow/buildConfigFromFlow";

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

describe("buildConfigFromFlow", () => {
  it("config.concurは生成しない（経費タイプID＝Concur EXP_KEYという設計により、独立したmapping表は廃止済み）", () => {
    const config = buildConfigFromFlow(buildMinimalFlow(), buildBaseData());

    expect(config).not.toHaveProperty("concur");
  });

  it("baseDataを一切渡さなくても例外にならない", () => {
    expect(() => buildConfigFromFlow(buildMinimalFlow())).not.toThrow();
  });

  it("company/policies/expenseTypesはこれまで通り素通しされる（回帰確認）", () => {
    const baseData = buildBaseData();
    const config = buildConfigFromFlow(buildMinimalFlow(), baseData);

    expect(config.company).toBe(baseData.company);
    expect(config.policies).toBe(baseData.policies);
    expect(config.expenseTypes).toBe(baseData.expenseTypes);
  });

  it("questions/rulesの生成結果はこれまで通り（回帰確認）", () => {
    const flow = buildMinimalFlow();
    const config = buildConfigFromFlow(flow, buildBaseData());

    expect(config.questions).toHaveLength(1);
    expect(config.rules).toHaveLength(2);
    expect(config.rules.map((rule) => rule.resultExpenseTypeId)).toEqual(["taxi", "other"]);
  });
});
