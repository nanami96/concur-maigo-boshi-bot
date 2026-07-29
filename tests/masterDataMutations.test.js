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
  addConcurExpenseTypeMapping,
  updateConcurExpenseTypeMapping,
  deleteConcurExpenseTypeMapping,
  countConcurMappingsUsingPolicy,
  countConcurMappingsUsingExpenseType,
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

  it("countConcurMappingsUsingPolicy: ポリシーを参照しているConcurマッピング件数を数える", () => {
    const mappings = [
      { companyId: "c1", policyId: "p1", botExpenseTypeId: "taxi", concurExpenseTypeId: "X1" },
      { companyId: "c1", policyId: "p1", botExpenseTypeId: "train", concurExpenseTypeId: "X2" },
      { companyId: "c1", policyId: "p2", botExpenseTypeId: "hotel", concurExpenseTypeId: "X3" },
    ];
    expect(countConcurMappingsUsingPolicy(mappings, "p1")).toBe(2);
    expect(countConcurMappingsUsingPolicy(mappings, "p2")).toBe(1);
    expect(countConcurMappingsUsingPolicy(mappings, "p3")).toBe(0);
    expect(countConcurMappingsUsingPolicy(undefined, "p1")).toBe(0);
  });

  it("countConcurMappingsUsingExpenseType: 経費タイプを参照しているConcurマッピング件数を数える", () => {
    const mappings = [
      { companyId: "c1", policyId: "p1", botExpenseTypeId: "taxi", concurExpenseTypeId: "X1" },
      { companyId: "c1", policyId: "p2", botExpenseTypeId: "taxi", concurExpenseTypeId: "X2" },
    ];
    expect(countConcurMappingsUsingExpenseType(mappings, "taxi")).toBe(2);
    expect(countConcurMappingsUsingExpenseType(mappings, "hotel")).toBe(0);
    expect(countConcurMappingsUsingExpenseType(undefined, "taxi")).toBe(0);
  });
});

// mappingの値（Concur Expense Type Code）はすべてテスト専用のダミー値であり、
// 実際のConcur側のコードではない。
describe("Concurマッピング mutations", () => {
  function buildMappings() {
    return [
      { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI" },
      { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "train_local", concurExpenseTypeId: "TEST_TRAIN" },
    ];
  }

  it("addConcurExpenseTypeMapping: マッピングを追加できる（既存配列を直接変更しない）", () => {
    const mappings = buildMappings();
    const next = addConcurExpenseTypeMapping(mappings, {
      companyId: "sample-company",
      policyId: "business_trip",
      botExpenseTypeId: "trip_type",
      concurExpenseTypeId: "TEST_TRIP",
    });

    expect(next).toHaveLength(3);
    expect(mappings).toHaveLength(2); // 元の配列は変更されない
    expect(next[2].concurExpenseTypeId).toBe("TEST_TRIP");
  });

  it("updateConcurExpenseTypeMapping: companyId+policyId+botExpenseTypeIdで対象を特定し、内容を更新できる", () => {
    const mappings = buildMappings();
    const next = updateConcurExpenseTypeMapping(
      mappings,
      { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "taxi" },
      { concurExpenseTypeId: "TEST_TAXI_UPDATED" },
    );

    expect(next[0].concurExpenseTypeId).toBe("TEST_TAXI_UPDATED");
    expect(next[1]).toEqual(mappings[1]); // 対象外の行は変更されない
    expect(mappings[0].concurExpenseTypeId).toBe("TEST_TAXI"); // 元の配列は変更されない
  });

  it("updateConcurExpenseTypeMapping: policyId/botExpenseTypeId自体（キー）も変更できる", () => {
    const mappings = buildMappings();
    const next = updateConcurExpenseTypeMapping(
      mappings,
      { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "taxi" },
      { policyId: "business_trip", botExpenseTypeId: "trip_type", concurExpenseTypeId: "TEST_TRIP" },
    );

    expect(next[0]).toEqual({
      companyId: "sample-company",
      policyId: "business_trip",
      botExpenseTypeId: "trip_type",
      concurExpenseTypeId: "TEST_TRIP",
    });
  });

  it("deleteConcurExpenseTypeMapping: companyId+policyId+botExpenseTypeIdで対象を特定し削除できる", () => {
    const mappings = buildMappings();
    const next = deleteConcurExpenseTypeMapping(mappings, {
      companyId: "sample-company",
      policyId: "normal_expense",
      botExpenseTypeId: "taxi",
    });

    expect(next).toHaveLength(1);
    expect(next[0].botExpenseTypeId).toBe("train_local");
    expect(mappings).toHaveLength(2); // 元の配列は変更されない
  });

  it("存在しないキーを指定してもupdate/deleteは例外にならず、他の行に影響しない", () => {
    const mappings = buildMappings();

    const afterUpdate = updateConcurExpenseTypeMapping(
      mappings,
      { companyId: "sample-company", policyId: "does_not_exist", botExpenseTypeId: "unknown" },
      { concurExpenseTypeId: "SHOULD_NOT_APPLY" },
    );
    expect(afterUpdate).toEqual(mappings);

    const afterDelete = deleteConcurExpenseTypeMapping(mappings, {
      companyId: "sample-company",
      policyId: "does_not_exist",
      botExpenseTypeId: "unknown",
    });
    expect(afterDelete).toEqual(mappings);
  });

  it("Excel由来のmapping（parseInitialSetupExcelの戻り値と全く同じ形）も、管理画面と同じmutationで編集・削除できる", () => {
    // Excel経由・管理画面経由でデータ構造を分けない、という設計方針の確認。
    const excelImportedMappings = [
      { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "taxi", concurExpenseTypeId: "TEST_TAXI_FROM_EXCEL" },
    ];

    const afterUpdate = updateConcurExpenseTypeMapping(
      excelImportedMappings,
      { companyId: "sample-company", policyId: "normal_expense", botExpenseTypeId: "taxi" },
      { concurExpenseTypeId: "TEST_TAXI_EDITED_IN_ADMIN" },
    );
    expect(afterUpdate[0].concurExpenseTypeId).toBe("TEST_TAXI_EDITED_IN_ADMIN");

    const afterDelete = deleteConcurExpenseTypeMapping(afterUpdate, {
      companyId: "sample-company",
      policyId: "normal_expense",
      botExpenseTypeId: "taxi",
    });
    expect(afterDelete).toHaveLength(0);
  });
});
