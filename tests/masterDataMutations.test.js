import { describe, it, expect } from "vitest";
import {
  updateCompanyName,
  addPolicy,
  updatePolicy,
  deletePolicy,
  addExpenseType,
  updateExpenseType,
  deleteExpenseType,
  countExpenseTypesUsingPolicy,
  countFlowResultsUsingExpenseType,
} from "../src/flow/masterDataMutations";

describe("company mutations", () => {
  it("会社名を変更してもcompany_idは変わらない", () => {
    const company = { company_id: "sample-company", company_name: "サンプル会社" };
    const next = updateCompanyName(company, "新しい会社名");
    expect(next.company_name).toBe("新しい会社名");
    expect(next.company_id).toBe("sample-company");
  });
});

describe("policy mutations", () => {
  it("ポリシーを追加できる", () => {
    const policies = [];
    const next = addPolicy(policies, { policy_id: "normal_expense", policy_name: "通常経費", enabled: "Y" });
    expect(next).toHaveLength(1);
    expect(next[0].policy_id).toBe("normal_expense");
  });

  it("ポリシー名・使用有無を更新できる", () => {
    const policies = [{ policy_id: "normal_expense", policy_name: "通常経費", enabled: "Y" }];
    const next = updatePolicy(policies, "normal_expense", { policy_name: "通常経費（改）", enabled: "N" });
    expect(next[0].policy_name).toBe("通常経費（改）");
    expect(next[0].enabled).toBe("N");
  });

  it("ポリシーを削除できる", () => {
    const policies = [{ policy_id: "a", policy_name: "A", enabled: "Y" }];
    expect(deletePolicy(policies, "a")).toHaveLength(0);
  });
});

describe("expenseType mutations", () => {
  it("経費タイプを追加できる", () => {
    const expenseTypes = [];
    const next = addExpenseType(expenseTypes, {
      id: "taxi",
      policyId: "normal_expense",
      name: "タクシー",
      receiptRequired: true,
      active: true,
    });
    expect(next).toHaveLength(1);
  });

  it("経費タイプ名・ポリシー・領収書要否・使用有無を更新できる", () => {
    const expenseTypes = [
      { id: "taxi", policyId: "normal_expense", name: "タクシー", receiptRequired: true, active: true },
    ];
    const next = updateExpenseType(expenseTypes, "taxi", {
      name: "タクシー代",
      policyId: "business_trip",
      receiptRequired: false,
      active: false,
    });
    expect(next[0]).toEqual({
      id: "taxi",
      policyId: "business_trip",
      name: "タクシー代",
      receiptRequired: false,
      active: false,
    });
  });

  it("経費タイプを削除できる", () => {
    const expenseTypes = [{ id: "taxi", policyId: "p", name: "タクシー", receiptRequired: true, active: true }];
    expect(deleteExpenseType(expenseTypes, "taxi")).toHaveLength(0);
  });
});

describe("使用状況カウント", () => {
  it("countExpenseTypesUsingPolicy: ポリシーを使用している経費タイプ件数を数える", () => {
    const expenseTypes = [
      { id: "a", policyId: "p1" },
      { id: "b", policyId: "p1" },
      { id: "c", policyId: "p2" },
    ];
    expect(countExpenseTypesUsingPolicy(expenseTypes, "p1")).toBe(2);
    expect(countExpenseTypesUsingPolicy(expenseTypes, "p2")).toBe(1);
    expect(countExpenseTypesUsingPolicy(expenseTypes, "p3")).toBe(0);
  });

  it("countFlowResultsUsingExpenseType: flow内の結果candidatesで経費タイプが使われている件数を数える", () => {
    const flow = {
      rootQuestionId: "Q001",
      questions: { Q001: { text: "Q", optionIds: ["O001", "O002"] } },
      options: {
        O001: { label: "A", next: { type: "result", candidates: [{ expenseTypeId: "taxi" }] } },
        O002: {
          label: "B",
          next: {
            type: "result",
            candidates: [{ expenseTypeId: "taxi" }, { expenseTypeId: "train_local" }],
          },
        },
      },
    };
    expect(countFlowResultsUsingExpenseType(flow, "taxi")).toBe(2);
    expect(countFlowResultsUsingExpenseType(flow, "train_local")).toBe(1);
    expect(countFlowResultsUsingExpenseType(flow, "unused")).toBe(0);
  });
});
