import { describe, it, expect } from "vitest";
import {
  validateDuplicateExpenseTypeIds,
  validatePolicyReferences,
  validateCompanySettings,
} from "../scripts/generators/validators";

describe("validators", () => {
  it("expense_type_id が重複している場合はエラーを返す", () => {
    const expenseTypeSheet = [
      {
        expense_type_id: "taxi",
        expense_type_name: "タクシー",
      },
      {
        expense_type_id: "taxi",
        expense_type_name: "タクシー2",
      },
    ];

    const errors = validateDuplicateExpenseTypeIds(expenseTypeSheet);

    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("taxi");
    expect(errors[0]).toContain("重複");
  });
  it("expense_type_id が重複していない場合はエラーを返さない", () => {
    const expenseTypeSheet = [
      {
        expense_type_id: "train_local",
        expense_type_name: "電車・近隣交通費",
      },
      {
        expense_type_id: "taxi",
        expense_type_name: "タクシー",
      },
    ];

    const errors = validateDuplicateExpenseTypeIds(expenseTypeSheet);

    expect(errors.length).toBe(0);
  });
});
it("存在しない policy_id の場合はエラーを返す", () => {
  const expenseTypeSheet = [
    {
      policy_id: "normal_expense",
    },
    {
      policy_id: "not_exist",
    },
  ];

  const policySheet = [
    {
      policy_id: "normal_expense",
    },
  ];

  const errors = validatePolicyReferences(expenseTypeSheet, policySheet);

  expect(errors.length).toBe(1);
  expect(errors[0]).toContain("not_exist");
});

it("存在する policy_id の場合はエラーを返さない", () => {
  const expenseTypeSheet = [
    {
      policy_id: "normal_expense",
    },
    {
      policy_id: "travel_expense",
    },
  ];

  const policySheet = [
    {
      policy_id: "normal_expense",
    },
    {
      policy_id: "travel_expense",
    },
  ];

  const errors = validatePolicyReferences(expenseTypeSheet, policySheet);

  expect(errors.length).toBe(0);
});
it("company_name が空欄の場合はエラーを返す", () => {
  const companySheet = [
    {
      company_id: "sample-company",
      company_name: "",
      default_policy_id: "normal_expense",
    },
  ];

  const metadata = {
    company_id: "必須",
    company_name: "必須",
    default_policy_id: "必須",
  };

  const errors = validateCompanySettings(companySheet, metadata);

  expect(errors.length).toBe(1);
  expect(errors[0]).toContain("company_name");
});
